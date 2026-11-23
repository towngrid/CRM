import { storage } from "./storage";
import { sameSalonWebsite, salonRelativePage } from "@shared/salonWebsiteScope";
import { providerHourlyLimit, type SerpRequestPolicy } from "./serpRequestPolicy";
import type { LeadDiscoveryJob, LeadDiscoveryResult, InsertLeadDiscoveryResult, SerpUsage, LeadDiscoveryConfig } from "@shared/schema";
import { parseAddressString } from "@shared/utils";
import { fetchPublicPage, type SalonFetchRuntime } from "./salonPublicFetch";
import { salonEmailHtmlContextRestriction, salonEmailDomainRestriction } from "./salonEmailPolicy";
import { directoryEligibility, isBookingOrOrderingUrl, providerCategories, withDirectoryNotes } from "@shared/directoryEligibility";
import { readSerpProviderResponse } from "./serpProviderResponse";
import { sharedSerpStopMessage } from "@shared/serpBudget";
import { getSerpApiKey } from "./appConfig";

// New reduced query set for budget management
const DEFAULT_QUERIES = [
  "Dog Groomer in {STATE}, Zip code {ZIP}",
  "Pet Grooming shop in {STATE}, Zip code {ZIP}",
];

const OPTIONAL_THIRD_QUERY = "Grooming salon in {STATE}, Zip code {ZIP}";

// Helper to get current month-year string
function getCurrentMonthYear(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Guardrail check functions
export async function getSerpUsageStatus(): Promise<{
  usage: SerpUsage;
  config: LeadDiscoveryConfig;
  isQuotaReached: boolean;
  warningLevel: 'none' | 'yellow' | 'red' | 'hardstop';
}> {
  const monthYear = getCurrentMonthYear();
  const usage = await storage.getOrCreateSerpUsage(monthYear);
  const config = await storage.getOrCreateLeadDiscoveryConfig("global");
  
  const used = usage.usedCredits || 0;
  const hardStop = usage.hardStopAt || 200;
  const quota = usage.monthlyQuota || 250;
  
  let warningLevel: 'none' | 'yellow' | 'red' | 'hardstop' = 'none';
  if (used >= hardStop) {
    warningLevel = 'hardstop';
  } else if (used >= quota * 0.7) {
    warningLevel = 'red';
  } else if (used >= quota * 0.4) {
    warningLevel = 'yellow';
  }
  
  return {
    usage,
    config,
    isQuotaReached: used >= hardStop,
    warningLevel
  };
}

export async function canRunDiscovery(userId: string, numZips: number, skipDailyCheck = false): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const status = await getSerpUsageStatus();
  
  // Check if quota is reached
  if (status.isQuotaReached) {
    return { allowed: false, reason: sharedSerpStopMessage(status.usage.usedCredits, status.usage.hardStopAt) };
  }
  
  // Check max ZIPs per run (only at job creation)
  if (!skipDailyCheck) {
    const maxZips = status.config.maxZipsPerRun || 3;
    if (numZips > maxZips) {
      return { allowed: false, reason: `Maximum ${maxZips} ZIP codes allowed per run` };
    }
    
    // Check runs per day (only at job creation)
    const runsToday = await storage.getRunsToday(userId);
    const maxRunsPerDay = status.config.maxRunsPerDay || 1;
    if (runsToday >= maxRunsPerDay) {
      return { allowed: false, reason: `Maximum ${maxRunsPerDay} run(s) per day reached` };
    }
  }
  
  // Check hourly rate limit
  const callsLastHour = await storage.getSerpCallsInLastHour();
  const maxCallsPerHour = status.config.maxSerpCallsPerHour || 5;
  if (callsLastHour >= maxCallsPerHour) {
    return { allowed: false, reason: `Hourly SERP limit reached (${maxCallsPerHour}/hour). Please wait.` };
  }
  
  return { allowed: true };
}

// Get the queries to use based on config
export async function getActiveQueries(): Promise<string[]> {
  const config = await storage.getOrCreateLeadDiscoveryConfig("global");
  const queries = [...DEFAULT_QUERIES];
  
  if (config.enableThirdQuery === "true") {
    queries.push(OPTIONAL_THIRD_QUERY);
  }
  
  return queries;
}

const BOOKING_SOFTWARE_PATTERNS: Record<string, string> = {
  "book.cuddlesapp.com": "CuddlesApp",
  "booking.moego.pet": "MoeGo",
  "moego.pet": "MoeGo",
  "petgroomerfinder.com": "PetGroomerFinder",
  "pocketsuite.io": "PocketSuite",
  "pawtastic.app": "Pawtastic",
  "runloyal.com": "RunLoyal",
  "vagaro.com": "Vagaro",
  "square.site": "Square",
  "squareup.com": "Square",
  "schedulicity.com": "Schedulicity",
  "genbook.com": "Genbook",
  "booksy.com": "Booksy",
  "acuityscheduling.com": "Acuity Scheduling",
  "calendly.com": "Calendly",
  "setmore.com": "Setmore",
  "pawfinity.com": "Pawfinity",
  "gingr.app": "Gingr",
  "gingrapp.com": "Gingr",
  "propetware.com": "ProPet",
  "gooseberry.app": "Gooseberry",
  "daysmart.com": "DaySmart",
  "petexec.net": "PetExec",
  "kennel.link": "Kennel Link",
  "precise-petcare.com": "Precise Petcare",
  "time2pet.com": "Time To Pet",
  "thryv.com": "Thryv",
  "mindbodyonline.com": "Mindbody",
  "wix.com": "Wix Booking",
  "groomer.io": "Groomer.io",
};

const BOOKING_BUTTON_KEYWORDS = [
  "book", "book now", "book here", "schedule", "appointment", 
  "groom", "grooming", "reserve", "make an appointment"
];

// Well-known pet retail/grooming chains that always use their own internal software.
// They won't have third-party booking URLs but definitely have booking systems.
const KNOWN_ENTERPRISE_CHAINS: { pattern: RegExp; software: string }[] = [
  { pattern: /petco/i,              software: "Petco Internal" },
  { pattern: /petsmart/i,           software: "PetSmart Internal" },
  { pattern: /pet supplies plus/i,  software: "Pet Supplies Plus Internal" },
  { pattern: /petsuppliesplus/i,    software: "Pet Supplies Plus Internal" },
  { pattern: /petsense/i,           software: "PetSense Internal" },
  { pattern: /petpeople/i,          software: "Pet People Internal" },
  { pattern: /petland/i,            software: "Petland Internal" },
  { pattern: /pet supermarket/i,    software: "Pet Supermarket Internal" },
  { pattern: /banfield/i,           software: "Banfield Internal" },
  { pattern: /camp bow wow/i,       software: "Camp Bow Wow Internal" },
  { pattern: /dogtopia/i,           software: "Dogtopia Internal" },
  { pattern: /barkavenue/i,         software: "Bark Avenue Internal" },
  { pattern: /pawsitive/i,          software: "Pawsitive Internal" },
];

// Broad scheduling/appointment language that signals a business takes bookings
// even if we couldn't identify the specific software
const SCHEDULING_LANGUAGE = [
  "book online", "book an appointment", "book now", "schedule online",
  "schedule an appointment", "request an appointment", "make a reservation",
  "online booking", "appointment scheduling", "schedule your", "book your",
  "click to book", "online scheduler", "self-scheduling",
];

function checkKnownChain(companyName: string): { software: string } | null {
  for (const chain of KNOWN_ENTERPRISE_CHAINS) {
    if (chain.pattern.test(companyName)) {
      return { software: chain.software };
    }
  }
  return null;
}

function hasSchedulingLanguage(html: string): boolean {
  const lower = html.toLowerCase();
  return SCHEDULING_LANGUAGE.some(phrase => lower.includes(phrase));
}

interface SerpApiResult {
  title: string;
  link: string;
  snippet?: string;
  phone?: string;
  address?: string;
  placeId?: string;
  categories?: string[];
}

interface BusinessData {
  company: string;
  websiteUrl?: string;
  phone?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  googleBusinessProfileUrl?: string;
  address?: string;
}

