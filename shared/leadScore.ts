// Opportunity score (Step 3b, decided Nov 23-24). Measures how good a SALES OPPORTUNITY a
// business is for TownGrid: something missing that TownGrid sells earns points; "alive" points
// keep dead or tiny businesses from rising. Every point value is editable by an admin in
// Settings → Opportunity score (stored in table score_points; these are the starting values).
//
// Seann's decisions (Nov 24): no website at all = +25 only (the +20 "Google's Website button"
// line is for a button that goes to Facebook, a dead link, or a missing button while a website
// exists elsewhere); restaurants get the Get Seen points too, on top of the ordering points.
import { ORDERING_SERVICES } from "./businessSearch";

export type ScoreGroup = "get_seen" | "ordering" | "alive" | "tiers";

export interface ScorePoint {
  key: string;
  group: ScoreGroup;
  label: string;
  points: number;
  /** Where the signal comes from. Pass 2 lines score 0 until the Google profile audit runs (3c). */
  source: "Pass 1" | "Pass 2" | "Hand check" | "Tier";
}

export const DEFAULT_SCORE_POINTS: readonly ScorePoint[] = [
  { key: "no_website", group: "get_seen", label: "No website", points: 25, source: "Pass 1" },
  { key: "google_button_problem", group: "get_seen", label: "Google's Website button goes to Facebook, is a dead link, or is missing while a website exists", points: 20, source: "Pass 1" },
  { key: "old_website", group: "get_seen", label: "Website old (copyright 3+ years), broken, or not phone-friendly", points: 15, source: "Pass 1" },
  { key: "ordering_company_website", group: "get_seen", label: "Website owned by the ordering company (Slice, ChowNow, Owner.com…)", points: 10, source: "Pass 1" },
  { key: "unclaimed", group: "get_seen", label: "Google profile unclaimed", points: 25, source: "Pass 2" },
  { key: "few_owner_replies", group: "get_seen", label: "Owner replied to fewer than 2 of the newest 10 reviews", points: 15, source: "Pass 2" },
  { key: "unanswered_bad_review", group: "get_seen", label: "An unanswered 1–2 star review among the newest 10", points: 5, source: "Pass 2" },
  { key: "no_updates_90d", group: "get_seen", label: "No Google \"Updates\" posts in 90 days", points: 5, source: "Pass 2" },
  { key: "no_owner_photo_6m", group: "get_seen", label: "No photos from the owner on Google (Google doesn't give photo dates, so \"in 6 months\" can't be checked)", points: 10, source: "Pass 2" },
  { key: "few_reviews", group: "get_seen", label: "Review count under half the average of the top 3 in the same search", points: 10, source: "Pass 1" },
  { key: "no_social", group: "get_seen", label: "No Facebook and no Instagram found", points: 10, source: "Pass 1" },
  { key: "social_not_linked", group: "get_seen", label: "Social accounts exist but aren't linked from the website", points: 5, source: "Pass 1" },
  { key: "apps_no_own_ordering", group: "ordering", label: "On DoorDash / Uber Eats / Grubhub / Seamless, no ordering of its own", points: 25, source: "Pass 1" },
  { key: "order_button_to_apps", group: "ordering", label: "Own website's Order button goes to one of those apps", points: 20, source: "Pass 1" },
  { key: "slice", group: "ordering", label: "Orders through Slice (per-order fee pitch)", points: 10, source: "Pass 1" },
  { key: "gloriafood", group: "ordering", label: "On GloriaFood (shutting down: must switch)", points: 30, source: "Pass 1" },
  { key: "good_rating", group: "alive", label: "Rating 4.0+ and 30+ Google reviews", points: 10, source: "Pass 1" },
  { key: "recent_review", group: "alive", label: "A Google review in the last 60 days", points: 5, source: "Pass 2" },
  { key: "recent_social_post", group: "alive", label: "Your hand check: posted on Facebook/Instagram in the last 30 days", points: 10, source: "Hand check" },
  { key: "tier_a", group: "tiers", label: "Tier A from (visit or call first)", points: 60, source: "Tier" },
  { key: "tier_b", group: "tiers", label: "Tier B from (cold email); below is C (later)", points: 40, source: "Tier" },
  // Kept apart from the tier lines (Nov 27): a business at 45 before its Google check can score 100 after it.
  { key: "pass2_from", group: "tiers", label: "Run the Google profile check for businesses scoring at least (before the check)", points: 40, source: "Tier" },
];

