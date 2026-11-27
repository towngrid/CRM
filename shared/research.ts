// Pre-visit research fields (docs/PRE-VISIT-RESEARCH.md), stored on the contact (contacts.research).
// Filled in from Business Search when Seann approves a business, then edited by hand. The Pass 3
// hand checklist (followers, last post, cover photo, anything Google got wrong) lives here too,
// so there is one research screen, not two.

export type Identity = "Matched" | "Uncertain" | "Conflicting" | "";
export type StillOpen = "Open" | "Closed" | "Unknown" | "";
export type YesNoUnknownText = "Yes" | "No" | "Unknown" | "";
export type OwnerStatus = "Supported" | "Suggested" | "Not confirmed";
export type FormStatus = "Found" | "Not found" | "Unverified" | "";
export type NextStep = "Visit" | "Cold email" | "Call" | "Skip" | "";

export interface Research {
  identity: Identity;
  stillOpen: StillOpen;
  stillOpenNote: string;
  inPerson: YesNoUnknownText;
  ownerFirstName: string;
  ownerRole: string;
  ownerStatus: OwnerStatus;
  ownerSource: string;
  emailSource: string;
  contactFormStatus: FormStatus;
  contactFormKind: "General" | "Booking" | "";
  orderingPlatform: string;
  orderingUrl: string;
  deliveryApps: string;
  deliveryButtons: string;
  googleProfile: string;
  bestPlan: string;
  oneThing: string;
  oneThingSource: string;
  objection: string;
  nextStep: NextStep;
  // Pass 3: Seann's hand checklist
  handChecked: boolean;
  facebookFollowers: string;
  instagramFollowers: string;
  lastPostDate: string;
  coverPhotoBad: boolean;
  googleWrong: string;
  notes: string;
  /** When the fields were filled in from Business Search. */
  filledFromSearchAt?: string;
}

export const EMPTY_RESEARCH: Research = {
  identity: "", stillOpen: "", stillOpenNote: "", inPerson: "",
  ownerFirstName: "", ownerRole: "", ownerStatus: "Not confirmed", ownerSource: "",
  emailSource: "", contactFormStatus: "", contactFormKind: "",
  orderingPlatform: "", orderingUrl: "", deliveryApps: "", deliveryButtons: "",
  googleProfile: "", bestPlan: "", oneThing: "", oneThingSource: "", objection: "", nextStep: "",
  handChecked: false, facebookFollowers: "", instagramFollowers: "", lastPostDate: "", coverPhotoBad: false, googleWrong: "",
  notes: "",
};

export function readResearch(value: unknown): Research {
  return { ...EMPTY_RESEARCH, ...((value && typeof value === "object") ? value as Partial<Research> : {}) };
}

/** Cold emails greet the owner by first name only when it is Supported (PRE-VISIT-RESEARCH.md). */
export function greetingName(research: Research, businessName: string): string {
  return research.ownerStatus === "Supported" && research.ownerFirstName.trim()
    ? research.ownerFirstName.trim()
    : `${businessName} team`;
}

// ── Filling from a Business Search result ───────────────────────────────────
interface LeadLike {
  name: string;
  leadList: string;
  leadType: string | null;
  rating: number | null;
  reviewCount: number | null;
  googleStatus: string | null;
  deliveryApps: string | null;
  findings: unknown;
  scoreReasons?: unknown;
  handChecked?: boolean;
  facebookFollowers?: number | null;
  instagramFollowers?: number | null;
  lastPostDate?: string | null;
  handCheckNotes?: string | null;
}

const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : "");

export function suggestPlan(leadList: string, leadType: string | null): string {
  if (leadList === "ordering") {
    if (leadType === "own_ordering_already") return "Get Seen (already takes its own orders)";
    return "Restaurant Ordering";
  }
  return "Get Seen";
}