export function buildGoogleMapsParams(apiKey: string, query: string, zipCode: string, placeId?: string): URLSearchParams {
  const params = new URLSearchParams({
    api_key: apiKey,
    engine: "google_maps",
    type: placeId ? "place" : "search",
  });
  if (placeId) params.set("place_id", placeId);
  else params.set("q", `${query.replace(", Zip code " + zipCode, "")} ${zipCode}`);
  return params;
}

export function parseGoogleMapsResults(data: {
  local_results?: Array<Record<string, any>>;
  place_results?: Record<string, any>;
}): SerpApiResult[] {
  const results: SerpApiResult[] = [];
  for (const local of data.local_results || []) {
    results.push({
      title: local.title || "",
      link: local.website || "",
      phone: local.phone,
      address: local.address,
      placeId: local.place_id,
      categories: providerCategories([local.type, ...(Array.isArray(local.types) ? local.types : []), ...(Array.isArray(local.categories) ? local.categories : [])]),
      snippet: local.description || "",
    });
  }
  if (data.place_results) {
    const place = data.place_results;
    if (!results.some(result => result.title === place.title)) {
      results.push({
        title: place.title || "",
        link: place.website || "",
        phone: place.phone,
        address: place.address,
        placeId: place.place_id,
        categories: providerCategories([place.type, ...(Array.isArray(place.types) ? place.types : []), ...(Array.isArray(place.categories) ? place.categories : [])]),
        snippet: place.description || "",
      });
    }
  }
  return results;
}

// Search using Google Maps engine with caching and usage tracking
export async function searchWithSerpApi(
  query: string, 
  zipCode: string,
  state: string,
  queryTemplate: string,
  options?: { placeId?: string; beforeProviderRequest?: () => void | Promise<void>; requestPolicy?: SerpRequestPolicy },
): Promise<{ results: SerpApiResult[]; fromCache: boolean }> {
  const apiKey = getSerpApiKey();
  if (!apiKey) {
    throw new Error("SERPAPI_KEY not configured");
  }

  // Check cache first (30-day caching)
  const cached = await storage.getSerpCache(zipCode, queryTemplate, state, 30);
  if (cached) {
    console.log(`Using cached results for ${zipCode} - ${queryTemplate}`);
    return { results: cached.resultsJson as SerpApiResult[], fromCache: true };
  }

  const status = await getSerpUsageStatus();
  if (status.isQuotaReached) {
    await options?.requestPolicy?.onReservationBlocked();
    throw new Error(sharedSerpStopMessage(status.usage.usedCredits, status.usage.hardStopAt));
  }

  const maxCallsPerHour = providerHourlyLimit(status.config.maxSerpCallsPerHour || 5, options?.requestPolicy);
  const monthYear = getCurrentMonthYear();
  const reservationId = await storage.reserveSerpCall(monthYear, maxCallsPerHour);
  if (!reservationId) {
    await options?.requestPolicy?.onReservationBlocked();
    throw new Error(`SERP quota or hourly limit reached (${maxCallsPerHour}/hour). Please wait.`);
  }

  let billableCallMade = false;
  try {
    // Use Google Maps engine for better local business results
    // Include location in query since ll parameter requires lat,long coordinates
    const params = buildGoogleMapsParams(apiKey, query, zipCode, options?.placeId);
    const searchQuery = `${query.replace(", Zip code " + zipCode, "")} ${zipCode}`;

    await options?.beforeProviderRequest?.();
    console.log(options?.placeId ? "Looking up Google Maps Place ID" : `Searching Google Maps: ${searchQuery}`);
    // Count initiation even when a network failure leaves provider billing uncertain.
    billableCallMade = true;
    const response = await fetch(`https://serpapi.com/search?${params}`);
    // A completed provider response may consume credit even if the response
    // cannot be parsed or cached; never refund it as a network failure.
    
    const data = await readSerpProviderResponse<any>(response, options?.requestPolicy);
    
    const results = parseGoogleMapsResults(data);

    // Cache the results
    try {
      await storage.createSerpCache(zipCode, queryTemplate, state, results);
    } catch (cacheError) {
      console.error("SERP result cache failed; provider call remains counted:", cacheError);
    }
    
    console.log(`Found ${results.length} results for ${query}`);
    return { results, fromCache: false };
  } catch (error) {
    if (!billableCallMade) await storage.releaseSerpCall(reservationId, monthYear);
    console.error("SerpAPI search failed:", error);
    // NO automatic retries - require manual retry
    throw error;
  }
}

const SALON_CRAWL_MAX_PAGES = 8;
const SALON_CRAWL_MAX_REQUESTS = 12;
const SALON_CRAWL_TOTAL_MS = 25_000;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PLAIN_UA = "curl/8.14.1";

function siteHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function sameSite(left: URL, right: URL): boolean {
  return sameSalonWebsite(left, right);
}

