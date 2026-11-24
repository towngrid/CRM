// Runs one Business Search: Google Maps per place, then Pass 1 checks for each business.
// Runs in the background; progress is saved after every business, so a restart can resume.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { businessLeads, businessSearches, type BusinessLead, type BusinessSearch } from "@shared/schema";
import {
  ORDERING_SERVICES, businessTypeQuery, decideLeadType, dedupKeys, hostMatches, hostOf, nameTokens,
  orderingServiceForUrl, placeQuery, resultMatchesBusiness, townAndZip, townForZip,
  type OrderingFindings, type SocialFindings, type StillOpenFindings, type WebsiteFindings,
} from "@shared/businessSearch";
import type { LeadList } from "@shared/leadTypes";
import { SerpBudgetStop, serpRequest } from "./serp";
import { checkWebsite, orderingFromSite, type SiteCheck } from "./website";

const HOURLY_WAIT_MS = 5 * 60_000;
const running = new Set<string>();

export function isRunning(searchId: string): boolean {
  return running.has(searchId);
}

// Directory and listing sites: never taken as the business's own website.
const NOT_OWN_SITE = [
  "facebook.com", "instagram.com", "yelp.com", "bbb.org", "tripadvisor.com", "yellowpages.com", "mapquest.com",
  "foursquare.com", "zomato.com", "opentable.com", "menupages.com", "allmenus.com", "menuism.com", "zmenu.com",
  "restaurantji.com", "restaurantguru.com", "sirved.com", "nextdoor.com", "linkedin.com", "twitter.com", "x.com",
  "tiktok.com", "youtube.com", "pinterest.com", "google.com", "apple.com", "bing.com", "manta.com", "chamberofcommerce.com",
  "angi.com", "thumbtack.com", "homeadvisor.com", "houzz.com", "porch.com", "groupon.com", "newsday.com", "patch.com",
  "loopnet.com", "zillow.com", "wikipedia.org", "seamless.com", "postmates.com", "toasttab.com", "chownow.com",
  "order.online", "menufy.com", "beyondmenu.com", "square.site", "clover.com", "ubereats.com", "doordash.com",
  "grubhub.com", "slicelife.com", "birdeye.com", "nicelocal.com", "waze.com", "roadtrippers.com", "dnb.com",
  "bizapedia.com", "corner.inc", "menupix.com", "grubhub.com", "beyondmenu.com", "restaurantclicks.com", "trycaviar.com", "opencorporates.com", "buzzfile.com", "cylex.us.com", "hotfrog.com", "superpages.com", "local.com",
  "citysearch.com", "merchantcircle.com", "showmelocal.com", "ezlocal.com", "brownbook.net", "wheree.com",
];

/** A web-search result counts as their own site only if it isn't a directory and its address carries a word of their name. */
function isOwnSiteCandidate(url: string, name: string): boolean {
  const host = hostOf(url);
  if (!host || NOT_OWN_SITE.some(d => hostMatches(host, d))) return false;
  const domain = host.split(".").slice(0, -1).join("");
  return nameTokens(name).some(t => t.length >= 3 && domain.includes(t));
}

// ── Google Maps ───────────────────────────────────────────────────────────

interface MapsBusiness {
  name: string; address: string | null; town: string | null; zip: string | null; phone: string | null;
  rating: number | null; reviewCount: number | null; category: string | null; website: string | null;
  placeId: string | null; dataId: string | null; raw: any;
}

function mapsBusiness(local: any): MapsBusiness {
  const parsed = townAndZip(local.address);
  const zip = parsed.zip;
  // Odd address formats ("New York, Glen Cove, School St, ..."): trust the town the zip list knows, if it's in the address.
  const known = zip ? townForZip(zip) : null;
  const town = known && String(local.address ?? "").toLowerCase().includes(known.toLowerCase()) ? known : parsed.town;
  return {
    name: String(local.title ?? "").trim(),
    address: local.address ?? null,
    town, zip,
    phone: local.phone ?? null,
    rating: typeof local.rating === "number" ? local.rating : null,
    reviewCount: typeof local.reviews === "number" ? local.reviews : null,
    category: local.type ?? (Array.isArray(local.types) ? local.types[0] : null) ?? null,
    website: local.website ?? null,
    placeId: local.place_id ?? null,
    dataId: local.data_id ?? null,
    raw: local,
  };
}

