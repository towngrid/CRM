// Business Search (Step 3a): business types, places, ordering services, and the
// lead-type rules. Pure code shared by the server and the screens; no network here.
import type { LeadList } from "./leadTypes";

// ── Business types ──────────────────────────────────────────────────────────
export interface BusinessType {
  value: string;
  label: string;
  /** What is typed into Google Maps, e.g. "pizzerias in 11542". */
  query: string;
  defaultList: LeadList;
}

/** One editable list. Restaurants, pizzerias and food trucks default to the Ordering list. */
export const BUSINESS_TYPES: readonly BusinessType[] = [
  { value: "pet_groomers", label: "Pet groomers", query: "pet groomers", defaultList: "get_seen" },
  { value: "dog_walkers", label: "Dog walkers", query: "dog walkers", defaultList: "get_seen" },
  { value: "pet_sitters", label: "Pet sitters", query: "pet sitters", defaultList: "get_seen" },
  { value: "pizzerias", label: "Pizzerias", query: "pizzerias", defaultList: "ordering" },
  { value: "restaurants", label: "Restaurants", query: "restaurants", defaultList: "ordering" },
  { value: "food_trucks", label: "Food trucks", query: "food trucks", defaultList: "ordering" },
  { value: "landscapers", label: "Landscapers", query: "landscapers", defaultList: "get_seen" },
  { value: "cleaners", label: "Cleaners", query: "cleaning services", defaultList: "get_seen" },
  { value: "handymen", label: "Handymen", query: "handyman services", defaultList: "get_seen" },
  { value: "mobile_detailers", label: "Mobile detailers", query: "mobile car detailing", defaultList: "get_seen" },
];

export const OTHER_BUSINESS_TYPE = "other";

export function businessTypeLabel(value: string, otherText?: string | null): string {
  if (value === OTHER_BUSINESS_TYPE) return otherText?.trim() || "Other";
  return BUSINESS_TYPES.find(t => t.value === value)?.label ?? value;
}

export function businessTypeQuery(value: string, otherText?: string | null): string {
  if (value === OTHER_BUSINESS_TYPE) return (otherText ?? "").trim();
  return BUSINESS_TYPES.find(t => t.value === value)?.query ?? value;
}

export function defaultListFor(value: string): LeadList {
  return BUSINESS_TYPES.find(t => t.value === value)?.defaultList ?? "get_seen";
}

// ── Places: Long Island zip codes ───────────────────────────────────────────
export interface ZipPlace { zip: string; town: string; county: "Nassau" | "Suffolk" }

// Delivery zip codes with their main town (post-office-box-only zips left out).
// Editable: add or fix towns here; the search screen reads this list.
const NASSAU: [string, string][] = [
  ["11001", "Floral Park"], ["11003", "Elmont"], ["11010", "Franklin Square"], ["11020", "Great Neck"],
  ["11021", "Great Neck"], ["11023", "Great Neck"], ["11024", "Kings Point"], ["11030", "Manhasset"],
  ["11040", "New Hyde Park"], ["11050", "Port Washington"], ["11096", "Inwood"], ["11501", "Mineola"],
  ["11507", "Albertson"], ["11509", "Atlantic Beach"], ["11510", "Baldwin"], ["11514", "Carle Place"],
  ["11516", "Cedarhurst"], ["11518", "East Rockaway"], ["11520", "Freeport"], ["11530", "Garden City"],
  ["11542", "Glen Cove"], ["11545", "Glen Head"], ["11547", "Glenwood Landing"], ["11548", "Greenvale"],
  ["11550", "Hempstead"], ["11552", "West Hempstead"], ["11553", "Uniondale"], ["11554", "East Meadow"],
  ["11557", "Hewlett"], ["11558", "Island Park"], ["11559", "Lawrence"], ["11560", "Locust Valley"],
  ["11561", "Long Beach"], ["11563", "Lynbrook"], ["11565", "Malverne"], ["11566", "Merrick"],
  ["11568", "Old Westbury"], ["11569", "Point Lookout"], ["11570", "Rockville Centre"], ["11572", "Oceanside"],
  ["11575", "Roosevelt"], ["11576", "Roslyn"], ["11577", "Roslyn Heights"], ["11579", "Sea Cliff"],
  ["11580", "Valley Stream"], ["11581", "Valley Stream"], ["11590", "Westbury"], ["11596", "Williston Park"],
  ["11598", "Woodmere"], ["11709", "Bayville"], ["11710", "Bellmore"], ["11714", "Bethpage"],
  ["11732", "East Norwich"], ["11735", "Farmingdale"], ["11753", "Jericho"], ["11756", "Levittown"],
  ["11758", "Massapequa"], ["11762", "Massapequa Park"], ["11765", "Mill Neck"], ["11771", "Oyster Bay"],
  ["11783", "Seaford"], ["11791", "Syosset"], ["11793", "Wantagh"], ["11797", "Woodbury"],
  ["11801", "Hicksville"], ["11803", "Plainview"], ["11804", "Old Bethpage"],
];