function siteVariants(url: URL): URL[] {
  const hosts = [url.hostname, url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`];
  const variants: URL[] = [];
  for (const protocol of ["https:", "http:"]) {
    for (const hostname of hosts) {
      const variant = new URL(url.href);
      variant.protocol = protocol;
      variant.hostname = hostname;
      variant.hash = "";
      if (!variants.some(existing => existing.href === variant.href)) variants.push(variant);
    }
  }
  return variants;
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/gi, "&")
    .replace(/(&#x([0-9a-f]+);?)/gi, (entity: string, _full: string, code: string) => {
      const point = parseInt(code, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : entity;
    })
    .replace(/(&#(\d+);?)/g, (entity: string, _full: string, code: string) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : entity;
    })
    .replace(/&commat;/gi, "@").replace(/&period;/gi, ".")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s*\[at\]\s*|\s*\(at\)\s*/gi, "@")
    .replace(/\s*\[dot\]\s*|\s*\(dot\)\s*/gi, ".");
}

function extractMailtoEmails(html: string): string[] {
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails: string[] = [];
  const decoded = decodeHtml(html);
  for (const match of Array.from(decoded.matchAll(/\bhref\s*=\s*["']mailto:([^"'?#]*)/gi))) {
    let addressList = match[1];
    try { addressList = decodeURIComponent(addressList); } catch {}
    emails.push(...(addressList.match(emailRe) ?? []));
  }
  return emails;
}

function decodeCloudflareEmails(html: string): string[] {
  const emails: string[] = [];
  for (const match of Array.from(html.matchAll(/data-cfemail=["']([a-f\d]+)["']/gi))) {
    const encoded = match[1];
    if (encoded.length < 4 || encoded.length % 2) continue;
    const key = parseInt(encoded.slice(0, 2), 16);
    let decoded = "";
    for (let index = 2; index < encoded.length; index += 2) {
      decoded += String.fromCharCode(parseInt(encoded.slice(index, index + 2), 16) ^ key);
    }
    emails.push(decoded);
  }
  return emails;
}

function emailCandidates(html: string): { visible: string[]; metadata: string[] } {
  const noise = ["example.com", "sentry.io", "w3.org", "schema.org", "cloudflare.com", "wixpress.com"];
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const valid = (values: string[]) => Array.from(new Set(values.map(email => email.trim().toLowerCase())))
    .filter(email => !noise.some(domain => email.endsWith(`@${domain}`) || email.endsWith(`.${domain}`)) &&
      !/\.(?:png|jpe?g|gif|svg)$/i.test(email));
  const decoded = decodeHtml(html);
  const visibleHtml = decoded.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ")
    .replace(/<meta\b[^>]*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(template|noscript|svg|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  // Attribute values, tracking URLs and hidden form values are not visible
  // business contact evidence. Keep explicit mailto/Cloudflare extraction.
  const visibleText = visibleHtml
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(template|noscript|svg|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  const visible: string[] = (visibleText.match(emailRe) || []) as string[];
  visible.push(...extractMailtoEmails(visibleHtml));
  visible.push(...decodeCloudflareEmails(visibleHtml));
  const metadataText = [
    ...Array.from(decoded.matchAll(/<meta\b[^>]*>/gi), m => m[0]),
    ...Array.from(decoded.matchAll(/["'](?:email|emailaddress|contactemail)["']\s*:\s*["']([^"']+@[^"']+)["']/gi), m => m[1]),
  ];
  const metadata = [
    ...(metadataText.join(" ").match(new RegExp(emailRe.source, "gi")) ?? []),
    ...extractMailtoEmails(decoded),
  ];
  return { visible: valid(visible), metadata: valid(metadata).filter(email => !valid(visible).includes(email)) };
}

function emailSourceType(html: string, email: string): "visible" | "mailto" | "cloudflare" {
  const visibleHtml = decodeHtml(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ")
    .replace(/<meta\b[^>]*>/gi, " ");
  if (extractMailtoEmails(visibleHtml).some(candidate => candidate.toLowerCase() === email.toLowerCase())) return "mailto";
  if (decodeCloudflareEmails(visibleHtml).some(candidate => candidate.toLowerCase() === email.toLowerCase())) return "cloudflare";
  return "visible";
}

function restrictedSalonEmailReason(email: string, html: string): string | null {
  const domainReason = salonEmailDomainRestriction(email);
  if (domainReason) return domainReason;
  let decodedMarkup = decodeHtml(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ");
  for (const match of Array.from(html.matchAll(/\bhref\s*=\s*["']mailto:([^"'?#]*)/gi))) {
    let addressList = decodeHtml(match[1]);
    try { addressList = decodeURIComponent(addressList); } catch {}
    const addresses = addressList.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
    if (addresses.length) decodedMarkup = decodedMarkup.replace(match[0], `${match[0]} ${addresses.join(" ")}`);
  }
  for (const match of Array.from(html.matchAll(/data-cfemail=["']([a-f\d]+)["']/gi))) {
    const decodedAddress = decodeCloudflareEmails(match[0])[0];
    if (decodedAddress) decodedMarkup = decodedMarkup.replace(match[0], `${match[0]} ${decodedAddress}`);
  }
  return salonEmailHtmlContextRestriction(email, decodedMarkup);
}

function contactLinks(html: string, base: URL): URL[] {
  const links: URL[] = [];
  for (const match of Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi))) {
    const href = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href) continue;
    const value = decodeHtml(href[1] ?? href[2] ?? href[3] ?? "").trim();
    const label = decodeHtml(match[2].replace(/<[^>]*>/g, " "));
    const context = `${value} ${label}`;
    if (!/\b(contact|about|reach|inquir|message|team|staff)\b/i.test(context) ||
        /\b(book(?:ing)?|appointment|schedule|reservation)\b/i.test(context)) continue;
    try {
      const target = new URL(value, base);
      if (!["http:", "https:"].includes(target.protocol) || !sameSite(target, base) || target.username || target.password) continue;
      target.hash = "";
      if (!links.some(link => link.href === target.href)) links.push(target);
    } catch {}
  }
  return links;
}

export async function crawlWebsite(url: string, options: { runtime?: SalonFetchRuntime; onPage?: (page: { url: string; html: string }) => void } = {}): Promise<{
  html: string;
  bookingUrl?: string;
  softwareName?: string;
  email?: string;
  emailSourceUrl?: string;
  emailSourceType?: "visible" | "mailto" | "cloudflare";
  metadataEmail?: string;
  metadataEmailSourceUrl?: string;
  rejectedEmails: Array<{ value: string; sourceUrl: string; reason: string }>;
  phone?: string;
  contactFormUrl?: string;
  resolvedWebsiteUrl?: string;
  partialFailures: string[];
  ownerName?: string;
  jobTitle?: string;
}> {
  try {
    let base: URL;
    try { base = new URL(url.startsWith("http") ? url : `https://${url}`); }
    catch { throw new Error(`Invalid URL: ${url}`); }
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
      throw new Error("Only public HTTP(S) pages can be fetched");
    }
    const host = base.hostname.toLowerCase().replace(/^www\./, "");
    const socialHosts = ["facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "yelp.com", "tiktok.com", "youtube.com", "youtu.be", "vimeo.com"];
    const bookingHosts = Object.keys(BOOKING_SOFTWARE_PATTERNS).filter(domain => domain !== "wix.com");
    if ([...socialHosts, ...bookingHosts].some(domain => host === domain || host.endsWith(`.${domain}`))) {
      throw new Error("Submitted URL is a booking or social platform, not a salon website");
    }
    base.hash = "";
    const deadline = Date.now() + SALON_CRAWL_TOTAL_MS;
    const requestBudget = { used: 0, max: SALON_CRAWL_MAX_REQUESTS };
    const partialFailures: string[] = [];
    const pages: Array<{ url: string; html: string }> = [];
    const visited = new Set<string>();
    const fetch = async (target: URL): Promise<void> => {
      if (pages.length >= SALON_CRAWL_MAX_PAGES || Date.now() >= deadline) return;
      const key = target.href;
      if (visited.has(key) || requestBudget.used >= requestBudget.max) return;
      visited.add(key);
      let error: unknown;
      for (const userAgent of [BROWSER_UA, PLAIN_UA]) {
        if (requestBudget.used >= requestBudget.max || Date.now() >= deadline) break;
        try {
          const response = await fetchPublicPage(key, {
            timeoutMs: Math.max(250, Math.min(5_000, deadline - Date.now())),
            deadlineAt: deadline,
            maxRedirects: 2,
            userAgent,
            runtime: options.runtime,
            requestBudget,
            allowedHosts: [base.hostname, base.hostname.replace(/^www\./, ""), `www.${base.hostname.replace(/^www\./, "")}`],
          });
          if (!sameSite(new URL(response.finalUrl), base)) throw new Error("Website redirected outside this salon's site.");
          pages.push({ url: response.finalUrl, html: response.body });
          options.onPage?.({ url: response.finalUrl, html: response.body });
          visited.add(response.finalUrl);
          return;
        } catch (caught) {
          error = caught;
        }
      }
      const detail = error instanceof Error ? error.message : "Request failed";
      partialFailures.push(`${key}: ${detail}`);
    };

    let homepage: { url: string; html: string } | undefined;
    for (const variant of siteVariants(base)) {
      await fetch(variant);
      if (pages.length) {
        homepage = pages[0];
        break;
      }
      if (requestBudget.used >= requestBudget.max || Date.now() >= deadline) break;
    }
    if (!homepage) {
      throw new Error(`Unable to fetch website after bounded protocol/host retries: ${partialFailures.join("; ") || "request or time limit reached"}`);
    }
    const resolvedBase = new URL(homepage.url);
    const html = homepage.html;
    const result: Awaited<ReturnType<typeof crawlWebsite>> = {
      html, resolvedWebsiteUrl: homepage.url, partialFailures, rejectedEmails: [],
    };
    const usableCandidate = (email: string, page: { url: string; html: string }): boolean => {
      const reason = restrictedSalonEmailReason(email, page.html);
      if (!reason) return true;
      if (result.rejectedEmails.length < 50 && !result.rejectedEmails.some(
        rejected => rejected.value === email && rejected.sourceUrl === page.url,
      )) {
        result.rejectedEmails.push({ value: email, sourceUrl: page.url, reason });
      }
      return false;
    };
    const checkCandidates = (page: { url: string; html: string }) => {
      const candidates = emailCandidates(page.html);
      return {
        visible: candidates.visible.filter(email => usableCandidate(email, page)),
        metadata: candidates.metadata.filter(email => usableCandidate(email, page)),
      };
    };

    const bookingInfo = detectBookingSoftware(html, resolvedBase.href);
    if (bookingInfo) {
      result.bookingUrl = bookingInfo.url;
      result.softwareName = bookingInfo.software;
    }

    const firstCandidates = checkCandidates(homepage);
    for (const email of firstCandidates.visible) {
      result.email = email;
      result.emailSourceUrl = homepage.url;
      result.emailSourceType = emailSourceType(html, email);
      break;
    }
    if (firstCandidates.metadata.length) {
      result.metadataEmail = firstCandidates.metadata[0];
      if (result.metadataEmail) result.metadataEmailSourceUrl = homepage.url;
    }
    result.phone = extractPhone(html) ?? undefined;
    let formSource: string | undefined = hasPublicGeneralInquiryForm(html, homepage.url) ? homepage.url : undefined;
    const discovered = contactLinks(html, resolvedBase);
    discovered.sort((left, right) => {
      const priority = (url: URL) => /\b(contact|inquir|reach|message)\b/i.test(url.href) ? 0 :
        /\b(about|team|staff)\b/i.test(url.href) ? 1 : 2;
      return priority(left) - priority(right);
    });
    const usual = ["/contact", "/contact-us", "/about", "/about-us", "/reach-us", "/get-in-touch"];
    const pagesToVisit = discovered.flatMap(link => {
      const slash = new URL(link.href);
      slash.pathname = slash.pathname.replace(/\/+$/, "") || "/";
      const withSlash = new URL(slash.href);
      if (withSlash.pathname !== "/") withSlash.pathname += "/";
      return [slash, withSlash];
    });
    if (!discovered.length || !result.email || !result.phone) {
      for (const path of usual) {
        pagesToVisit.push(salonRelativePage(resolvedBase, path));
        pagesToVisit.push(new URL(`${path}/`, resolvedBase.origin));
      }
    }
    for (const target of pagesToVisit) {
      if (result.email && result.phone && formSource) break;
      if (pages.length >= SALON_CRAWL_MAX_PAGES || requestBudget.used >= requestBudget.max || Date.now() >= deadline) break;
      const previousPageCount = pages.length;
      await fetch(target);
      const page = pages.length > previousPageCount ? pages.at(-1) : undefined;
      if (!page || !sameSite(new URL(page.url), resolvedBase)) continue;
      const candidates = checkCandidates(page);
      if (!result.email) {
        for (const email of candidates.visible) {
          result.email = email;
          result.emailSourceUrl = page.url;
          result.emailSourceType = emailSourceType(page.html, email);
          break;
        }
        if (!result.metadataEmail) {
          result.metadataEmail = candidates.metadata[0];
          if (result.metadataEmail) result.metadataEmailSourceUrl = page.url;
        }
      }
      if (!result.phone) result.phone = extractPhone(page.html) ?? undefined;
      if (!formSource && hasPublicGeneralInquiryForm(page.html, page.url)) formSource = page.url;
    }
    if (formSource) result.contactFormUrl = formSource;
    if (pages.length >= SALON_CRAWL_MAX_PAGES || requestBudget.used >= requestBudget.max || Date.now() >= deadline) {
      partialFailures.push("Crawl stopped at its page, request, or total-time bound");
    }
    return result;
  } catch (error) {
    console.error(`Failed to crawl ${url}:`, error);
    throw error;
  }
}