export function researchFromLead(lead: LeadLike): Research {
  const f = (lead.findings ?? {}) as any;
  const w = f.website ?? {};
  const o = f.ordering ?? null;
  const p2 = f.pass2 ?? null;
  const open = f.stillOpen ?? {};
  const pass3 = f.pass3 ?? {};
  const emails: { email: string; page?: string; url?: string }[] = [
    ...(f.emailLookup?.hand ? [{ email: f.emailLookup.hand.email, page: "entered by Seann" }] : []),
    ...(w.emails ?? []),
    ...(f.searchEmails ?? []),
    ...(f.emailLookup?.emailSearch?.emails ?? []),
    ...(f.emailLookup?.ai?.emails ?? []),
  ];
  const google = [
    lead.rating != null ? `${lead.rating} stars, ${lead.reviewCount ?? 0} reviews` : null,
    p2 ? (p2.unclaimed ? "profile UNCLAIMED" : "claimed") : null,
    p2 ? `owner replied to ${p2.ownerRepliesOfNewest10} of the newest ${p2.reviewsChecked} reviews` : null,
    p2?.unansweredBadReview ? "a 1–2 star review has no reply" : null,
    p2 ? (p2.newestUpdateDate ? `last Update ${day(p2.newestUpdateDate)}` : "no Updates posts") : null,
    p2 ? `${p2.ownerPhotoCount >= 10 ? "10+" : p2.ownerPhotoCount} owner photos` : null,
    p2?.hoursLastUpdated ? `hours: ${p2.hoursLastUpdated}` : null,
  ].filter(Boolean).join("; ");
  const reasons = Array.isArray(lead.scoreReasons) ? (lead.scoreReasons as { points: number; text: string; key: string }[]) : [];
  const top = [...reasons].sort((a, b) => b.points - a.points)[0];
  const marketplaceButtons = (o?.siteLinks ?? []).filter((l: any) => ["doordash", "ubereats", "grubhub", "seamless", "postmates", "slice"].includes(l.service));
  return {
    ...EMPTY_RESEARCH,
    identity: "Matched", // it came from its own Google listing
    stillOpen: lead.googleStatus === "permanently_closed" || lead.googleStatus === "temporarily_closed" ? "Closed" : open.flag ? "Unknown" : "Open",
    stillOpenNote: [lead.googleStatus === "open" ? "Google: open" : null, ...(open.reasons ?? []), p2?.newestReviewDate ? `newest review ${day(p2.newestReviewDate)}` : null].filter(Boolean).join("; "),
    inPerson: "Unknown",
    emailSource: emails[0] ? (emails[0].page || emails[0].url || "") : "",
    contactFormStatus: w.contactForm === "yes" ? "Found" : w.contactForm === "no" ? "Not found" : w.url ? "Unverified" : "",
    contactFormKind: w.contactForm === "yes" ? "General" : "",
    orderingPlatform: o?.ownOrderingPlatform ?? (w.ownedByOrderingCompany ?? ""),
    orderingUrl: (o?.siteLinks ?? []).find((l: any) => l.label === o?.ownOrderingPlatform)?.url ?? "",
    deliveryApps: lead.deliveryApps ?? "",
    deliveryButtons: marketplaceButtons.map((l: any) => `${l.label}${l.otherLocation ? " (for another location)" : ""} on ${l.page}`).join("; "),
    googleProfile: google,
    bestPlan: suggestPlan(lead.leadList, lead.leadType),
    oneThing: top ? top.text : "",
    oneThingSource: top ? "Business Search" : "",
    nextStep: "",
    handChecked: !!lead.handChecked,
    facebookFollowers: lead.facebookFollowers != null ? String(lead.facebookFollowers) : "",
    instagramFollowers: lead.instagramFollowers != null ? String(lead.instagramFollowers) : "",
    lastPostDate: lead.lastPostDate ?? "",
    coverPhotoBad: !!pass3.coverPhotoBad,
    googleWrong: pass3.googleWrong ?? "",
    notes: lead.handCheckNotes ?? "",
    filledFromSearchAt: new Date().toISOString(),
  };
}