function inArea(b: MapsBusiness, place: string): boolean {
  if (/^\d{5}$/.test(place)) {
    if (b.zip) return b.zip === place;
    const town = townForZip(place);
    return !!town && !!b.town && b.town.toLowerCase() === town.toLowerCase();
  }
  return !!b.town && b.town.toLowerCase() === place.toLowerCase();
}

function googleStatusOf(local: any): StillOpenFindings["googleStatus"] {
  const text = [local.open_state, local.hours, local.business_status]
    .filter(v => typeof v === "string").join(" ").toLowerCase();
  if (/permanently closed/.test(text)) return "permanently_closed";
  if (/temporarily closed/.test(text)) return "temporarily_closed";
  if (local.permanently_closed === true) return "permanently_closed";
  if (local.temporarily_closed === true) return "temporarily_closed";
  return text ? "open" : "unknown";
}

function serviceOptions(local: any): Record<string, boolean> | null {
  const so = local.service_options;
  if (!so || typeof so !== "object") return null;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(so)) if (typeof v === "boolean") out[k] = v;
  return Object.keys(out).length ? out : null;
}

function googleOrderLink(local: any): string | null {
  const candidates = [local.order_online, local.order_online_link, local.order, local.links?.order];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:/.test(c)) return c;
    if (c && typeof c.link === "string") return c.link;
  }
  return null;
}

async function mapsPhase(search: BusinessSearch): Promise<void> {
  const what = businessTypeQuery(search.businessType, search.businessTypeOther);
  const all: MapsBusiness[] = [];
  let outside = 0;
  for (const place of search.places) {
    let params: Record<string, string> | null = {
      engine: "google_maps", type: "search", q: `${what} in ${placeQuery(place)}`, hl: "en", gl: "us",
    };
    for (let page = 0; page < search.pagesPerPlace && params; page++) {
      const data = await serpRequest(search.id, params);
      for (const local of data.local_results ?? []) {
        const b = mapsBusiness(local);
        if (!b.name) continue;
        if (inArea(b, place)) all.push(b); else outside++;
      }
      const next: string | undefined = data.serpapi_pagination?.next;
      params = null;
      if (next && (data.local_results ?? []).length >= 20) {
        const u = new URL(next);
        const p: Record<string, string> = {};
        u.searchParams.forEach((v, k) => { if (k !== "api_key") p[k] = v; });
        params = p;
      }
    }
  }
  // Remove duplicates by phone, website, and name + address.
  const seen = new Set<string>();
  const unique: MapsBusiness[] = [];
  let dups = 0;
  for (const b of all) {
    const keys = dedupKeys({ name: b.name, address: b.address, phone: b.phone, website: b.website });
    if (keys.some(k => seen.has(k))) { dups++; continue; }
    keys.forEach(k => seen.add(k));
    unique.push(b);
  }
  await db.transaction(async tx => {
    if (unique.length) {
      await tx.insert(businessLeads).values(unique.map(b => ({
        searchId: search.id, userId: search.userId, name: b.name, address: b.address, town: b.town, zip: b.zip,
        phone: b.phone, rating: b.rating, reviewCount: b.reviewCount, googleCategory: b.category,
        googleUrl: b.placeId ? `https://www.google.com/maps/place/?q=place_id:${b.placeId}` : null,
        googlePlaceId: b.placeId, googleDataId: b.dataId, websiteUrl: b.website,
        googleStatus: googleStatusOf(b.raw), stillOpenFlag: ["permanently_closed", "temporarily_closed"].includes(googleStatusOf(b.raw)),
        leadList: search.leadList, mapsResult: b.raw,
      })));
    }
    await tx.update(businessSearches).set({ businessesFound: unique.length, outsideArea: outside, duplicatesRemoved: dups })
      .where(eq(businessSearches.id, search.id));
  });
}

// ── Web searches (Google, via SerpAPI): link, title and snippet only ─────────

interface Organic { link: string; title: string; snippet: string; date?: string }

function organics(data: any): Organic[] {
  return (data?.organic_results ?? []).map((r: any) => ({ link: r.link ?? "", title: r.title ?? "", snippet: r.snippet ?? "", date: r.date }))
    .filter((r: Organic) => r.link);
}