function bookingDestination(url: string): string {
  try {
    const parsed = new URL(url.replace(/&amp;/gi, "&"));
    if (["google.com", "www.google.com"].includes(parsed.hostname.toLowerCase()) &&
        parsed.pathname === "/url") {
      const destination = new URL(parsed.searchParams.get("q") || "");
      if (destination.protocol === "https:" && !destination.username && !destination.password) {
        return destination.href;
      }
    }
  } catch {
    // Leave malformed or non-HTTPS redirects untouched for manual review.
  }
  return url;
}

function detectBookingSoftware(html: string, baseUrl: string): { url: string; software: string } | null {
  const lowerHtml = html.toLowerCase();

  // Pass 1: scan the entire HTML (case-insensitive) for any known software domain.
  // This catches direct links, iframe src attrs, JS variables, data- attrs, etc.
  for (const [pattern, software] of Object.entries(BOOKING_SOFTWARE_PATTERNS)) {
    if (lowerHtml.includes(pattern)) {
      const urlMatch = html.match(new RegExp(`https?://[^"'\\s<>]*${pattern.replace(/\./g, "\\.")}[^"'\\s<>]*`, "i"));
      return {
        url: urlMatch ? bookingDestination(urlMatch[0]) : `https://${pattern}`,
        software,
      };
    }
  }

  // Pass 2: look for any href or src that links to a booking-related URL.
  // Matches href AND src attributes (catches iframes and script-loaded widgets).
  // The booking-keyword check scans a wider window around the attribute so nested
  // tags (e.g. <a href="..."><span>Salon Booking</span></a>) still match.
  const attrPattern = /(?:href|src)=["']([^"']+)["']/gi;
  const bookingKeywords = /book|schedule|appointment|reserve/i;

  let match;
  while ((match = attrPattern.exec(html)) !== null) {
    const url = match[1];
    // Image assets can sit beside "book now" copy on hosted site builders.
    // They are not booking destinations even when the nearby text matches.
    if (/\/sitesv-images-rt\/|\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$)/i.test(url)) continue;

    // Check if the URL itself is a known software domain
    for (const [pattern, software] of Object.entries(BOOKING_SOFTWARE_PATTERNS)) {
      if (url.toLowerCase().includes(pattern)) {
        return { url: bookingDestination(url), software };
      }
    }

    // For unknown URLs, only count them if they look like a booking link.
    // Look at up to 300 chars before and after the attribute for booking context.
    const windowStart = Math.max(0, match.index - 300);
    const windowEnd   = Math.min(html.length, match.index + match[0].length + 300);
    const context = html.slice(windowStart, windowEnd);

    if (bookingKeywords.test(context)) {
      if (url.startsWith("http")) {
        return { url, software: "Unknown" };
      } else if (url.startsWith("/")) {
        try {
          const base = new URL(baseUrl);
          return { url: `${base.origin}${url}`, software: "Unknown" };
        } catch {}
      }
    }
  }

  return null;
}

function extractPhone(html: string): string | null {
  // Separators are REQUIRED between groups (not optional) so we don't accidentally
  // match 10-digit tracking IDs, Unix timestamps, or URL parameters.
  // Area code must start with 2-9 (US area codes never start with 0 or 1).
  const phonePattern = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]\d{3}[\s.-]\d{4}/g;

  // Strip scripts and style blocks first to avoid matching noise
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");

  const matches = cleaned.match(phonePattern);
  if (!matches) return null;

  // Prefer matches that look like formatted phone numbers (have non-digit separators)
  const formatted = matches.find(m => /[().\s-]/.test(m));
  return formatted ?? matches[0];
}