export const SCORE_GROUP_LABELS: Record<ScoreGroup, string> = {
  get_seen: "Get Seen opportunity (what TownGrid can fix)",
  ordering: "Ordering opportunity (restaurants, pizzerias, food trucks)",
  alive: "Alive and able to pay",
  tiers: "Tiers",
};

/** Saved values (key → points) over the starting list; unknown keys are ignored. */
export function mergeScorePoints(saved: Record<string, number>): ScorePoint[] {
  return DEFAULT_SCORE_POINTS.map(p => (Number.isFinite(saved[p.key]) ? { ...p, points: saved[p.key] } : { ...p }));
}

// ── What the score reads ────────────────────────────────────────────────────
export interface ScoreInput {
  leadList: string;
  rating: number | null;
  reviewCount: number | null;
  googleStatus: string | null;
  findings: any; // business_leads.findings (Pass 1), plus pass2 when 3c runs
  lastPostDate: string | null; // hand check
  /** Average review count of the top 3 businesses in the same search. */
  top3AverageReviews: number | null;
  /** Set when the business looks like part of a chain (same name at several addresses). */
  chainReason: string | null;
  /** Seann set it aside by hand, with this reason. */
  manualSetAside: string | null;
  now?: Date;
}

export interface ScoreResult {
  score: number | null;
  tier: "A" | "B" | "C" | null;
  reasons: { key: string; points: number; text: string }[];
  setAsideReason: string | null;
}

function pts(points: ScorePoint[], key: string): number {
  return points.find(p => p.key === key)?.points ?? 0;
}

const DAY = 86_400_000;

export function scoreLead(input: ScoreInput, points: ScorePoint[]): ScoreResult {
  // Knock-outs: set aside, not scored.
  const knock =
    input.manualSetAside ? input.manualSetAside :
    input.googleStatus === "permanently_closed" ? "Google says permanently closed" :
    input.googleStatus === "temporarily_closed" ? "Google says temporarily closed" :
    input.chainReason;
  if (knock) return { score: null, tier: null, reasons: [], setAsideReason: knock };

  const f = input.findings ?? {};
  const w = f.website ?? {};
  const social = f.social ?? {};
  const ordering = f.ordering ?? null;
  const pass2 = f.pass2 ?? null;
  const now = input.now ?? new Date();
  const reasons: ScoreResult["reasons"] = [];
  const add = (key: string, text: string) => {
    const p = pts(points, key);
    if (p !== 0) reasons.push({ key, points: p, text });
  };

  // Get Seen
  const hasSite = !!w.url && w.googleButton !== "social" && w.googleButton !== "ordering_site";
  if (!hasSite) add("no_website", "no website");
  if (w.googleButton === "social") add("google_button_problem", "Google's Website button goes to Facebook/Instagram");
  else if (w.googleButton === "dead") add("google_button_problem", "Google's Website button is a dead link");
  else if (w.source === "search" && hasSite) add("google_button_problem", "website not on Google's listing");
  if (hasSite) {
    const why: string[] = [];
    if (w.loads === "no") why.push("doesn't load");
    if (w.copyrightYear != null && w.copyrightYear <= now.getFullYear() - 3) why.push(`© ${w.copyrightYear}`);
    if (w.loads === "yes" && w.phoneFriendly === "no") why.push("not phone-friendly");
    if (why.length) add("old_website", `website ${why.join(", ")}`);
  }
  // Only a real website built and run by an ordering company (Slice, ChowNow, Owner.com, Menufy, BeyondMenu).
  // Not a Toast/DoorDash order page standing in for a website (that's "no website"), and not website
  // builders like BentoBox or Popmenu.
  const siteOwners = ORDERING_SERVICES.filter(s => s.buildsWebsites).map(s => s.label);
  if (hasSite && w.ownedByOrderingCompany && siteOwners.includes(w.ownedByOrderingCompany)) {
    add("ordering_company_website", `website run by ${w.ownedByOrderingCompany}`);
  }
  if (input.top3AverageReviews != null && input.top3AverageReviews > 0 && (input.reviewCount ?? 0) < input.top3AverageReviews / 2) {
    add("few_reviews", `${input.reviewCount ?? 0} reviews vs ${Math.round(input.top3AverageReviews)} for the top 3`);
  }
  if (!social.facebookUrl && !social.instagramUrl) add("no_social", "no Facebook or Instagram found");
  else if (social.notLinkedFromSite) add("social_not_linked", "social not linked from website");

  // Pass 2 (Google profile audit, 3c)
  if (pass2) {
    if (pass2.unclaimed === true) add("unclaimed", "Google profile unclaimed");
    if (typeof pass2.ownerRepliesOfNewest10 === "number" && pass2.ownerRepliesOfNewest10 < 2) add("few_owner_replies", `owner replied to ${pass2.ownerRepliesOfNewest10} of the newest 10 reviews`);
    if (pass2.unansweredBadReview === true) add("unanswered_bad_review", "unanswered 1–2 star review");
    if (pass2.newestUpdateDate !== undefined && (!pass2.newestUpdateDate || now.getTime() - Date.parse(pass2.newestUpdateDate) > 90 * DAY)) add("no_updates_90d", "no Google Updates in 90 days");
    // Google gives no photo dates (Nov 26), so this checks for owner photos at all.
    if (typeof pass2.ownerPhotoCount === "number" && pass2.ownerPhotoCount === 0) add("no_owner_photo_6m", "no photos from the owner on Google");
    else if (pass2.newestOwnerPhotoDate !== undefined && (!pass2.newestOwnerPhotoDate || now.getTime() - Date.parse(pass2.newestOwnerPhotoDate) > 182 * DAY)) add("no_owner_photo_6m", "no owner photo in 6 months");
    if (pass2.newestReviewDate && now.getTime() - Date.parse(pass2.newestReviewDate) <= 60 * DAY) add("recent_review", "Google review in the last 60 days");
  }

  // Ordering (Ordering list only)
  if (input.leadList === "ordering" && ordering) {
    const appLabels = new Set<string>([
      ...(ordering.appsFromSearch ?? []).map((a: any) => a.service),
      ...(ordering.siteLinks ?? []).filter((l: any) => !l.otherLocation).map((l: any) => l.service),
    ]);
    const bigApps = ["doordash", "ubereats", "grubhub", "seamless", "postmates"].filter(k => appLabels.has(k));
    if (bigApps.length && ordering.ownOrdering !== "yes") {
      add("apps_no_own_ordering", `on ${bigApps.map(k => ORDERING_SERVICES.find(s => s.key === k)?.label ?? k).join(", ")}, no own ordering`);
    }
    if (ordering.sendsToApps === "yes") add("order_button_to_apps", "own website sends customers to delivery apps");
    if (appLabels.has("slice")) add("slice", "orders through Slice");
    if (appLabels.has("gloriafood") || /gloriafood/i.test(ordering.ownOrderingPlatform ?? "")) add("gloriafood", "on GloriaFood (shutting down)");
  }

  // Alive
  if ((input.rating ?? 0) >= 4 && (input.reviewCount ?? 0) >= 30) add("good_rating", `rating ${input.rating} / ${input.reviewCount} reviews`);
  if (input.lastPostDate && now.getTime() - Date.parse(input.lastPostDate) <= 30 * DAY) add("recent_social_post", "posted on social in the last 30 days (your check)");

  const score = reasons.reduce((s, r) => s + r.points, 0);
  const tier = score >= pts(points, "tier_a") ? "A" : score >= pts(points, "tier_b") ? "B" : "C";
  return { score, tier, reasons, setAsideReason: null };
}