const SUFFOLK: [string, string][] = [
  ["11701", "Amityville"], ["11702", "Babylon"], ["11703", "North Babylon"], ["11704", "West Babylon"],
  ["11705", "Bayport"], ["11706", "Bay Shore"], ["11713", "Bellport"], ["11715", "Blue Point"],
  ["11716", "Bohemia"], ["11717", "Brentwood"], ["11718", "Brightwaters"], ["11719", "Brookhaven"],
  ["11720", "Centereach"], ["11721", "Centerport"], ["11722", "Central Islip"], ["11724", "Cold Spring Harbor"],
  ["11725", "Commack"], ["11726", "Copiague"], ["11727", "Coram"], ["11729", "Deer Park"],
  ["11730", "East Islip"], ["11731", "East Northport"], ["11733", "East Setauket"], ["11738", "Farmingville"],
  ["11739", "Great River"], ["11740", "Greenlawn"], ["11741", "Holbrook"], ["11742", "Holtsville"],
  ["11743", "Huntington"], ["11746", "Huntington Station"], ["11747", "Melville"], ["11749", "Hauppauge"],
  ["11751", "Islip"], ["11752", "Islip Terrace"], ["11754", "Kings Park"], ["11755", "Lake Grove"],
  ["11757", "Lindenhurst"], ["11763", "Medford"], ["11764", "Miller Place"], ["11766", "Mount Sinai"],
  ["11767", "Nesconset"], ["11768", "Northport"], ["11769", "Oakdale"], ["11772", "Patchogue"],
  ["11776", "Port Jefferson Station"], ["11777", "Port Jefferson"], ["11778", "Rocky Point"], ["11779", "Ronkonkoma"],
  ["11780", "St. James"], ["11782", "Sayville"], ["11784", "Selden"], ["11786", "Shoreham"],
  ["11787", "Smithtown"], ["11788", "Hauppauge"], ["11789", "Sound Beach"], ["11790", "Stony Brook"],
  ["11792", "Wading River"], ["11795", "West Islip"], ["11796", "West Sayville"], ["11798", "Wyandanch"],
  ["11901", "Riverhead"], ["11930", "Amagansett"], ["11931", "Aquebogue"], ["11932", "Bridgehampton"],
  ["11933", "Calverton"], ["11934", "Center Moriches"], ["11935", "Cutchogue"], ["11937", "East Hampton"],
  ["11939", "East Marion"], ["11940", "East Moriches"], ["11941", "Eastport"], ["11942", "East Quogue"],
  ["11944", "Greenport"], ["11946", "Hampton Bays"], ["11947", "Jamesport"], ["11948", "Laurel"],
  ["11949", "Manorville"], ["11950", "Mastic"], ["11951", "Mastic Beach"], ["11952", "Mattituck"],
  ["11953", "Middle Island"], ["11954", "Montauk"], ["11955", "Moriches"], ["11956", "New Suffolk"],
  ["11957", "Orient"], ["11958", "Peconic"], ["11959", "Quogue"], ["11960", "Remsenburg"],
  ["11961", "Ridge"], ["11962", "Sagaponack"], ["11963", "Sag Harbor"], ["11964", "Shelter Island"],
  ["11965", "Shelter Island Heights"], ["11967", "Shirley"], ["11968", "Southampton"], ["11970", "South Jamesport"],
  ["11971", "Southold"], ["11972", "Speonk"], ["11975", "Wainscott"], ["11976", "Water Mill"],
  ["11977", "Westhampton"], ["11978", "Westhampton Beach"], ["11980", "Yaphank"],
];