export function hasPublicGeneralInquiryForm(html: string, pageUrl?: string): boolean {
  if (pageUrl && isBookingOrOrderingUrl(pageUrl)) return false;
  const pageContext = Array.from(html.matchAll(/<(?:title|h1|h2)\b[^>]*>([\s\S]*?)<\/(?:title|h1|h2)\s*>/gi))
    .map(match => match[1].replace(/<[^>]*>/g, " "))
    .join(" ")
    .toLowerCase();
  const forms = Array.from(html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi));
  for (const match of forms) {
    const action = match[1].match(/\baction\s*=\s*["']([^"']+)["']/i)?.[1];
    if (action) {
      try { if (isBookingOrOrderingUrl(new URL(action, pageUrl || "https://form.example/").href)) continue; }
      catch { continue; }
    }
    const attributes = match[1];
    const body = match[2];
    if (/\bhidden\b/i.test(attributes) || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attributes)) continue;

    const hasSubmitInput = Array.from(body.matchAll(/<input\b([^>]*)>/gi)).some(input =>
      /\btype\s*=\s*["']?submit\b/i.test(input[1]));
    const hasSubmitButton = Array.from(body.matchAll(/<button\b([^>]*)>/gi)).some(button => {
      const type = button[1].match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1]?.toLowerCase();
      return !type || type === "submit";
    });
    const hasSubmit = hasSubmitInput || hasSubmitButton;
    if (!hasSubmit) continue;

    const hasMessageField = /<textarea\b[^>]*>/i.test(body) ||
      Array.from(body.matchAll(/<input\b([^>]*)>/gi)).some(input => {
        const attrs = input[1];
        const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1]?.toLowerCase() || "text";
        if (type !== "text") return false;
        const fieldDescription = [
          attrs.match(/\bname\s*=\s*["']([^"']*)/i)?.[1],
          attrs.match(/\bid\s*=\s*["']([^"']*)/i)?.[1],
          attrs.match(/\bplaceholder\s*=\s*["']([^"']*)/i)?.[1],
          attrs.match(/\baria-label\s*=\s*["']([^"']*)/i)?.[1],
        ].filter(Boolean).join(" ").toLowerCase();
        return /\b(message|inquir(?:y|ies)|comment)\b/i.test(fieldDescription);
      });
    if (!hasMessageField) continue;

    const formText = `${attributes} ${body.replace(/<[^>]*>/g, " ")}`.replace(/&nbsp;|&#160;/gi, " ").toLowerCase();
    const hasBookingContext = /\b(book(?:ing)?|appointment|schedule|reservation|order(?:ing)?|checkout|payment|cart)\b/i.test(`${pageContext} ${formText}`);
    const hasGeneralContext = /\b(general\s+inquir(?:y|ies)|contact\s+(?:us|form)|general\s+questions)\b/i.test(`${pageContext} ${formText}`);
    // Appointment and booking forms often include a notes/message field too;
    // treat those as unsupported unless the form explicitly offers general inquiries.
    const bookingOnly = hasBookingContext && !hasGeneralContext;
    if (!bookingOnly) return true;
  }
  return false;
}

function normalizeWebsiteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function normalizePhoneForDedup(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export function isDuplicate(
  business: BusinessData,
  existingResults: LeadDiscoveryResult[]
): boolean {
  for (const existing of existingResults) {
    if (business.websiteUrl && existing.websiteUrl) {
      if (normalizeWebsiteUrl(business.websiteUrl) === normalizeWebsiteUrl(existing.websiteUrl)) {
        return true;
      }
    }
    
    if (business.phone && existing.phone) {
      if (normalizePhoneForDedup(business.phone) === normalizePhoneForDedup(existing.phone)) {
        return true;
      }
    }
    
    if (business.company && existing.company) {
      if (business.company.toLowerCase().trim() === existing.company.toLowerCase().trim()) {
        return true;
      }
    }
  }
  
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTACT DETAIL SOURCES
// Each source is searched (in parallel) when a business's email/phone is still
// missing after crawling their own website. Add new sources to this list to
// extend coverage — each just needs a name and a fetch function.
// ─────────────────────────────────────────────────────────────────────────────

type ContactDetailResult = { email?: string; phone?: string };
type ContactDetailSource = {
  name: string;
  fetch: (businessName: string, serpKey: string) => Promise<ContactDetailResult>;
};

/** Shared email/phone extractor used by all contact detail sources */
function extractContactDetails(rawText: string): ContactDetailResult {
  const NOISE_DOMAINS = [
    "example.com", "sentry.io", "wixpress.com", "w3.org", "schema.org",
    "cloudflare.com", "facebook.com", "yelp.com", "google.com",
    "bbb.org", "yellowpages.com", "angi.com", "thumbtack.com",
  ];
  const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  // Separators required; area code must start with 2-9 (valid US area codes)
  const PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]\d{3}[\s.-]\d{4}/g;

  // Strip script/style noise before parsing
  const cleaned = rawText
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");

  const decoded = cleaned
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/&#46;/gi, ".")
    .replace(/&amp;/gi, "&")
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(at\)\s*/gi, "@");

  const emailMatches = decoded.match(EMAIL_RE);
  const email = emailMatches?.find(
    e =>
      !salonEmailDomainRestriction(e) &&
      NOISE_DOMAINS.every(d => !e.includes(d)) &&
      !e.endsWith(".png") && !e.endsWith(".jpg") &&
      !e.endsWith(".gif") && !e.endsWith(".svg")
  ) ?? undefined;

  const phoneMatches = decoded.match(PHONE_RE);
  // Prefer a formatted-looking match (has punctuation/spaces) over a bare digit string
  const phone = (phoneMatches?.find(m => /[().\s-]/.test(m)) ?? phoneMatches?.[0]) as string | undefined;

  return { email, phone };
}

/** Helper: fetch a page URL and return its raw HTML (or null on failure) */
async function fetchPageHtml(url: string, userAgent?: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(14000),
    });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/** Helper: run a SerpAPI Google search and return result objects */
async function serpSearch(serpKey: string, query: string, num = 5): Promise<any[]> {
  try {
    const params = new URLSearchParams({ api_key: serpKey, engine: "google", q: query, num: String(num) });
    const r = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const data = await r.json() as any;
    return data.organic_results ?? [];
  } catch {
    return [];
  }
}

// ─── List of sources that may have the business's email/phone ────────────────

const CONTACT_DETAIL_SOURCES: ContactDetailSource[] = [
  // 1. Google — broad search; email often appears directly in result snippets
  {
    name: "Google",
    async fetch(businessName, serpKey) {
      const results = await serpSearch(serpKey, `"${businessName}" grooming email contact`, 5);
      const text = results.map((r: any) => `${r.title ?? ""} ${r.snippet ?? ""}`).join(" ");
      return extractContactDetails(text);
    },
  },

  // 2. Facebook — About section lists email, phone, and website
  {
    name: "Facebook",
    async fetch(businessName, serpKey) {
      const results = await serpSearch(serpKey, `site:facebook.com "${businessName}" grooming`, 3);
      const fbResult = results.find(
        (r: any) =>
          typeof r.link === "string" &&
          r.link.includes("facebook.com/") &&
          !r.link.includes("/search") &&
          !r.link.includes("/groups") &&
          !r.link.includes("/events")
      );
      if (!fbResult) return {};
      // Check snippet first (fastest)
      const snippetDetails = extractContactDetails(`${fbResult.title ?? ""} ${fbResult.snippet ?? ""}`);
      if (snippetDetails.email || snippetDetails.phone) return snippetDetails;
      // Fetch the actual page (Facebook externalhit UA gets About section)
      const html = await fetchPageHtml(
        fbResult.link,
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
      );
      return html ? extractContactDetails(html) : {};
    },
  },

  // 3. Yelp — business listing sometimes has contact email and always has phone
  {
    name: "Yelp",
    async fetch(businessName, serpKey) {
      const results = await serpSearch(serpKey, `site:yelp.com/biz "${businessName}" grooming`, 3);
      const yelpResult = results.find((r: any) => r.link?.includes("yelp.com/biz/"));
      if (!yelpResult) return {};
      const snippetDetails = extractContactDetails(`${yelpResult.title ?? ""} ${yelpResult.snippet ?? ""}`);
      if (snippetDetails.email || snippetDetails.phone) return snippetDetails;
      const html = await fetchPageHtml(yelpResult.link);
      return html ? extractContactDetails(html) : {};
    },
  },

  // 4. BBB — Principal Contacts and contact info are listed on profile pages
  {
    name: "BBB",
    async fetch(businessName, serpKey) {
      const results = await serpSearch(serpKey, `site:bbb.org/us "${businessName}" grooming`, 3);
      const bbbResult = results.find((r: any) => r.link?.includes("bbb.org") && r.link?.includes("/profile/"));
      if (!bbbResult) return {};
      const snippetDetails = extractContactDetails(`${bbbResult.title ?? ""} ${bbbResult.snippet ?? ""}`);
      if (snippetDetails.email || snippetDetails.phone) return snippetDetails;
      const html = await fetchPageHtml(bbbResult.link);
      return html ? extractContactDetails(html) : {};
    },
  },

  // 5. Yellow Pages — has business phone and sometimes email
  {
    name: "Yellow Pages",
    async fetch(businessName, serpKey) {
      const results = await serpSearch(serpKey, `site:yellowpages.com "${businessName}" grooming`, 3);
      const ypResult = results.find((r: any) => r.link?.includes("yellowpages.com/"));
      if (!ypResult) return {};
      const snippetDetails = extractContactDetails(`${ypResult.title ?? ""} ${ypResult.snippet ?? ""}`);
      if (snippetDetails.email || snippetDetails.phone) return snippetDetails;
      const html = await fetchPageHtml(ypResult.link);
      return html ? extractContactDetails(html) : {};
    },
  },
];

/**
 * Run all CONTACT_DETAIL_SOURCES in parallel and return the first email found
 * (and separately the first phone found), with which source provided each.
 */
async function findContactDetailsFromAlternativeSources(
  businessName: string,
): Promise<{ email?: string; emailSource?: string; phone?: string; phoneSource?: string }> {
  const serpKey = getSerpApiKey();
  if (!serpKey) return {};

  console.log(`[Discovery] Gap-fill: searching ${CONTACT_DETAIL_SOURCES.length} sources for "${businessName}"`);

  const results = await Promise.allSettled(
    CONTACT_DETAIL_SOURCES.map(async (source) => {
      const details = await source.fetch(businessName, serpKey);
      return { source: source.name, ...details };
    })
  );

  let email: string | undefined;
  let emailSource: string | undefined;
  let phone: string | undefined;
  let phoneSource: string | undefined;

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { source, email: e, phone: p } = result.value;
    if (e && !email) {
      email = e;
      emailSource = source;
      console.log(`[Discovery] Gap-fill: email "${e}" found via ${source}`);
    }
    if (p && !phone) {
      phone = p;
      phoneSource = source;
      console.log(`[Discovery] Gap-fill: phone "${p}" found via ${source}`);
    }
  }

  return { email, emailSource, phone, phoneSource };
}

// Representative ZIP codes for each US state (largest city)
export const STATE_ZIPS: Record<string, string> = {
  AL: "35203", AK: "99501", AZ: "85001", AR: "72201", CA: "90001",
  CO: "80202", CT: "06103", DE: "19801", FL: "33101", GA: "30301",
  HI: "96813", ID: "83702", IL: "60601", IN: "46202", IA: "50309",
  KS: "66101", KY: "40202", LA: "70112", ME: "04101", MD: "21201",
  MA: "02101", MI: "48201", MN: "55401", MS: "39201", MO: "63101",
  MT: "59601", NE: "68102", NV: "89101", NH: "03101", NJ: "07102",
  NM: "87101", NY: "10001", NC: "28202", ND: "58102", OH: "44101",
  OK: "73102", OR: "97201", PA: "19102", RI: "02903", SC: "29201",
  SD: "57101", TN: "37201", TX: "77001", UT: "84101", VT: "05601",
  VA: "23219", WA: "98101", WV: "25301", WI: "53202", WY: "82001",
};

const ALL_STATES = Object.keys(STATE_ZIPS);

/** National search: runs one SERP query per state, stores up to maxPerState results, tracks progress. */
export async function runNationalSearchJob(nationalJobId: string, userId: string): Promise<void> {
  const MAX_HOURLY_RETRIES = 10;
  const RETRY_WAIT_MS = 65_000; // wait 65 s when hourly limit hit

  // Helper: terminate the national job as failed — atomic, never overwrites cancelled
  async function failNationalJob(message: string, statesCompleted: number, leadsFound: number): Promise<void> {
    await storage.updateNationalSearchJobIfNotCancelled(nationalJobId, {
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
      statesCompleted,
      leadsFound,
    });
  }

  try {
    // FIX 1: Hard-stop if quota is already exhausted before we even begin
    const initialQuota = await getSerpUsageStatus();
    if (initialQuota.isQuotaReached) {
      await failNationalJob("SERP quota reached — upgrade required to run a national search.", 0, 0);
      return;
    }

    // Load the job record to get targeted search settings
    const jobRecord = await storage.getNationalSearchJob(nationalJobId, null);
    if (!jobRecord) {
      console.error(`[NationalSearch] Job ${nationalJobId} not found`);
      return;
    }

    // Resolve the state list and per-state cap from the job record
    const statesToSearch = jobRecord.targetStates
      ? jobRecord.targetStates.split(",").map(s => s.trim()).filter(Boolean)
      : ALL_STATES;
    const MAX_PER_STATE = jobRecord.maxPerState ?? 3;
    const NO_SOFTWARE_ONLY = jobRecord.noSoftwareOnly === "true";

    // FIX 3: Transition to running atomically — if the job was cancelled while pending,
    // the conditional update returns undefined and we stop without resurrecting it.
    const started = await storage.updateNationalSearchJobIfNotCancelled(nationalJobId, {
      status: "running",
      statesTotal: statesToSearch.length,
    });
    if (!started) {
      console.log(`[NationalSearch] Job ${nationalJobId} was cancelled before it could start — aborting.`);
      return;
    }

    let totalLeadsFound = 0;
    let statesCompleted = 0; // FIX 2: track completed states explicitly
    let searchInvocations=0;
    const searchCeiling=statesToSearch.length*3;

    for (let i = 0; i < statesToSearch.length; i++) {
      const stateCode = statesToSearch[i];
      const zip = STATE_ZIPS[stateCode];

      // FIX 3: Check for cancellation at start of each state — never overwrite cancelled
      const natJob = await storage.getNationalSearchJob(nationalJobId, null);
      if (natJob?.status === "cancelled") {
        console.log(`[NationalSearch] Cancelled at state ${stateCode}`);
        return; // exit immediately without touching status
      }

      // Create a sub-job for this state (for result grouping)
      const subJob = await storage.createLeadDiscoveryJob(
        {
          state: stateCode,
          zipCodes: zip,
          searchEngines: "google_maps",
          maxResultsPerZip: MAX_PER_STATE,
          status: "running",
          totalZipCodes: 1,
          processedZipCodes: 0,
          totalBusinessesFound: 0,
          duplicatesRemoved: 0,
        },
        userId,
        nationalJobId
      );

      const queryTemplate = DEFAULT_QUERIES[0]; // "Dog Groomer in {STATE}, Zip code {ZIP}"
      const query = queryTemplate.replace("{STATE}", stateCode).replace("{ZIP}", zip);

      let stateFound = 0;
      let retries = 0;
      let stateSucceeded = false; // FIX 2: track terminal success explicitly

      while (retries < MAX_HOURLY_RETRIES) {
        // FIX 1: Re-check quota before each attempt — quota exhaustion is a hard stop
        const quotaCheck = await getSerpUsageStatus();
        if (quotaCheck.isQuotaReached) {
          console.log(`[NationalSearch] Quota exhausted at state ${stateCode} — terminating job.`);
          await storage.updateLeadDiscoveryJob(subJob.id, {
            status: "failed",
            errorMessage: "SERP quota reached — national search stopped.",
            completedAt: new Date(),
          }, null);
          await failNationalJob(
            `SERP quota reached after ${statesCompleted} of ${statesToSearch.length} states. Export what was found so far.`,
            statesCompleted,
            totalLeadsFound,
          );
          return; // stop — don't mark as completed
        }

        // Check hourly rate limit
        const canRun = await canRunDiscovery(userId, 1, true);
        if (!canRun.allowed) {
          console.log(`[NationalSearch] Hourly rate limit for ${stateCode}, waiting ${RETRY_WAIT_MS / 1000}s… (retry ${retries + 1}/${MAX_HOURLY_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS));
          retries++;
          continue;
        }

        try {
          if(searchInvocations>=searchCeiling){
            await storage.updateNationalSearchJobIfNotCancelled(nationalJobId,{status:"failed",errorMessage:`The confirmed ${searchCeiling}-call allowance is exhausted. Saved results remain available; another search requires a new confirmation.`});
            return;
          }
          searchInvocations++;
          const { results: searchResults } = await searchWithSerpApi(query, zip, stateCode, queryTemplate);
          const existingResults: import("@shared/schema").LeadDiscoveryResult[] = [];

          for (const result of searchResults) {
            if (stateFound >= MAX_PER_STATE) break;
            if (!result.title || !result.link) continue;

            const businessData: BusinessData = {
              company: result.title,
              websiteUrl: result.link.startsWith("http") ? result.link : undefined,
              phone: result.phone,
              address: result.address,
            };

            if (isDuplicate(businessData, existingResults)) continue;

            // Crawl website for software detection
            let crawlData: Awaited<ReturnType<typeof crawlWebsite>> | null = null;
            let crawlStatus = "pending";
            let crawlError: string | undefined;
            if (businessData.websiteUrl) {
              try {
                crawlData = await crawlWebsite(businessData.websiteUrl);
                crawlStatus = crawlData.partialFailures.length ? "partial" : "completed";
              } catch (err) {
                crawlStatus = "failed";
                crawlError = err instanceof Error ? err.message : "Unknown error";
              }
            }

            const knownChain = checkKnownChain(businessData.company);
            let usesSoftware: string;
            let currentSoftware: string | null = crawlData?.softwareName || null;

            if (crawlData?.bookingUrl) {
              usesSoftware = "Yes";
            } else if (knownChain) {
              usesSoftware = "Yes";
              currentSoftware = currentSoftware || knownChain.software;
            } else if (crawlStatus === "failed" || !businessData.websiteUrl) {
              usesSoftware = "Unknown";
            } else if (hasSchedulingLanguage(crawlData?.html ?? "")) {
              usesSoftware = "Unknown";
            } else {
              usesSoftware = "No";
            }

            // No-software filter: when enabled, skip any lead that definitively uses software
            if (NO_SOFTWARE_ONLY && usesSoftware === "Yes") {
              console.log(`[NationalSearch] Skipping ${businessData.company} (uses ${currentSoftware || "software"}) — noSoftwareOnly filter`);
              continue;
            }

            const leadResult: import("@shared/schema").InsertLeadDiscoveryResult = {
              jobId: subJob.id,
              company: businessData.company,
              phone: crawlData?.phone || businessData.phone || null,
              email: crawlData?.email || null,
              address: businessData.address || null,
              firstName: crawlData?.ownerName?.split(" ")[0] || null,
              lastName: crawlData?.ownerName?.split(" ").slice(1).join(" ") || null,
              jobTitle: crawlData?.jobTitle || null,
              hasWebsite: businessData.websiteUrl ? "Yes" : "No",
              websiteUrl: crawlData?.resolvedWebsiteUrl || businessData.websiteUrl || null,
              bookingSoftwareUrl: crawlData?.bookingUrl || null,
              currentSoftware,
              usesSoftware,
              contactRequestFormUrl: crawlData?.contactFormUrl || null,
              leadSource: "Google Maps",
              notes: (() => {
                const notes: string[] = [];
                if (crawlError) notes.push(`Crawl failed: ${crawlError}`);
                if (crawlData?.email && crawlData.emailSourceUrl) notes.push(`Email source: ${crawlData.emailSourceUrl} (${crawlData.emailSourceType || "visible"})`);
                if (crawlData?.metadataEmail && crawlData.metadataEmailSourceUrl) notes.push(`Metadata-only email candidate (review only): ${crawlData.metadataEmail} — ${crawlData.metadataEmailSourceUrl}`);
                if (crawlData?.partialFailures.length) notes.push(`Partial crawl failures: ${crawlData.partialFailures.join("; ")}`);
                return withDirectoryNotes(notes.join(" | "), { directoryListing: {
                  categories: result.categories || [], name: result.title, address: result.address || null,
                  placeId: result.placeId || null, provider: "SerpAPI Google Maps", sourceUrl: result.link || null,
                } });
              })(),
              zipCode: zip,
              searchQuery: query,
              isDuplicate: "false",
              isImported: "false",
              crawlStatus,
              crawlError,
            };

            const saved = await storage.createLeadDiscoveryResult(leadResult, userId);
            existingResults.push(saved);
            stateFound++;
            totalLeadsFound++;
          }

          await storage.updateLeadDiscoveryJob(subJob.id, {
            status: "completed",
            completedAt: new Date(),
            processedZipCodes: 1,
            totalBusinessesFound: stateFound, // counts only saved (post-filter) results
          }, null);

          stateSucceeded = true;
          break; // success — move to next state
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);

          // FIX 1: Quota errors are a hard stop — do not retry
          if (msg.toLowerCase().includes("quota")) {
            console.log(`[NationalSearch] Quota error at ${stateCode} — terminating.`);
            await storage.updateLeadDiscoveryJob(subJob.id, {
              status: "failed",
              errorMessage: msg,
              completedAt: new Date(),
            }, null);
            await failNationalJob(
              `SERP quota reached after ${statesCompleted} of ${statesToSearch.length} states. Export what was found so far.`,
              statesCompleted,
              totalLeadsFound,
            );
            return;
          }

          if (msg.includes("Hourly SERP limit") || msg.includes("hourly")) {
            console.log(`[NationalSearch] SERP hourly error at ${stateCode}, waiting…`);
            await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS));
            retries++;
          } else {
            // Non-retryable, non-quota error: mark sub-job failed and move on
            console.error(`[NationalSearch] Search failed for ${stateCode}:`, msg);
            await storage.updateLeadDiscoveryJob(subJob.id, {
              status: "failed",
              errorMessage: msg,
              completedAt: new Date(),
            }, null);
            break;
          }
        }
      }

      // FIX 2: Only count state as completed when it had a definite terminal outcome.
      // Retry-exhausted states leave stateSucceeded=false and are NOT counted.
      if (!stateSucceeded && retries >= MAX_HOURLY_RETRIES) {
        const errorMsg = `Hourly rate-limit retry limit exceeded for state ${stateCode} — state skipped.`;
        console.error(`[NationalSearch] ${errorMsg}`);
        await storage.updateLeadDiscoveryJob(subJob.id, {
          status: "failed",
          errorMessage: errorMsg,
          completedAt: new Date(),
        }, null);
        // Update leads count but don't increment statesCompleted
        await storage.updateNationalSearchJob(nationalJobId, { leadsFound: totalLeadsFound });
      } else if (stateSucceeded) {
        statesCompleted++;
        await storage.updateNationalSearchJob(nationalJobId, { statesCompleted, leadsFound: totalLeadsFound });
      } else {
        // Non-retryable failure — still count as "processed" so progress advances
        statesCompleted++;
        await storage.updateNationalSearchJob(nationalJobId, { statesCompleted, leadsFound: totalLeadsFound });
      }

      // Small polite delay between states
      if (i < statesToSearch.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }

    // FIX 3: Use atomic conditional update — silently skips if job was cancelled
    await storage.updateNationalSearchJobIfNotCancelled(nationalJobId, {
      status: "completed",
      completedAt: new Date(),
      statesCompleted,
      leadsFound: totalLeadsFound,
    });
  } catch (error) {
    console.error("[NationalSearch] Unhandled error:", error);
    // FIX 3: Never overwrite cancelled status (atomic)
    await failNationalJob(
      error instanceof Error ? error.message : "Unknown error",
      0,
      0,
    );
  }
}

export async function runLeadDiscoveryJob(jobId: string, userId: string): Promise<void> {
  const job = await storage.getLeadDiscoveryJob(jobId, null);
  if (!job) {
    throw new Error("Job not found");
  }

  try {
    await storage.updateLeadDiscoveryJob(jobId, {
      status: "running",
      startedAt: new Date(),
    }, null);

    const zipCodes = job.zipCodes.split(",").map(z => z.trim()).filter(z => z);
    const state = job.state;
    
    // Get active queries based on config (2 default, 3rd optional)
    const activeQueries = await getActiveQueries();

    const allResults: LeadDiscoveryResult[] = [];
    let totalFound = 0;
    let duplicatesRemoved = 0;

    for (let zipIndex = 0; zipIndex < zipCodes.length; zipIndex++) {
      const zip = zipCodes[zipIndex];
      
      const currentJob = await storage.getLeadDiscoveryJob(jobId, null);
      if (currentJob?.status === "cancelled") {
        break;
      }

      // Check quota and hourly limits during execution (skip daily check since job already started)
      const canRun = await canRunDiscovery(userId, 1, true);
      if (!canRun.allowed) {
        console.log(`Stopping job: ${canRun.reason}`);
        await storage.updateLeadDiscoveryJob(jobId, {
          status: "failed",
          errorMessage: canRun.reason,
        }, null);
        return;
      }

      for (const queryTemplate of activeQueries) {
        const query = queryTemplate
          .replace("{STATE}", state)
          .replace("{ZIP}", zip);

        try {
          // Use Google Maps engine with caching
          const { results: searchResults, fromCache } = await searchWithSerpApi(query, zip, state, queryTemplate);
          
          if (fromCache) {
            console.log(`Using cached results for ${zip}`);
          }
          
          for (const result of searchResults) {
              if (!result.title || !result.link) continue;
              
              const businessData: BusinessData = {
                company: result.title,
                websiteUrl: result.link.startsWith("http") ? result.link : undefined,
                phone: result.phone,
                address: result.address,
              };

              if (isDuplicate(businessData, allResults)) {
                duplicatesRemoved++;
                continue;
              }

              let crawlData: Awaited<ReturnType<typeof crawlWebsite>> | null = null;
              let crawlStatus = "pending";
              let crawlError: string | undefined;

              if (businessData.websiteUrl) {
                try {
                  crawlData = await crawlWebsite(businessData.websiteUrl);
                  crawlStatus = crawlData.partialFailures.length ? "partial" : "completed";
                } catch (err) {
                  crawlStatus = "failed";
                  crawlError = err instanceof Error ? err.message : "Unknown error";
                }
              }

              // Gap-fill: if email or phone is still missing after website crawl,
              // run all CONTACT_DETAIL_SOURCES in parallel to find them.
              const needsEmail = !crawlData?.email;
              const needsPhone = !crawlData?.phone && !businessData.phone;
              let gapFillEmail: string | undefined;
              let gapFillEmailSource: string | undefined;
              let gapFillPhone: string | undefined;
              let gapFillPhoneSource: string | undefined;
              if (needsEmail || needsPhone) {
                const gapFill = await findContactDetailsFromAlternativeSources(businessData.company);
                if (needsEmail && gapFill.email) {
                  gapFillEmail = gapFill.email;
                  gapFillEmailSource = gapFill.emailSource;
                }
                if (needsPhone && gapFill.phone) {
                  gapFillPhone = gapFill.phone;
                  gapFillPhoneSource = gapFill.phoneSource;
                }
              }

              // Determine software classification with improved logic
              const knownChain = checkKnownChain(businessData.company);
              let usesSoftware: string;
              let currentSoftware: string | null = crawlData?.softwareName || null;
              let classificationNote: string | null = null;

              if (crawlData?.bookingUrl) {
                // Found a recognizable booking link — confirmed Yes
                usesSoftware = "Yes";
              } else if (knownChain) {
                // Known enterprise chain — always uses software, even if not detectable via crawl
                usesSoftware = "Yes";
                currentSoftware = currentSoftware || knownChain.software;
                classificationNote = "Known enterprise chain — uses internal booking system";
              } else if (crawlStatus === "failed" || !businessData.websiteUrl) {
                // Couldn't crawl — can't determine
                usesSoftware = "Unknown";
              } else if (hasSchedulingLanguage(crawlData?.html ?? "")) {
                // Page has scheduling/booking language but no recognized system — probably uses something we can't detect
                usesSoftware = "Unknown";
                classificationNote = "Scheduling language found on site but specific software not identified";
              } else {
                // Crawl completed, no booking signals found — likely no online booking
                usesSoftware = "No";
              }

              const leadResult: InsertLeadDiscoveryResult = {
                jobId,
                company: businessData.company,
                phone: crawlData?.phone || businessData.phone || gapFillPhone || null,
                email: crawlData?.email || gapFillEmail || null,
                address: businessData.address || null,
                firstName: crawlData?.ownerName?.split(" ")[0] || null,
                lastName: crawlData?.ownerName?.split(" ").slice(1).join(" ") || null,
                jobTitle: crawlData?.jobTitle || null,
                hasWebsite: businessData.websiteUrl ? "Yes" : "No",
                websiteUrl: crawlData?.resolvedWebsiteUrl || businessData.websiteUrl || null,
                bookingSoftwareUrl: crawlData?.bookingUrl || null,
                currentSoftware,
                usesSoftware,
                contactRequestFormUrl: crawlData?.contactFormUrl || null,
                leadSource: "Google Maps",
                notes: (() => {
                  const parts: string[] = [];
                  if (crawlError) parts.push(`Crawl failed: ${crawlError}`);
                  else if (classificationNote) parts.push(classificationNote);
                  else if (crawlData?.softwareName === "Unknown") parts.push("Booking link detected but software unclear");
                  if (gapFillEmail && gapFillEmailSource) parts.push(`Email found via ${gapFillEmailSource}`);
                  if (crawlData?.email && crawlData.emailSourceUrl) parts.push(`Email source: ${crawlData.emailSourceUrl} (${crawlData.emailSourceType || "visible"})`);
                  if (crawlData?.metadataEmail && crawlData.metadataEmailSourceUrl) {
                    parts.push(`Metadata-only email candidate (review only): ${crawlData.metadataEmail} — ${crawlData.metadataEmailSourceUrl}`);
                  }
                  if (crawlData?.partialFailures.length) parts.push(`Partial crawl failures: ${crawlData.partialFailures.join("; ")}`);
                  if (gapFillPhone && gapFillPhoneSource) parts.push(`Phone found via ${gapFillPhoneSource}`);
                  return withDirectoryNotes(parts.join(" | "), { directoryListing: {
                    categories: result.categories || [], name: result.title, address: result.address || null,
                    placeId: result.placeId || null, provider: "SerpAPI Google Maps", sourceUrl: result.link || null,
                  } });
                })(),
                zipCode: zip,
                searchQuery: query,
                isDuplicate: "false",
                isImported: "false",
                crawlStatus,
                crawlError,
              };

              const savedResult = await storage.createLeadDiscoveryResult(leadResult, userId);
              allResults.push(savedResult);
              totalFound++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (err) {
            console.error(`Search failed for query "${query}":`, err);
            // NO automatic retries - log and continue
          }
      }

      await storage.updateLeadDiscoveryJob(jobId, {
        processedZipCodes: zipIndex + 1,
        totalBusinessesFound: totalFound,
        duplicatesRemoved,
      }, null);
    }

    await storage.updateLeadDiscoveryJob(jobId, {
      status: "completed",
      completedAt: new Date(),
      totalBusinessesFound: totalFound,
      duplicatesRemoved,
    }, null);

  } catch (error) {
    console.error("Lead discovery job failed:", error);
    await storage.updateLeadDiscoveryJob(jobId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      completedAt: new Date(),
    }, null);
  }
}

export async function importResultsToCRM(
  resultIds: string[],
  userId: string
): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;
  const importedContactIds: string[] = [];

  for (const resultId of resultIds) {
    try {
      const leadResult = await storage.getLeadDiscoveryResultById(resultId);
      
      if (!leadResult) {
        errors.push(`Result ${resultId} not found`);
        continue;
      }
      if (leadResult.userId !== userId) {
        errors.push(`Result ${resultId} not found`);
        continue;
      }
      if (directoryEligibility(leadResult).blocked) {
        errors.push(`${leadResult.company || resultId}: grooming suitability needs human confirmation or is excluded`);
        continue;
      }

      if (leadResult.isImported === "true") {
        errors.push(`Result ${resultId} already imported`);
        continue;
      }

      const parsedAddr = parseAddressString(leadResult.address);

      const contact = await storage.createContact({
        firstName: leadResult.firstName || leadResult.company?.split(" ")[0] || "Unknown",
        lastName: leadResult.lastName || leadResult.company?.split(" ").slice(1).join(" ") || "Business",
        email: leadResult.email,
        phone: leadResult.phone,
        phoneWork: leadResult.phone,
        address: parsedAddr.street,
        city: parsedAddr.city,
        state: parsedAddr.state,
        zipCode: parsedAddr.zip ?? leadResult.zipCode ?? null,
        company: leadResult.company,
        jobTitle: leadResult.jobTitle,
        usesSoftware: leadResult.usesSoftware ?? "Unknown",
        currentSoftware: leadResult.currentSoftware,
        bookingSoftwareUrl: leadResult.bookingSoftwareUrl,
        hasWebsite: leadResult.hasWebsite,
        websiteUrl: leadResult.websiteUrl,
        contactRequestFormUrl: leadResult.contactRequestFormUrl,
        leadSource: leadResult.leadSource,
        notes: leadResult.notes,
        status: "active",
      }, userId);

      importedContactIds.push(contact.id);
      imported++;
    } catch (err) {
      errors.push(`Failed to import ${resultId}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (resultIds.length > 0 && importedContactIds.length > 0) {
    await storage.markResultsAsImported(
      resultIds.slice(0, importedContactIds.length), 
      importedContactIds, 
      null
    );
  }

  return { imported, errors };
}