/** "+25 no website · +10 rating 4.3 / 88 reviews" */
export function reasonsText(reasons: ScoreResult["reasons"]): string {
  return reasons.map(r => `${r.points > 0 ? "+" : ""}${r.points} ${r.text}`).join(" · ");
}

/** "Tocolo Cantina Glen Cove" / "Plado Tasting Bar - Glen Cove" → "tocolo cantina" / "plado tasting bar". */
export function chainKey(name: string, town?: string | null): string {
  let s = name.toLowerCase().replace(/[（(].*?[)）]/g, " ").split(/\s+[-–|]\s+/)[0];
  if (town) s = s.replace(new RegExp(`\\b${town.toLowerCase().replace(/[^a-z ]/g, "")}\\b`, "g"), " ");
  return s.replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|ny)\b/g, " ").replace(/\s+/g, " ").trim();
}

/** Same name at 2+ different addresses among all of Seann's leads = part of a chain or group. Returns name key → address count. */
export function chainNames(leads: { name: string; town: string | null; address: string | null }[]): Map<string, number> {
  const byName = new Map<string, Set<string>>();
  for (const l of leads) {
    const key = chainKey(l.name, l.town);
    if (!key) continue;
    const addrs = byName.get(key) ?? new Set<string>();
    addrs.add((l.address ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    byName.set(key, addrs);
  }
  const out = new Map<string, number>();
  byName.forEach((addrs, key) => { if (addrs.size >= 2) out.set(key, addrs.size); });
  return out;
}