function aiOverviewText(data: any): string | null {
  const ai = data?.ai_overview;
  if (!ai) return null;
  const parts: string[] = [];
  const walk = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (typeof b?.snippet === "string") parts.push(b.snippet);
      if (Array.isArray(b?.list)) walk(b.list);
      if (Array.isArray(b?.text_blocks)) walk(b.text_blocks);
    }
  };
  walk(ai.text_blocks ?? []);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 1500) : null;
}

function parseResultDate(text: string | undefined, now = new Date()): Date | null {
  if (!text) return null;
  const rel = text.match(/(\d+)\s+(day|week|month|year)s?\s+ago/i);
  if (rel) {
    const n = Number(rel[1]);
    const days = { day: 1, week: 7, month: 30, year: 365 }[rel[2].toLowerCase() as "day"] * n;
    return new Date(now.getTime() - days * 86_400_000);
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isSocialPage(url: string, site: "facebook" | "instagram"): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const path = new URL(url).pathname.toLowerCase();
  if (site === "facebook") {
    return (hostMatches(host, "facebook.com") || hostMatches(host, "fb.com")) &&
      !/^\/(groups|events|posts|photos|videos|watch|search|marketplace|hashtag|story\.php|permalink\.php|reel)/.test(path) && !/\/posts\/|\/photos\/|\/videos\//.test(path);
  }
  return hostMatches(host, "instagram.com") && !/^\/(p|reel|reels|explore|stories|accounts|popular)\//.test(path) && path.length > 1;
}

type Who = { name: string; town?: string | null; phone?: string | null };

function socialFromResults(results: Organic[], who: Who): SocialFindings["fromSearch"] {
  const out: SocialFindings["fromSearch"] = {};
  for (const r of results) {
    for (const site of ["facebook", "instagram"] as const) {
      if (out[site] || !isSocialPage(r.link, site)) continue;
      if (resultMatchesBusiness(r, who)) out[site] = { url: r.link, title: r.title, snippet: r.snippet };
    }
  }
  return out;
}

function appsFromResults(results: Organic[], who: Who): OrderingFindings["appsFromSearch"] {
  const out: OrderingFindings["appsFromSearch"] = [];
  for (const r of results) {
    const service = orderingServiceForUrl(r.link);
    if (!service?.marketplace || out.some(a => a.service === service.key)) continue;
    if (resultMatchesBusiness(r, who)) out.push({ service: service.key, label: service.label, url: r.link, title: r.title });
  }
  return out;
}

const CLOSED_TEXT = /permanently closed|closed permanently|has (?:permanently )?closed|is now closed|no longer (?:open|in business|operating)|closed (?:its|their) doors|out of business/i;

// ── Pass 1 for one business ───────────────────────────────────────────────

async function checkLead(search: BusinessSearch, lead: BusinessLead): Promise<void> {
  const list = search.leadList as LeadList;
  const who: Who = { name: lead.name, town: lead.town, phone: lead.phone };
  const where = lead.town ? `${lead.town} NY` : (lead.zip ?? "");
  const local = (lead.mapsResult ?? {}) as any;
  const webResults: Organic[] = [];
  const nameSearchResults: Organic[] = []; // the "name + town" search only, for the still-open dates
  let aiSummary: string | null = null;

  // 1. Website: Google's, or one web search when Google lists none.
  let site: SiteCheck;
  if (lead.websiteUrl) {
    site = await checkWebsite(lead.websiteUrl, "google");
  } else {
    const data = await serpRequest(search.id, { engine: "google", q: `"${lead.name}" ${where}`, num: "10", hl: "en", gl: "us" });
    const results = organics(data);
    webResults.push(...results);
    nameSearchResults.push(...results);
    aiSummary = aiOverviewText(data);
    const match = results.find(r => isOwnSiteCandidate(r.link, lead.name) && resultMatchesBusiness(r, who));
    site = await checkWebsite(match ? match.link : null, match ? "search" : "none");
    if (!match) site.website.googleButton = "missing";
  }

  // 2–3. Social: links in the website's raw source first; one combined search only if FB or IG is missing.
  let fromSearch = socialFromResults(webResults, who);
  const fbOnSite = site.socialLinks.facebook?.url ?? null;
  const igOnSite = site.socialLinks.instagram?.url ?? null;
  if ((!fbOnSite && !fromSearch.facebook) || (!igOnSite && !fromSearch.instagram)) {
    const data = await serpRequest(search.id, {
      engine: "google", q: `${lead.name} ${where} (site:facebook.com OR site:instagram.com)`, num: "10", hl: "en", gl: "us",
    });
    const results = organics(data);
    webResults.push(...results);
    aiSummary = aiSummary ?? aiOverviewText(data);
    fromSearch = { ...socialFromResults(results, who), ...fromSearch };
  }
  const facebookUrl = fbOnSite ?? fromSearch.facebook?.url ?? null;
  const instagramUrl = igOnSite ?? fromSearch.instagram?.url ?? null;
  const hasOwnSite = !!site.website.url && site.website.googleButton !== "social" && site.website.loads === "yes";
  const social: SocialFindings = {
    fromWebsite: site.socialLinks,
    fromSearch,
    facebookUrl,
    instagramUrl,
    notLinkedFromSite: hasOwnSite && ((!fbOnSite && !!fromSearch.facebook) || (!igOnSite && !!fromSearch.instagram)),
  };

  // 6–8. Ordering list: delivery apps by search, buttons on their own site, Google's service options.
  let ordering: OrderingFindings | null = null;
  if (list === "ordering") {
    const data = await serpRequest(search.id, {
      engine: "google",
      q: `${lead.name} ${where} (site:doordash.com OR site:grubhub.com OR site:ubereats.com OR site:slicelife.com OR site:seamless.com)`,
      num: "10", hl: "en", gl: "us",
    });
    const results = organics(data);
    webResults.push(...results);
    const fromSite = orderingFromSite(site);
    const apps = appsFromResults(results, who);
    // A delivery-app link that Google lists as the "website" counts as being on that app.
    for (const l of fromSite.siteLinks) {
      const svc = ORDERING_SERVICES.find(s => s.key === l.service);
      if (svc?.marketplace && !apps.some(a => a.service === svc.key) && l.page === "Google listing") {
        apps.push({ service: svc.key, label: svc.label, url: l.url, title: "Google listing's website link" });
      }
    }
    ordering = { ...fromSite, appsFromSearch: apps, googleServiceOptions: serviceOptions(local), googleOrderLink: googleOrderLink(local) };
  }

  // Still open?
  // Only the name search: Facebook/Instagram results carry old post dates even for open businesses.
  const dates = nameSearchResults.map(r => parseResultDate(r.date)).filter((d): d is Date => !!d);
  const newest = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;
  const sourcesLookOld = dates.length >= 2 && !!newest && newest.getTime() < Date.now() - 3 * 365 * 86_400_000;
  const googleStatus = (lead.googleStatus ?? "unknown") as StillOpenFindings["googleStatus"];
  const aiSaysClosed = !!aiSummary && CLOSED_TEXT.test(aiSummary);
  const reasons: string[] = [];
  if (googleStatus === "permanently_closed") reasons.push("Google says permanently closed");
  if (googleStatus === "temporarily_closed") reasons.push("Google says temporarily closed");
  if (aiSaysClosed) reasons.push("Google AI summary says closed (a hint, not proof)");
  if (sourcesLookOld) reasons.push(`newest web source is from ${newest!.getFullYear()}`);
  const stillOpen: StillOpenFindings = {
    googleStatus, aiSummary, aiSaysClosed, newestSourceDate: newest ? newest.toISOString().slice(0, 10) : null,
    sourcesLookOld, flag: reasons.length > 0, reasons,
  };

  const leadType = decideLeadType({
    list,
    website: site.website,
    hasFacebook: !!facebookUrl,
    hasInstagram: !!instagramUrl,
    ordering: ordering ?? undefined,
  });

  const deliveryApps = ordering
    ? Array.from(new Set([
        ...ordering.appsFromSearch.map(a => a.label),
        ...ordering.siteLinks.filter(l => ORDERING_SERVICES.find(s => s.key === l.service)?.marketplace).map(l => l.label),
      ])).join(", ")
    : null;

  await db.update(businessLeads).set({
    websiteUrl: site.website.url,
    facebookUrl,
    instagramUrl,
    deliveryApps: deliveryApps || null,
    ownOrdering: ordering?.ownOrdering ?? null,
    sendsToApps: ordering?.sendsToApps ?? null,
    stillOpenFlag: stillOpen.flag,
    leadType,
    checkStatus: "checked",
    checkError: null,
    findings: { website: site.website, social, ordering, stillOpen, jsLoaded: site.jsLoaded } satisfies {
      website: WebsiteFindings; social: SocialFindings; ordering: OrderingFindings | null; stillOpen: StillOpenFindings; jsLoaded: boolean;
    },
    checkedAt: new Date(),
  }).where(eq(businessLeads.id, lead.id));
}

// ── Running a search ───────────────────────────────────────────────────────

async function setStatus(id: string, values: Partial<typeof businessSearches.$inferInsert>) {
  await db.update(businessSearches).set(values).where(eq(businessSearches.id, id));
}

export async function runSearch(searchId: string): Promise<void> {
  if (running.has(searchId)) return;
  running.add(searchId);
  try {
    const [search] = await db.select().from(businessSearches).where(eq(businessSearches.id, searchId));
    if (!search) return;
    await setStatus(searchId, { status: "running", errorMessage: null, startedAt: search.startedAt ?? new Date(), finishedAt: null });

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(businessLeads).where(eq(businessLeads.searchId, searchId));
    if (count === 0) await withHourlyWait(searchId, () => mapsPhase(search));

    for (;;) {
      const [current] = await db.select({ status: businessSearches.status }).from(businessSearches).where(eq(businessSearches.id, searchId));
      if (current?.status !== "running") return; // stopped by Seann
      const [lead] = await db.select().from(businessLeads)
        .where(and(eq(businessLeads.searchId, searchId), eq(businessLeads.checkStatus, "pending")))
        .orderBy(asc(businessLeads.createdAt), asc(businessLeads.id)).limit(1);
      if (!lead) break;
      try {
        await withHourlyWait(searchId, () => checkLead(search, lead));
      } catch (error) {
        if (error instanceof SerpBudgetStop) throw error;
        await db.update(businessLeads).set({ checkStatus: "failed", checkError: String((error as Error)?.message ?? error).slice(0, 300), checkedAt: new Date() })
          .where(eq(businessLeads.id, lead.id));
      }
      await db.update(businessSearches).set({ businessesChecked: sql`${businessSearches.businessesChecked} + 1` })
        .where(eq(businessSearches.id, searchId));
    }
    await setStatus(searchId, { status: "done", finishedAt: new Date() });
  } catch (error) {
    const message = String((error as Error)?.message ?? error).slice(0, 500);
    await setStatus(searchId, {
      status: error instanceof SerpBudgetStop ? "stopped" : "failed",
      errorMessage: message,
      finishedAt: new Date(),
    });
    console.error(`[BusinessSearch] ${searchId} stopped:`, message);
  } finally {
    running.delete(searchId);
  }
}

/** Waits out the hourly limit (up to ~2 hours), then gives up with a clear message. */
async function withHourlyWait<T>(searchId: string, work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof SerpBudgetStop) || !error.hourly || attempt >= 24) throw error;
      await setStatus(searchId, { errorMessage: `${error.message} Waiting 5 minutes, then continuing.` });
      await new Promise(r => setTimeout(r, HOURLY_WAIT_MS));
      await setStatus(searchId, { errorMessage: null });
    }
  }
}