export const LONG_ISLAND_ZIPS: readonly ZipPlace[] = [
  ...NASSAU.map(([zip, town]) => ({ zip, town, county: "Nassau" as const })),
  ...SUFFOLK.map(([zip, town]) => ({ zip, town, county: "Suffolk" as const })),
];

export function townForZip(zip: string): string | null {
  return LONG_ISLAND_ZIPS.find(z => z.zip === zip)?.town ?? null;
}

/** A place to search: a 5-digit zip, or a town name ("Glen Cove"). */
export function normalizePlace(input: string): string | null {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (/^\d{5}$/.test(text)) return text;
  if (/^[A-Za-z][A-Za-z .'-]{1,40}$/.test(text)) return text;
  return null;
}

/** "11542" → "11542" (Glen Cove); "Glen Cove" → "Glen Cove, NY". */
export function placeQuery(place: string): string {
  return /^\d{5}$/.test(place) ? place : `${place}, NY`;
}

// ── Credit estimate ─────────────────────────────────────────────────────────
// Pass 1 SerpAPI calls: one Google Maps call per place per page (up to 20 businesses),
// then per business: website search (only if Google lists no website), one combined
// Facebook/Instagram search (only if the website doesn't link both), and for the
// Ordering list one delivery-apps search.
export interface CreditEstimate { mapsCalls: number; maxBusinesses: number; perBusinessMax: number; max: number; likely: number }

export function estimateCredits(places: number, pages: number, list: LeadList): CreditEstimate {
  const mapsCalls = places * pages;
  const maxBusinesses = mapsCalls * 20;
  const perBusinessMax = list === "ordering" ? 3 : 2;
  // Typically ~1 in 4 businesses has no website on Google and ~half need the social search.
  const perBusinessLikely = (list === "ordering" ? 1 : 0) + 0.25 + 0.5;
  return {
    mapsCalls,
    maxBusinesses,
    perBusinessMax,
    max: mapsCalls + maxBusinesses * perBusinessMax,
    likely: Math.ceil(mapsCalls + maxBusinesses * perBusinessLikely),
  };
}

// ── Ordering and delivery services ──────────────────────────────────────────
export interface OrderingService {
  key: string;
  label: string;
  hosts: string[];
  /** A marketplace that charges the restaurant commission (DoorDash, Uber Eats...). */
  marketplace: boolean;
  /** Ordering the restaurant runs itself (Toast, ChowNow, DoorDash storefront...). */
  ownOrdering: boolean;
  /** The company that sells the ordering also owns the website (Slice, ChowNow, Owner.com...). */
  buildsWebsites?: boolean;
}

export const ORDERING_SERVICES: readonly OrderingService[] = [
  { key: "doordash_storefront", label: "DoorDash storefront", hosts: ["order.online"], marketplace: false, ownOrdering: true },
  { key: "doordash", label: "DoorDash", hosts: ["doordash.com"], marketplace: true, ownOrdering: false },
  { key: "ubereats", label: "Uber Eats", hosts: ["ubereats.com"], marketplace: true, ownOrdering: false },
  { key: "postmates", label: "Postmates", hosts: ["postmates.com"], marketplace: true, ownOrdering: false },
  { key: "grubhub", label: "Grubhub", hosts: ["grubhub.com"], marketplace: true, ownOrdering: false },
  { key: "seamless", label: "Seamless", hosts: ["seamless.com"], marketplace: true, ownOrdering: false },
  { key: "slice", label: "Slice", hosts: ["slicelife.com"], marketplace: true, ownOrdering: false, buildsWebsites: true },
  { key: "chownow", label: "ChowNow", hosts: ["chownow.com"], marketplace: false, ownOrdering: true, buildsWebsites: true },
  { key: "toast", label: "Toast", hosts: ["toasttab.com"], marketplace: false, ownOrdering: true },
  { key: "square", label: "Square Online", hosts: ["square.site", "squareup.com"], marketplace: false, ownOrdering: true },
  { key: "clover", label: "Clover", hosts: ["clover.com"], marketplace: false, ownOrdering: true },
  { key: "menufy", label: "Menufy", hosts: ["menufy.com"], marketplace: false, ownOrdering: true, buildsWebsites: true },
  { key: "beyondmenu", label: "BeyondMenu", hosts: ["beyondmenu.com"], marketplace: false, ownOrdering: true, buildsWebsites: true },
  { key: "gloriafood", label: "GloriaFood", hosts: ["foodbooking.com", "gloriafood.com"], marketplace: false, ownOrdering: true },
  { key: "owner", label: "Owner.com", hosts: ["owner.com"], marketplace: false, ownOrdering: true, buildsWebsites: true },
];

/** Sites we may never open from code: search results (link, title, snippet) only. */
export const NEVER_OPEN_HOSTS = [
  "facebook.com", "fb.com", "instagram.com", "yelp.com", "bbb.org",
  "doordash.com", "grubhub.com", "ubereats.com", "slicelife.com", "seamless.com", "postmates.com",
];

export function hostOf(url: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isNeverOpenUrl(url: string): boolean {
  const host = hostOf(url);
  return !host || NEVER_OPEN_HOSTS.some(d => hostMatches(host, d));
}

export function orderingServiceForUrl(url: string): OrderingService | null {
  const host = hostOf(url);
  if (!host) return null;
  return ORDERING_SERVICES.find(s => s.hosts.some(h => hostMatches(host, h))) ?? null;
}

// ── Social links ────────────────────────────────────────────────────────────
export const SOCIAL_SITES = [
  { key: "facebook", label: "Facebook", hosts: ["facebook.com", "fb.com"] },
  { key: "instagram", label: "Instagram", hosts: ["instagram.com"] },
  { key: "linkedin", label: "LinkedIn", hosts: ["linkedin.com"] },
  { key: "x", label: "X / Twitter", hosts: ["x.com", "twitter.com"] },
  { key: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  { key: "pinterest", label: "Pinterest", hosts: ["pinterest.com"] },
  { key: "tiktok", label: "TikTok", hosts: ["tiktok.com"] },
] as const;
export type SocialKey = typeof SOCIAL_SITES[number]["key"];

// ── What Pass 1 finds for one business ──────────────────────────────────────
export type YesNoUnknown = "yes" | "no" | "unknown";

export interface WebsiteFindings {
  /** Where the website came from: Google's Website button, or a web search. */
  source: "google" | "search" | "none";
  url: string | null;
  /** Google's Website button goes to Facebook/Instagram, a delivery app, or nothing that loads. */
  googleButton: "ok" | "missing" | "social" | "ordering_site" | "dead";
  loads: YesNoUnknown;
  httpStatus?: number | null;
  finalUrl?: string | null;
  error?: string | null;
  copyrightYear: number | null;
  phoneFriendly: YesNoUnknown;
  contactForm: YesNoUnknown;
  /** Website builder found in the page source (Wix, Squarespace...). */
  builder: string | null;
  /** The ordering company that built/owns the site (Slice, ChowNow, Owner.com...). */
  ownedByOrderingCompany: string | null;
  pagesRead: string[];
}

export interface FoundLink { url: string; page: string }

export interface OrderingFindings {
  /** Links on their own site to delivery/ordering services, with the page each was on. */
  siteLinks: { service: string; label: string; url: string; page: string }[];
  /** "Sends customers to delivery apps from own site". */
  sendsToApps: YesNoUnknown | "no_website";
  /** "Takes orders on own site". */
  ownOrdering: YesNoUnknown | "no_website";
  ownOrderingPlatform: string | null;
  /** Delivery apps found by web search (link, title only). */
  appsFromSearch: { service: string; label: string; url: string; title: string }[];
  /** Google Maps service options (delivery, takeout, dine-in), if shown. */
  googleServiceOptions: Record<string, boolean> | null;
  googleOrderLink: string | null;
}

export interface SocialFindings {
  /** Every social link found in the website's raw page source. */
  fromWebsite: Partial<Record<SocialKey, FoundLink>>;
  /** Search-result matches (title/snippet only; never opened). */
  fromSearch: Partial<Record<"facebook" | "instagram", { url: string; title: string; snippet: string }>>;
  facebookUrl: string | null;
  instagramUrl: string | null;
  /** Social accounts found by search but not linked from the website. */
  notLinkedFromSite: boolean;
}

export interface StillOpenFindings {
  googleStatus: "open" | "permanently_closed" | "temporarily_closed" | "unknown";
  /** Google AI Overview text, a hint only, never proof. */
  aiSummary: string | null;
  aiSaysClosed: boolean;
  newestSourceDate: string | null;
  sourcesLookOld: boolean;
  flag: boolean;
  reasons: string[];
}

// ── Lead types ──────────────────────────────────────────────────────────────
export interface LeadTypeInput {
  list: LeadList;
  website: Pick<WebsiteFindings, "url" | "loads" | "copyrightYear" | "phoneFriendly" | "googleButton">;
  hasFacebook: boolean;
  hasInstagram: boolean;
  ordering?: Pick<OrderingFindings, "ownOrdering" | "sendsToApps" | "appsFromSearch" | "siteLinks">;
  now?: Date;
}

export function websiteIsOldOrBroken(w: LeadTypeInput["website"], now = new Date()): string[] {
  const reasons: string[] = [];
  if (!w.url) return reasons;
  if (w.loads === "no") reasons.push("website doesn't load");
  if (w.copyrightYear != null && w.copyrightYear <= now.getFullYear() - 3) reasons.push(`copyright ${w.copyrightYear}`);
  if (w.loads === "yes" && w.phoneFriendly === "no") reasons.push("not phone-friendly");
  return reasons;
}

/** A website that counts: Google's button doesn't just go to Facebook, and isn't just an ordering/delivery page. */
export function hasRealWebsite(w: LeadTypeInput["website"]): boolean {
  return !!w.url && w.googleButton !== "social" && w.googleButton !== "ordering_site";
}

export function decideLeadType(input: LeadTypeInput): string {
  if (input.list === "ordering" && input.ordering) {
    const o = input.ordering;
    if (o.ownOrdering === "yes") return "own_ordering_already";
    const onApps = o.appsFromSearch.length > 0 || o.sendsToApps === "yes" ||
      o.siteLinks.some(l => ORDERING_SERVICES.find(s => s.key === l.service)?.marketplace);
    return onApps ? "delivery_apps_no_own_ordering" : "no_online_ordering";
  }
  const social = input.hasFacebook || input.hasInstagram;
  if (!hasRealWebsite(input.website)) return social ? "social_no_website" : "starting_from_scratch";
  if (websiteIsOldOrBroken(input.website, input.now).length > 0) return "old_or_broken_website";
  return social ? "already_online" : "website_no_social";
}

// ── Matching search results to the business ─────────────────────────────────
const STOP_WORDS = new Set(["the", "and", "of", "inc", "llc", "co", "corp", "restaurant", "pizzeria", "pizza", "cafe", "bar", "grill", "kitchen", "&", "ny", "a"]);

export function nameTokens(name: string): string[] {
  return name.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").split(/[^a-z0-9]+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function digits(s: string): string { return s.replace(/\D/g, ""); }

/** Does a search result's title/snippet name this business, in this town or with its phone? */
export function resultMatchesBusiness(
  result: { title?: string; snippet?: string; link?: string },
  business: { name: string; town?: string | null; phone?: string | null },
): boolean {
  const shown = `${result.title ?? ""} ${result.snippet ?? ""}`.toLowerCase().replace(/['’]/g, "");
  const link = (result.link ?? "").toLowerCase();
  const text = `${shown} ${link.replace(/[-_/]+/g, " ")}`;
  // Town words in the name ("Joe's of Glen Cove") don't help tell businesses apart.
  const townWords = new Set(nameTokens(business.town ?? ""));
  const allTokens = nameTokens(business.name);
  const tokens = allTokens.filter(t => !townWords.has(t)).length ? allTokens.filter(t => !townWords.has(t)) : allTokens;
  const squashed = `${shown} ${link}`.replace(/[^a-z0-9]/g, "");
  // Whole words from the title and snippet only: a link can hold a street address ("90-forest-ave"),
  // and "ave" must not match "avenue". Long words may also match inside a URL ("greeneatsli").
  const words = new Set(shown.split(/[^a-z0-9]+/).filter(Boolean));
  const hit = (t: string) => words.has(t) || (t.length >= 5 && squashed.includes(t));
  const nameOk = tokens.length === 0
    ? squashed.includes(business.name.toLowerCase().replace(/[^a-z0-9]/g, ""))
    : tokens.filter(hit).length >= Math.min(tokens.length, Math.max(1, Math.ceil(tokens.length * 0.6)));
  if (!nameOk) return false;
  const town = business.town?.toLowerCase();
  const phone = business.phone ? digits(business.phone).slice(-10) : "";
  const townOk = !!town && text.includes(town);
  const phoneOk = phone.length === 10 && digits(text).includes(phone);
  return townOk || phoneOk;
}

// ── Duplicates ──────────────────────────────────────────────────────────────
export function normalizeWebsite(url: string | null | undefined): string {
  if (!url) return "";
  const host = hostOf(url);
  if (!host) return "";
  let path = "";
  try { path = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname.replace(/\/+$/, ""); } catch { /* ignore */ }
  return `${host}${path}`.toLowerCase();
}

export function dedupKeys(b: { name: string; address?: string | null; phone?: string | null; website?: string | null }): string[] {
  const keys: string[] = [];
  const phone = b.phone ? digits(b.phone).slice(-10) : "";
  if (phone.length === 10) keys.push(`phone:${phone}`);
  const site = normalizeWebsite(b.website);
  // Shared hosts (Facebook pages, ordering sites) aren't the business's own site; don't dedupe on them alone.
  if (site && !orderingServiceForUrl(b.website!) && !isNeverOpenUrl(b.website!)) keys.push(`site:${site}`);
  if (b.address) keys.push(`name:${b.name.toLowerCase().replace(/[^a-z0-9]/g, "")}|${b.address.toLowerCase().replace(/[^a-z0-9]/g, "")}`);
  return keys;
}

// ── Address parts ───────────────────────────────────────────────────────────
/** "10 School St, Glen Cove, NY 11542" → { town: "Glen Cove", zip: "11542" } */
export function townAndZip(address: string | null | undefined): { town: string | null; zip: string | null } {
  if (!address) return { town: null, zip: null };
  const zip = address.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/)?.[1] ?? null;
  const parts = address.split(",").map(p => p.trim()).filter(Boolean);
  let town: string | null = null;
  const stateIdx = parts.findIndex(p => /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(p));
  if (stateIdx > 0) town = parts[stateIdx - 1];
  else if (parts.length >= 2) town = parts[parts.length - 2];
  return { town, zip };
}