/** "Check again": redo Pass 1 for every business (Maps isn't searched again; repeated web searches come from the cache). */
export async function resetForRecheck(searchId: string): Promise<void> {
  const leads = await db.select({ id: businessLeads.id, mapsResult: businessLeads.mapsResult }).from(businessLeads).where(eq(businessLeads.searchId, searchId));
  await db.transaction(async tx => {
    for (const l of leads) {
      const b = l.mapsResult ? mapsBusiness(l.mapsResult) : null;
      await tx.update(businessLeads).set({
        checkStatus: "pending", checkError: null,
        ...(b ? { town: b.town, zip: b.zip, websiteUrl: b.website } : {}),
      }).where(eq(businessLeads.id, l.id));
    }
    await tx.update(businessSearches).set({ businessesChecked: 0, status: "running", errorMessage: null, finishedAt: null })
      .where(eq(businessSearches.id, searchId));
  });
}

/** After a restart or deploy, searches that were running are marked stopped so Seann can resume them. */
export async function markInterruptedSearches(): Promise<void> {
  await db.update(businessSearches)
    .set({ status: "stopped", errorMessage: "The CRM restarted (for example after an update). Press Resume to finish: searches already made are reused for free." })
    .where(inArray(businessSearches.status, ["running", "queued"]));
}
