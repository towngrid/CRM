import { lookup } from "node:dns/promises";
import { hostedSalonPath, sameSalonWebsite, salonRelativePage } from "@shared/salonWebsiteScope";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { randomUUID } from "node:crypto";
import type { SalonEnrichmentRow } from "@shared/schema";
import {
  EMPTY_OWNER_NAME_RESULT,
  AI_OVERVIEW_TOKEN_NOTICE,
  isStrongApprovedOwnerCandidate,
  type OwnerNameResult,
  type SalonOwnerNameCandidate,
  type SalonOwnerNameSource,
} from "@shared/salonOwnerName";
import { storage } from "./storage";
import { providerHourlyLimit, type SerpRequestPolicy } from "./serpRequestPolicy";
import { readSerpProviderResponse } from "./serpProviderResponse";
import { isResearchDirectoryRow, RESEARCH_READ_ONLY } from "./salonResearchPolicy";
import { getSerpUsageStatus } from "./lead-discovery";
import { ownerDiscoveryLocation, ownerInterviewDiscoveryText, prioritizeOwnerResults } from "./salonOwnerDiscovery";
import { mentionsOwnerBusiness } from "@shared/salonOwnerDiscoveryRelevance";
import { parseOwnerSearchResponse, readOwnerSearchCache, type OwnerSearchResult } from "./salonOwnerSearchResults";

const MAX_ROWS_PER_REQUEST = 5;
const MAX_PAGES_PER_ROW = 4;
const MAX_PAGE_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 9_000;
const PROVIDER_TIMEOUT_MS = 30_000;
const LOOKUP_TIMEOUT_MS = 90_000;
const MAX_SEARCHES_PER_ROW = 3;
const MAX_REDIRECTS = 3;
const ownerSearchLocks = new Map<string, Promise<void>>();

type SalonIdentity = Pick<
  SalonEnrichmentRow,
  "businessName" | "address" | "address1" | "city" | "state" | "zipCode" | "websiteUrl"
>;

type OrganicResult = OwnerSearchResult;
type OwnerLookupProgress = {
  calls: number;
  beforeProvider?: () => Promise<void>;
  requestPolicy?: SerpRequestPolicy;
  candidates: SalonOwnerNameCandidate[];
  pages: { count: number; attempted: number };
};
const newOwnerLookupProgress = (): OwnerLookupProgress => ({
  calls: 0, candidates: [], pages: { count: 0, attempted: 0 },
});

function normalized(value: string | null | undefined): string {
  return (value || "").toLocaleLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function isNameToken(value: string): boolean {
  return /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*$/.test(value);
}

// Patterns intentionally remain case-sensitive: /i made words such as
// "Contact Us" look like names and allowed captures to run into navigation.
// A terminal period stays outside the capture so the following sentence can
// never be consumed as a surname (e.g. "Owner: Jane. Sarah Smith ...").
const NAME_WORD = "[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]*(?:\\.[A-Za-zÀ-ÖØ-öø-ÿ'’-]+)*";
const NAME_INITIAL = "[A-ZÀ-ÖØ-Þ]\\.(?=[ \\t]+[A-ZÀ-ÖØ-Þ])";
const NAME_PART = `(?:${NAME_INITIAL}|${NAME_WORD})`;
const NAME = `${NAME_PART}(?:[ \\t]+${NAME_PART}){0,2}`;
const roleWord = (word: string) => Array.from(word, character =>
  /[a-z]/i.test(character) ? `[${character.toLocaleLowerCase()}${character.toLocaleUpperCase()}]` : character,
).join("");
const OWNER_ROLE = roleWord("owner");
const PROPRIETOR_ROLE = roleWord("proprietor");
const CO_OWNER_ROLE = `${roleWord("co")}-${OWNER_ROLE}`;
const CO_OWNERS_ROLE = `${CO_OWNER_ROLE}s`;
const OWNERS_ROLE = `${OWNER_ROLE}s`;
const ARE_ROLE = roleWord("are");
const FOUNDER_ROLE = roleWord("founder");
const FOUNDED_ROLE = roleWord("founded");
const CO_FOUNDED_ROLE = `${roleWord("co")}-${FOUNDED_ROLE}`;
const GROOMER_ROLE = roleWord("groomer");
const STYLIST_ROLE = roleWord("stylist");
const OPERATOR_ROLE = roleWord("operator");
const OWNER_OPERATOR_ROLE = `${OWNER_ROLE}[ \\t]*(?:/|-|—|&|${roleWord("and")})[ \\t]*${OPERATOR_ROLE}`;
const MANAGER_ROLE = roleWord("manager");
const STAFF_MEMBER_ROLE = `${roleWord("staff")} ${roleWord("member")}`;
const TEAM_MEMBER_ROLE = `${roleWord("team")} ${roleWord("member")}`;
const EMPLOYEE_ROLE = roleWord("employee");
const OWNER_PHRASES = [
  ...[["owner", OWNER_ROLE], ["founder", FOUNDER_ROLE], ["proprietor", PROPRIETOR_ROLE]].map(([role, word]) => ({
    pattern: new RegExp(`\\b${roleWord("my name is")}[ \\t]+(${NAME})[ \\t]*,?[ \\t]+(?:${roleWord("and")}[ \\t]+)?I(?:['’]m|[ \\t]+${roleWord("am")})[ \\t]+(?:${roleWord("the")}[ \\t]+)?${word}\\b(?:[ \\t]+${roleWord("of")}[ \\t]+([^\\n.!?]{1,180}))?`, "g"),
    role,
    businessAssociation: true,
  })),
  { pattern: new RegExp(`\\b${OWNER_OPERATOR_ROLE}[ \\t]*(?:${roleWord("is")}[ \\t]+|[:—-][ \\t]*)?(${NAME})`, "g"), role: "owner/operator" },
  { pattern: new RegExp(`\\b(${NAME})[ \\t]+(?:[,—-][ \\t]*)?(?:${roleWord("is")}[ \\t]+)?(?:${roleWord("the")}[ \\t]+)?${OWNER_OPERATOR_ROLE}\\b`, "g"), role: "owner/operator" },
  { pattern: new RegExp(`\\b(?:${roleWord("owned and operated by")}|${roleWord("owned by")})[ \\t]+(${NAME})`, "g"), role: "owner" },
  { pattern: new RegExp(`\\b(?:${OWNER_ROLE}|${PROPRIETOR_ROLE}|${CO_OWNER_ROLE})[ \\t]*(?:${roleWord("is")}|:|—|-)[ \\t]*(${NAME})`, "g"), role: "owner" },
  { pattern: new RegExp(`\\b(?:${OWNER_ROLE}|${PROPRIETOR_ROLE}|${CO_OWNER_ROLE})[ \\t]+(${NAME})(?=[ \\t]*(?:${roleWord("is")}\\b|[,.;!?]|$))`, "g"), role: "owner" },
  { pattern: new RegExp(`\\b${FOUNDER_ROLE}(?:[ \\t]*(?:&|${roleWord("and")})[ \\t]*(?:${GROOMER_ROLE}|${STYLIST_ROLE}|${OPERATOR_ROLE}|${MANAGER_ROLE}))?[ \\t]*(?::|—|-)?[ \\t]+(${NAME})`, "g"), role: "founder" },
  { pattern: new RegExp(`\\b(?:${FOUNDED_ROLE}|${CO_FOUNDED_ROLE}) by[ \\t]+(${NAME})`, "g"), role: "founder" },
  { pattern: new RegExp(`\\b(${NAME})[ \\t]+${roleWord("is")}[ \\t]+(?:${roleWord("the")}[ \\t]+)?(?:${CO_OWNER_ROLE}|${OWNER_ROLE})\\b`, "g"), role: "owner" },
  { pattern: new RegExp(`\\b(${NAME})[ \\t]+(?:${roleWord("is")}[ \\t]+)?(?:${roleWord("the")}[ \\t]+)?${FOUNDER_ROLE}(?:[ \\t]*(?:&|${roleWord("and")})[ \\t]*(?:${GROOMER_ROLE}|${STYLIST_ROLE}|${OPERATOR_ROLE}|${MANAGER_ROLE}))?\\b`, "g"), role: "founder" },
  { pattern: new RegExp(`\\b(${NAME})[ \\t]+(?:${roleWord("is")}[ \\t]+)?(?:${roleWord("the")}[ \\t]+)?(?:${PROPRIETOR_ROLE}|${OWNER_ROLE}|${CO_OWNER_ROLE})(?:[ \\t]*(?:&|${roleWord("and")})[ \\t]*(?:${GROOMER_ROLE}|${STYLIST_ROLE}|${OPERATOR_ROLE}|${MANAGER_ROLE}))?\\b`, "g"), role: "owner" },
  { pattern: new RegExp(`\\b(${NAME})[ \\t]*,?[ \\t]*(?:${roleWord("the")}[ \\t]+)?(?:${OWNER_ROLE}|${PROPRIETOR_ROLE}|${FOUNDER_ROLE}|${CO_OWNER_ROLE})\\b`, "g"), role: "owner" },
];
const STAFF_PHRASES = [
  { pattern: new RegExp(`\\b(?:${GROOMER_ROLE}|salon ${MANAGER_ROLE}|${MANAGER_ROLE}|${STAFF_MEMBER_ROLE}|${TEAM_MEMBER_ROLE}|${EMPLOYEE_ROLE})[ \\t]*(?:${roleWord("is")}|:|—|-)[ \\t]*(${NAME})`, "g"), role: "staff member" },
  { pattern: new RegExp(`\\b(${NAME})[ \\t]+(?:${roleWord("is")}[ \\t]+(?:(?:${roleWord("a")}|${roleWord("our")})[ \\t]+)?|${roleWord("our")}[ \\t]+)(?:${GROOMER_ROLE}|salon ${MANAGER_ROLE}|${MANAGER_ROLE}|${STAFF_MEMBER_ROLE}|${TEAM_MEMBER_ROLE}|${EMPLOYEE_ROLE})\\b`, "g"), role: "staff member" },
];
const IGNORED_NAMES = new Set([
  "the owner", "our owner", "business owner", "pet grooming", "dog grooming",
  "grooming salon", "salon owner", "meet our", "our team",
]);
const NON_PERSON_NAME_TOKENS = new Set([
  "the", "our", "business", "pet", "dog", "salon", "grooming", "team", "staff",
  "owner", "founder", "manager", "groomer", "professional", "services", "service", "contact",
  "us", "about", "home", "book", "booking", "login", "menu", "more", "support",
  "read", "reviews", "review", "reviewer", "reviewers", "testimonials", "testimonial",
  "customer", "customers", "client", "clients", "employee", "employees", "appointment",
  "appointments", "hours", "faq", "welcome", "click", "here", "meet", "former",
  "formerly", "previous", "previously", "was", "were", "not", "ex",
  "i", "i'm", "i’m", "i've", "i’ve", "my", "we", "we're", "we’re", "he", "she", "they", "you",
]);

function normalizedPersonName(
  rawName: string,
  allowFirstOnly: boolean,
  businessName?: string,
): { firstName: string; lastName: string | null } | null {
  const pieces = rawName.trim().split(/\s+/).map(piece => piece.replace(/[.,;:!?]+$/g, ""));
  // Stop greedy captures at common navigation/role words, retaining an
  // explicit first name such as "Owner: Jacqueline Contact Us".
  while (pieces.length > 1 && NON_PERSON_NAME_TOKENS.has(normalized(pieces[pieces.length - 1]))) pieces.pop();
  while (pieces.length > 1 && !isNameToken(pieces[pieces.length - 1]) &&
         /^[a-z][a-z'’.-]*$/.test(pieces[pieces.length - 1])) {
    pieces.pop();
  }
  if (pieces.length < 1 || pieces.length > 3 || (!allowFirstOnly && pieces.length < 2)) return null;
  if (!pieces.every(isNameToken)) return null;
  if (pieces.some(piece => NON_PERSON_NAME_TOKENS.has(piece.toLocaleLowerCase()))) return null;
  const clean = pieces.map(piece => piece.charAt(0).toLocaleUpperCase() + piece.slice(1));
  const full = normalized(clean.join(" "));
  if (IGNORED_NAMES.has(full) || clean.some(part => ["Owner", "Founder", "Manager", "Team", "Staff", "Groomer"].includes(part))) return null;
  const businessTokens = new Set(normalized(businessName).split(" ").filter(Boolean));
  if ((clean.length === 1 && businessTokens.has(normalized(clean[0]))) ||
      (businessTokens.size > 1 && full === normalized(businessName))) return null;
  return { firstName: clean[0], lastName: clean.length > 1 ? clean.slice(1).join(" ") : null };
}

function excerptAround(text: string, value: string): string {
  const index = text.toLocaleLowerCase().indexOf(value.toLocaleLowerCase());
  if (index < 0) return text.slice(0, 260).trim();
  return text.slice(Math.max(0, index - 100), Math.min(text.length, index + value.length + 160))
    .replace(/\s+/g, " ").trim();
}

function ownerRoleContextIsUnverified(text: string, position: number, matchText: string): boolean {
  const start = Math.max(
    text.lastIndexOf(".", position - 1),
    text.lastIndexOf("!", position - 1),
    text.lastIndexOf("?", position - 1),
    text.lastIndexOf("\n", position - 1),
  ) + 1;
  const previousLineStart = text.lastIndexOf("\n", Math.max(0, start - 2)) + 1;
  const context = `${text.slice(previousLineStart, start)} ${text.slice(start, position)}`.toLocaleLowerCase();
  const suffix = text.slice(position + matchText.length, position + matchText.length + 100).toLocaleLowerCase();
  return /\b(?:reviews?|reviewers?|customer|client|neighbor|guest|testimonials?|according to|formerly|previously|former|ex-|was|were|not|staff|team member|employee)\b/.test(context) ||
    /\b(?:was|were)\s+(?:the\s+)?(?:owner|founder|proprietor)\b|\b(?:former|previous|ex-|no longer)\s+(?:the\s+)?(?:owner|founder|proprietor)\b/.test(suffix) ||
    /\b(?:was|were|formerly|previously|former|ex-|not)\b/i.test(matchText);
}

function candidateId(firstName: string, lastName: string | null): string {
  return `owner-${normalized(`${firstName} ${lastName || ""}`).replace(/\s+/g, "-")}`;
}

export function businessAndLocationMatch(identity: SalonIdentity, text: string): boolean {
  const content = normalized(text);
  const business = normalized(identity.businessName);
  const businessPattern = business.split(" ").map(token => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  if (!business) return false;
  const longerBrandSuffixes = new Set([
    "grooming", "groomers", "salon", "spa", "pet", "boutique", "company", "co",
    "llc", "inc", "incorporated", "ltd", "limited", "group", "academy", "center",
  ]);
  const businessMatch = Array.from(content.matchAll(new RegExp(`(?:^|\\s)${businessPattern}(?:\\s|$)`, "g")))
    .find(match => {
      const suffix = content.slice((match.index || 0) + match[0].length).trim().split(/\s+/)[0];
      return !longerBrandSuffixes.has(suffix);
    });
  if (!businessMatch) return false;

  let address = (identity.address1 || identity.address || "").trim().split(",")[0]
    .replace(/\b(?:suite|ste|unit|apt|apartment|#)\s*[\w-]+.*$/i, "").trim();
  if (!identity.address1 && address && /^\d/.test(address) && !/\b(?:st|street|dr|drive|rd|road|ave|avenue|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|hwy|highway)\b/i.test(address)) {
    const streetAddressMatch = address.match(/^\s*\d+[a-z]?(?:\s+[\w'-]+){0,4}\s+\b(?:st|street|dr|drive|rd|road|ave|avenue|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|hwy|highway)\b/i);
    address = streetAddressMatch ? streetAddressMatch[0] : "";
  } else if (!identity.address1 && !/^\s*\d/.test(address) &&
             !/\b(?:st|street|dr|drive|rd|road|ave|avenue|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|hwy|highway)\b/i.test(address)) {
    address = "";
  }
  const replacements: Record<string, string> = {
    e: "east", w: "west", n: "north", s: "south",
    street: "st", drive: "dr", road: "rd", avenue: "ave", boulevard: "blvd",
    lane: "ln", court: "ct", parkway: "pkwy", highway: "hwy",
  };
  const canonical = (value: string) => normalized(value).split(" ").filter(Boolean).map(token => replacements[token] || token);
  const contentWords = canonical(text);
  const addressWords = canonical(address);
  const hasFullStreetOrLocality = (addressWords.length > 0 && (!!identity.city || !!identity.zipCode)) ||
    (!!identity.city && !!identity.state && !!identity.zipCode);
  if (!hasFullStreetOrLocality) return false;
  const streetMatches = !addressWords.length || contentWords.some((_, index) =>
    addressWords.every((word, offset) => contentWords[index + offset] === word),
  );
  const hasPhrase = (value: string | null | undefined) => {
    const words = canonical(value || "");
    return !words.length || contentWords.some((_, index) =>
      words.every((word, offset) => contentWords[index + offset] === word),
    );
  };
  const zip = (identity.zipCode || "").trim();
  const zipMatch = !zip || new RegExp(`(?:^|\\D)${zip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\D|$)`).test(text);
  const cityMatch = hasPhrase(identity.city);
  const state = normalized(identity.state);
  const stateName = ({
    al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
    co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
    hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
    ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
    ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
    mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
    nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
    nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
    ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee",
    tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
    wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
  } as Record<string, string>)[state];
  const stateMatch = !state || contentWords.includes(state) ||
    (!!stateName && hasPhrase(stateName));
  const compact = content.replace(/\s/g, "");
  const compactCity = normalized(identity.city).replace(/\s/g, "");
  const compactStateOptions = [state, stateName || ""].filter(Boolean).map(value => value.replace(/\s/g, ""));
  const compactFullLocation = !!compactCity && compactStateOptions.some(stateValue =>
    compact.includes(`${compactCity}${stateValue}${zip}`),
  );
  // A known street, city, state and ZIP form one identity. A shared ZIP or
  // metro never overrides a missing/different street.
  return streetMatches && (cityMatch || compactFullLocation) &&
    (stateMatch || compactFullLocation) && zipMatch;
}

function businessLocationExcerpt(identity: SalonIdentity, text: string): string {
  const businessIndex = text.toLocaleLowerCase().indexOf(identity.businessName.toLocaleLowerCase());
  const location = (identity.address1 || identity.address || identity.zipCode || identity.city || "").trim();
  const locationIndex = location ? text.toLocaleLowerCase().indexOf(location.toLocaleLowerCase()) : -1;
  const excerpts = [
    businessIndex >= 0 ? text.slice(Math.max(0, businessIndex - 50), businessIndex + identity.businessName.length + 90) : "",
    locationIndex >= 0 ? text.slice(Math.max(0, locationIndex - 50), locationIndex + location.length + 90) : "",
  ].filter(Boolean).map(value => value.replace(/\s+/g, " ").trim());
  return excerpts.join(" … ");
}

function collectCandidates(
  text: string,
  source: SalonOwnerNameSource,
  businessMatched: boolean,
  allowFirstOnly: boolean,
  summariesAreUnconfirmed: boolean,
  businessName?: string,
): SalonOwnerNameCandidate[] {
  const discovered: SalonOwnerNameCandidate[] = [];
  const collect = (patterns: Array<{ pattern: RegExp; role: string; businessAssociation?: boolean }>, confirmed: boolean) => {
    for (const { pattern, role, businessAssociation } of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text))) {
        if (businessAssociation && match[2] && businessName) {
          const namedBusinesses = match[2].split(/\s+(?:and|in|at|&)\s+|[,;|]/i).map(normalized);
          if (!namedBusinesses.includes(normalized(businessName))) continue;
        }
        const person = normalizedPersonName(match[1], allowFirstOnly, businessName);
        if (!person) continue;
        const roleConfirmed = confirmed && !summariesAreUnconfirmed && businessMatched &&
          !ownerRoleContextIsUnverified(text, match.index ?? 0, match[0]);
        const sourceExcerpt = excerptAround(text, match[0]);
        const candidate: SalonOwnerNameCandidate = {
          id: candidateId(person.firstName, person.lastName),
          ...person,
          role: roleConfirmed ? role : summariesAreUnconfirmed ? "Unconfirmed search-result mention" : role,
          roleConfirmed,
          businessMatched,
          confidence: roleConfirmed ? "high" : businessMatched ? "medium" : "low",
          sources: [{ ...source, excerpt: [sourceExcerpt, source.excerpt].filter(Boolean).join(" | ").slice(0, 800) }],
        };
        const prior = discovered.find(item => item.id === candidate.id);
        if (prior) {
          prior.sources.push(...candidate.sources);
          prior.roleConfirmed = prior.roleConfirmed || candidate.roleConfirmed;
          prior.businessMatched = prior.businessMatched || candidate.businessMatched;
          if (prior.roleConfirmed && prior.businessMatched) prior.confidence = "high";
        } else {
          discovered.push(candidate);
        }
      }
    }
  };
  collect(OWNER_PHRASES, true);
  collect(STAFF_PHRASES, false);

  // Explicit co-owner pair phrases are parsed independently so the conjunction
  // cannot be mistaken for a third token in one person's surname.
  const strictName = `${NAME_PART}(?:[ \\t]+${NAME_PART})?`;
  const pairPatterns = [
    new RegExp(`\\b(${strictName})\\s+(?:${roleWord("and")}|&)\\s+(${strictName})\\s+(?:${ARE_ROLE}\\s+)?(?:${CO_OWNERS_ROLE}|${OWNERS_ROLE})\\b`, "g"),
    new RegExp(`\\b(?:${CO_OWNERS_ROLE}|${OWNERS_ROLE})\\s*(?:${ARE_ROLE}|:|—|-)?\\s*(${strictName})\\s+(?:${roleWord("and")}|&)\\s+(${strictName})(?=\\s*(?:${ARE_ROLE}\\b|${CO_OWNERS_ROLE}\\b|[,.;]|$))`, "g"),
    new RegExp(`\\b(?:${roleWord("owned by")}|${FOUNDED_ROLE} by|${CO_FOUNDED_ROLE} by)\\s+(${strictName})\\s+(?:${roleWord("and")}|&)\\s+(${strictName})(?=\\s*(?:${ARE_ROLE}\\b|${roleWord("both")}\\b|[,.;]|$))`, "g"),
    new RegExp(`\\b(${NAME})\\s+(?:${roleWord("and")}|&)\\s+(${NAME})\\s+(?:${ARE_ROLE}\\s+)?(?:${CO_OWNERS_ROLE}|${OWNERS_ROLE})\\b`, "g"),
    new RegExp(`\\b(?:${CO_OWNERS_ROLE}|${OWNERS_ROLE})\\s*(?:${ARE_ROLE}|:|—|-)?\\s*(${NAME})\\s+(?:${roleWord("and")}|&)\\s+(${NAME})(?=\\s*(?:${ARE_ROLE}\\b|${CO_OWNERS_ROLE}\\b|[,.;]|$))`, "g"),
    new RegExp(`\\b(?:${roleWord("owned by")}|${FOUNDED_ROLE} by|${CO_FOUNDED_ROLE} by)\\s+(${NAME})\\s+(?:${roleWord("and")}|&)\\s+(${NAME})(?=\\s*(?:${ARE_ROLE}\\b|${roleWord("both")}\\b|[,.;]|$))`, "g"),
  ];
  for (const pattern of pairPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      for (const rawName of [match[1], match[2]]) {
        const person = normalizedPersonName(rawName, allowFirstOnly, businessName);
        if (!person) continue;
        const roleConfirmed = !summariesAreUnconfirmed && businessMatched &&
          !ownerRoleContextIsUnverified(text, match.index ?? 0, match[0]);
        const candidate: SalonOwnerNameCandidate = {
          id: candidateId(person.firstName, person.lastName),
          ...person,
          role: roleConfirmed ? "co-owner" : summariesAreUnconfirmed ? "Unconfirmed search-result mention" : "co-owner",
          roleConfirmed,
          businessMatched,
          confidence: roleConfirmed ? "high" : businessMatched ? "medium" : "low",
          sources: [{
            ...source,
            excerpt: [excerptAround(text, match[0]), source.excerpt].filter(Boolean).join(" | ").slice(0, 800),
          }],
        };
        const prior = discovered.find(item => item.id === candidate.id);
        if (prior) {
          prior.sources.push(...candidate.sources);
          prior.roleConfirmed ||= candidate.roleConfirmed;
          prior.businessMatched ||= candidate.businessMatched;
          if (prior.roleConfirmed && prior.businessMatched) prior.confidence = "high";
        } else {
          discovered.push(candidate);
        }
      }
    }
  }
  return discovered;
}

export function extractSalonOwnerCandidates(
  text: string,
  source: SalonOwnerNameSource,
  businessMatched: boolean,
  allowFirstOnly = false,
  businessName?: string,
): SalonOwnerNameCandidate[] {
  return collectCandidates(text, source, businessMatched, allowFirstOnly, false, businessName);
}

export function extractSalonOwnerSummaryCandidates(
  text: string,
  source: SalonOwnerNameSource,
): SalonOwnerNameCandidate[] {
  const candidates = collectCandidates(text, source, false, true, true);
  const teamPattern = /\b(?:team\s+(?:mentions|includes|members?\s+include)|meet the team\s*[:,-]?)\s+([A-Z][a-z]{1,20})(?:\s+and\s+([A-Z][a-z]{1,20}))?/g;
  let match: RegExpExecArray | null;
  while ((match = teamPattern.exec(text))) {
    for (const firstName of [match[1], match[2]].filter(Boolean)) {
      const person = normalizedPersonName(firstName, true);
      if (!person) continue;
      const id = candidateId(person.firstName, null);
      if (candidates.some(candidate => candidate.id === id)) continue;
      candidates.push({
        id,
        firstName: person.firstName,
        lastName: null,
        role: "Unconfirmed search-result mention",
        roleConfirmed: false,
        businessMatched: false,
        confidence: "low",
        sources: [{ ...source, excerpt: excerptAround(text, match[0]) }],
      });
    }
  }
  return candidates;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, " ")
    .replace(/<(?:section|div)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:testimonial|review|rating|quote)[^"']*["'][^>]*>[\s\S]*?<\/(?:section|div)>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|section|table|td|th|tr|ul)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n").trim();
}

// Keep the existing Contacts discovery text exactly as before. The stricter
// report extractor above intentionally retains paragraph boundaries.
export function stripLegacyOwnerHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ipv4IsPublic(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const parts = address.split(".").map(Number);
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 255 && b === 255 && c === 255));
}

function ipv6Words(address: string): number[] | null {
  let value = address.toLowerCase().split("%")[0];
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = value.slice(lastColon + 1);
    if (!ipv4IsPublic(ipv4)) {
      if (isIP(ipv4) !== 4) return null;
    }
    const octets = ipv4.split(".").map(Number);
    value = `${value.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array(missing).fill("0"), ...right];
  if (parts.length !== 8 || parts.some(part => !/^[\da-f]{1,4}$/.test(part))) return null;
  return parts.map(part => parseInt(part, 16));
}

function isPublicAddress(address: string): boolean {
  const ipVersion = isIP(address);
  if (!ipVersion) return true;
  if (ipVersion === 4) return ipv4IsPublic(address);
  const words = ipv6Words(address);
  if (!words) return false;
  const allZero = words.every(word => word === 0);
  if (allZero || words.slice(0, 7).every(word => word === 0) && words[7] === 1) return false;
  // IPv4-mapped IPv6 must be classified using the embedded IPv4 address.
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    const embedded = `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
    return ipv4IsPublic(embedded);
  }
  // Only global-unicast space is eligible. Exclude special-use assignments,
  // transition/tunnel prefixes, documentation, and benchmarking ranges.
  if ((words[0] & 0xe000) !== 0x2000) return false;
  if (words[0] === 0x2001 && (words[1] <= 0x01ff || words[1] === 0x0db8)) return false;
  if (words[0] === 0x2002 || words[0] === 0x3fff) return false;
  return true;
}

async function publicAddresses(url: URL): Promise<Array<{ address: string; family: number }>> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    isIP(host)
      ? Promise.resolve([{ address: host, family: isIP(host) }])
      : lookup(host, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      dnsTimer = setTimeout(() => reject(new Error("Public page DNS lookup timed out")), FETCH_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (dnsTimer) clearTimeout(dnsTimer);
  });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("The page resolves to a private or reserved network address");
  }
  return addresses;
}

export async function validatePublicHttpUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      !url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
      url.hostname.endsWith(".local")) {
    throw new Error("Only public HTTP(S) pages can be fetched");
  }
  await publicAddresses(url);
  return url;
}

function requestPinnedPage(url: URL, address: { address: string; family: number }): Promise<{
  status: number;
  headers: import("node:http").IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const options = {
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        Host: url.host,
        "User-Agent": "Mozilla/5.0 (compatible; TownGridCRM owner-name review/1.0)",
        Accept: "text/html",
        Connection: "close",
      },
      ...(url.protocol === "https:" && !isIP(hostname) ? { servername: hostname } : {}),
    };
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    let totalTimeout!: ReturnType<typeof setTimeout>;
    const clearTimer = () => {
      if (!settled) {
        settled = true;
        clearTimeout(totalTimeout);
      }
    };
    const req = requester(options, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      const contentLength = Number(response.headers["content-length"] || 0);
      if (contentLength > MAX_PAGE_BYTES) {
        clearTimer();
        response.destroy();
        reject(new Error("Page exceeded the size limit"));
        return;
      }
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_PAGE_BYTES) {
          response.destroy(new Error("Page exceeded the size limit"));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        clearTimer();
        resolve({
          status: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      response.on("error", error => {
        clearTimer();
        reject(error);
      });
    });
    totalTimeout = setTimeout(() => req.destroy(new Error("Public page request timed out")), FETCH_TIMEOUT_MS);
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error("Public page request timed out")));
    req.on("error", error => {
      clearTimer();
      reject(error);
    });
    req.end();
  });
}

async function fetchPublicPage(input: string): Promise<{ url: string; html: string }> {
  let url = await validatePublicHttpUrl(input);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    // Pin each request to an address validated in this very request. This
    // avoids the DNS-validation / fetch-resolution gap while preserving the
    // original Host header and TLS SNI/certificate hostname.
    const addresses = await publicAddresses(url);
    const response = await requestPinnedPage(url, addresses[0]);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location || redirects === MAX_REDIRECTS) throw new Error("Page redirect limit exceeded");
      const redirectUrl = new URL(location, url);
      if (!safeOrganicPage(redirectUrl.toString())) throw new Error("Social, login, or booking-provider pages are not owner evidence");
      url = await validatePublicHttpUrl(redirectUrl.toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Public page returned HTTP ${response.status}`);
    const type = String(response.headers["content-type"] || "");
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
      throw new Error("Public page did not return HTML");
    }
    return { url: url.toString(), html: response.body };
  }
  throw new Error("Page redirect limit exceeded");
}

export type SalonOwnerNameDependencies = {
  storage: typeof storage;
  getUsageStatus: typeof getSerpUsageStatus;
  fetchPage: typeof fetchPublicPage;
  fetchProvider: typeof fetch;
  providerTimeoutMs?: number;
};

let runtime: SalonOwnerNameDependencies = {
  storage,
  getUsageStatus: getSerpUsageStatus,
  fetchPage: fetchPublicPage,
  fetchProvider: (...args) => fetch(...args),
};

/** Dependency injection for isolated orchestration tests; production defaults remain live services. */
export function configureSalonOwnerNameDependencies(
  overrides: Partial<SalonOwnerNameDependencies>,
): () => void {
  const previous = runtime;
  runtime = { ...runtime, ...overrides };
  return () => { runtime = previous; };
}

function candidatePagePaths(html: string, base: URL): string[] {
  const paths: string[] = [];
  const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html))) {
    try {
      const target = new URL(match[1], base);
      if (!sameSalonWebsite(target, base) || !/(about|team|staff|owner|our-story|meet)/i.test(target.pathname)) continue;
      if (!paths.includes(target.pathname + target.search)) paths.push(target.pathname + target.search);
    } catch {
      // Ignore malformed and off-origin links.
    }
  }
  for (const path of ["/about", "/about-us", "/our-team", "/team", "/meet-the-team"]) {
    if (paths.length >= 5) break;
    const relative = salonRelativePage(base, path).pathname;
    if (!paths.includes(relative)) paths.push(relative);
  }
  return paths;
}

function safeOrganicPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLocaleLowerCase();
    const googleSalonSite = host === "sites.google.com" && Boolean(hostedSalonPath(parsed));
    const blockedHost = !googleSalonSite && /(^|\.)(?:facebook|instagram|threads|nextdoor|tiktok|x|twitter|linkedin|youtube|google|linktr)\.(?:com|net|ee)$/.test(host) ||
      /(^|\.)(?:booksy|vagaro|mindbody|mindbodyonline|square|squareup|fresha|schedulicity|acuityscheduling|setmore|bookeo|timely)\.(?:com|net|site)$/.test(host);
    const blockedPath = /\/(?:login|log-in|signin|sign-in|oauth|auth|book|booking|appointments)(?:\/|$)/i.test(parsed.pathname);
    return !blockedHost && !blockedPath;
  } catch {
    return false;
  }
}

function rowCategory(row: SalonEnrichmentRow): string {
  const sourceData = row.sourceData && typeof row.sourceData === "object" && !Array.isArray(row.sourceData)
    ? row.sourceData as Record<string, unknown>
    : {};
  return String(sourceData.category || sourceData.businessCategory || "").trim();
}

export function isSalonOwnerNameEligible(row: SalonEnrichmentRow): boolean {
  const category = rowCategory(row).toLocaleLowerCase().trim().replace(/[\s-]+/g, "_");
  if (category === "non_grooming" || category === "excluded_non_grooming") return false;
  // Category is not a required mapped upload column. A category-less salon
  // upload becomes eligible only after the existing identity check succeeds;
  // searching still requires the explicit opt-in or confirmed manual action.
  if (!category) return row.identityMatchStatus === "strong";
  const allowedCategories = new Set([
    "verified_public_email",
    "review_only",
    "no_verified_email",
    "booking_only",
    "inaccessible",
    "pet_grooming",
    "dog_grooming",
    "grooming",
  ]);
  return allowedCategories.has(category);
}

function verifiedOrganicEvidenceText(row: SalonEnrichmentRow, text: string): string {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const blocks: string[] = [];
  // Keep extraction within the small text card containing both this exact
  // business and its full address. Do not attach another directory listing's
  // staff or reviewers to this salon based on a page-wide hit.
  for (let index = 0; index < lines.length; index++) {
    for (let size = 1; size <= 5 && index + size <= lines.length; size++) {
      const block = lines.slice(index, index + size).join("\n");
      if (businessAndLocationMatch(row, block)) {
        blocks.push(block);
        index += size - 1;
        break;
      }
    }
  }
  return blocks.join("\n");
}

function hasContradictoryLocation(row: SalonIdentity, text: string): boolean {
  const targetZip = (row.zipCode || "").trim();
  const zips = text.match(/\b\d{5}(?:-\d{4})?\b/g) || [];
  if (targetZip && zips.some(zip => zip.slice(0, 5) !== targetZip.slice(0, 5))) return true;
  const targetStreet = (row.address1 || row.address || "").match(/^\s*(\d+[a-z]?)/i)?.[1]?.toLowerCase();
  const streetNumbers = Array.from(text.matchAll(/\b(\d+[a-z]?)\s+[\w'-]+(?:\s+[\w'-]+){0,3}\s+(?:st|street|dr|drive|rd|road|ave|avenue|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|hwy|highway)\b/gi))
    .map(match => match[1].toLowerCase());
  return !!targetStreet && streetNumbers.some(number => number !== targetStreet);
}

function sourceKindForPath(path: string, homepage = false, organic = false): string {
  if (organic) return "organic_page";
  if (homepage) return "website_homepage";
  if (/team|staff|meet/i.test(path)) return "website_team";
  return /about|owner|our-story/i.test(path) ? "website_about" : "website_page";
}

function mergeCandidates(target: SalonOwnerNameCandidate[], incoming: SalonOwnerNameCandidate[]): void {
  for (const candidate of incoming) {
    const prior = target.find(item => item.id === candidate.id);
    if (!prior) {
      target.push(candidate);
      continue;
    }
    prior.sources.push(...candidate.sources.filter(source =>
      !prior.sources.some(existing => existing.url === source.url && existing.excerpt === source.excerpt),
    ));
    prior.roleConfirmed ||= candidate.roleConfirmed;
    prior.businessMatched ||= candidate.businessMatched;
    if (prior.roleConfirmed && prior.businessMatched) prior.confidence = "high";
    else if (candidate.confidence === "medium" && prior.confidence === "low") prior.confidence = "medium";
    if (candidate.roleConfirmed) prior.role = candidate.role;
  }
}

function rowEvidence(row: SalonEnrichmentRow): Record<string, unknown> {
  return row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
    ? row.evidence as Record<string, unknown>
    : {};
}

function readOwnerResult(row: SalonEnrichmentRow): OwnerNameResult {
  const candidate = rowEvidence(row).ownerName as OwnerNameResult | undefined;
  const result = candidate && typeof candidate === "object"
    ? { ...EMPTY_OWNER_NAME_RESULT, ...candidate }
    : { ...EMPTY_OWNER_NAME_RESULT };
  // Present older saved notices without rewriting records or rerunning research.
  if (typeof result.error === "string" && result.error.includes(AI_OVERVIEW_TOKEN_NOTICE)) {
    result.error = result.error.replace(AI_OVERVIEW_TOKEN_NOTICE, "").replace(/^;\s*|\s*;\s*$/g, "").trim() || undefined;
    result.notices = Array.from(new Set([...(result.notices || []), AI_OVERVIEW_TOKEN_NOTICE]));
  }
  return result;
}

export async function revokeAppliedSalonOwnerName(row: SalonEnrichmentRow): Promise<void> {
  const result = await runtime.storage.revokeSalonOwnerName(row.id, row.userId);
  if (result.error) {
    const error = new Error(result.error.message);
    Object.assign(error, { status: result.error.status });
    throw error;
  }
}

function getMonthYear(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function queryParts(row: SalonEnrichmentRow): { query: string; cacheKey: string; zip: string; state: string; businessName: string } {
  const location = [row.address1 || row.address, row.city, row.state, row.zipCode].filter(Boolean).join(", ");
  const query = `"${row.businessName}"${location ? ` "${location}"` : ""} owner salon`;
  return {
    businessName: row.businessName,
    query,
    cacheKey: `salon-owner-organic:${normalized(row.businessName)}:${normalized(location)}`,
    zip: row.zipCode || normalized(row.city).replace(/\s+/g, "-") || "unknown",
    state: row.state || "US",
  };
}

export function salonOwnerSearchQueries(row: SalonEnrichmentRow): ReturnType<typeof queryParts>[] {
  const legacy = queryParts(row);
  const availableLocation = ownerDiscoveryLocation(row);
  const addressParts = [row.address1 || row.address].filter(Boolean) as string[];
  for (const value of [row.city, row.state, row.zipCode]) {
    if (value && !` ${normalized(addressParts.join(" "))} `.includes(` ${normalized(value)} `)) addressParts.push(value);
  }
  const addressLocation = addressParts.join(", ");
  const phrases = [
    { ...legacy, query: `"${row.businessName}"${addressLocation ? ` ${addressLocation}` : ""}` },
    { ...legacy, query: `Who is the owner of "${row.businessName}"${availableLocation ? ` in ${availableLocation}` : ""}?` },
    legacy,
  ];
  return phrases.filter((item, index) =>
    phrases.findIndex(other => normalized(other.query) === normalized(item.query)) === index,
  ).map(item => item === legacy ? item : {
    ...item,
    cacheKey: `salon-owner-organic-phrase:${normalized(item.query)}`,
  }).slice(0, MAX_SEARCHES_PER_ROW);
}

async function organicSearch(
  parts: ReturnType<typeof queryParts>, remainingCalls: number, deadline: number, progress: OwnerLookupProgress,
): Promise<{
  results: OrganicResult[];
  calls: number;
  error?: string;
  notice?: string;
  budgetExhausted?: boolean;
}> {
  const { query, cacheKey, zip, state } = parts;
  const cached = await runtime.storage.getSerpCache(zip, cacheKey, state, 30);
  if (cached) {
    return { ...readOwnerSearchCache(cached.resultsJson), calls: 0 };
  }
  if (remainingCalls <= 0) return { results: [], calls: 0, budgetExhausted: true, error: "Owner lookup incomplete: the confirmed paid-search allowance has been reached" };
  if (Date.now() >= deadline) return { results: [], calls: 0, error: "Owner lookup incomplete: the lookup time limit has been reached" };
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return { results: [], calls: 0, error: "SERPAPI_API_KEY is not configured" };

  const status = await runtime.getUsageStatus();
  const maxCallsPerHour = providerHourlyLimit(status.config.maxSerpCallsPerHour ?? 5, progress.requestPolicy);
  const monthYear = getMonthYear();
  const reservationId = await runtime.storage.reserveSerpCall(monthYear, maxCallsPerHour);
  if (!reservationId) {
    await progress.requestPolicy?.onReservationBlocked();
    return { results: [], calls: 0, error: "SERP quota or hourly limit reached" };
  }
  let requestAttempted = false;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const params = new URLSearchParams({
      engine: "google",
      q: query,
      num: "10",
      hl: "en",
      gl: "us",
      api_key: apiKey,
    });
    // Cover both response headers and body parsing with one bounded deadline.
    // No automatic retry: a timed-out initiated request may still be billed.
    const request = async () => {
      // This ledger is independent of storage and displayed row results. A
      // later infrastructure error or deleted row must never refund this call.
      await progress.beforeProvider?.();
      requestAttempted = true;
      progress.calls++;
      const response = await runtime.fetchProvider(`https://serpapi.com/search?${params}`, {
        signal: controller.signal,
      });
      return readSerpProviderResponse<{ error?: string; organic_results?: OrganicResult[]; ai_overview?: unknown }>(response, progress.requestPolicy);
    };
    const providerDeadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        const error = new DOMException("Owner search provider timed out", "TimeoutError");
        reject(error);
        controller.abort(error);
      }, Math.min(runtime.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS, Math.max(1, deadline - Date.now())));
    });
    const payload = await Promise.race([request(), providerDeadline]);
    const parsed = parseOwnerSearchResponse(payload, parts.businessName, query,
      cacheKey.startsWith("grooming-check-v1:") ? "grooming" : "owner");
    try {
      await runtime.storage.createSerpCache(zip, cacheKey, state, { version: 2, ...parsed });
    } catch (error) {
      console.error("[SalonOwnerNames] Could not cache organic search response:", error);
    }
    return { ...parsed, calls: 1 };
  } catch (error) {
    // The provider may bill a request that timed out before returning headers.
    // Keep the reservation and count every initiated network attempt.
    if (!requestAttempted) await runtime.storage.releaseSerpCall(reservationId, monthYear);
    return {
      results: [],
      calls: requestAttempted ? 1 : 0,
      error: controller.signal.aborted || (error instanceof Error &&
        (/timeout|timed out/i.test(error.message) || ["TimeoutError", "AbortError"].includes(error.name)))
        ? "The owner-search provider did not respond within the time limit. Your email review is unchanged. You can retry later; a retry may use another lookup credit."
        : error instanceof Error ? error.message : "Organic owner search failed",
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// Same bounded deployed public-search service/cache as owner research; no agent tools.
export async function searchSalonContactPages(row: SalonEnrichmentRow, remainingCalls: number, beforeProvider: () => Promise<void>, requestPolicy?: SerpRequestPolicy) {
  const parts=queryParts(row), location=[row.address1||row.address,row.city,row.state,row.zipCode].filter(Boolean).join(" ");
  const query=`"${row.businessName}" ${location} contact email`;
  const progress={...newOwnerLookupProgress(),beforeProvider,requestPolicy};
  const result=await organicSearch({...parts,query,cacheKey:`salon-contact-organic:${normalized(query)}`},remainingCalls,Date.now()+PROVIDER_TIMEOUT_MS,progress);
  return {...result,results:result.results.filter(item=>!item.summaryKind&&item.title&&item.link&&businessAndLocationMatch(row,`${item.title} ${item.snippet||""}`))
    .map(item=>({title:item.title!,link:item.link!,address:`${item.title} ${item.snippet||""}`,snippet:item.snippet}))};
}

// Reuse the bounded public-search cache, shared reservations and provider retry
// policy. Search summaries are discovery hints only; callers inspect live pages.
export async function searchSalonGroomingPages(row: SalonEnrichmentRow, question: "services" | "shop",
  beforeProvider: () => Promise<void>, requestPolicy?: SerpRequestPolicy) {
  const location = [row.address1 || row.address, row.city, row.state, row.zipCode].filter(Boolean).join(" ");
  const query = question === "services"
    ? `Does "${row.businessName}", located at "${location}", offer pet grooming services?`
    : `Is "${row.businessName}", located at "${location}", a pet grooming shop?`;
  const progress = { ...newOwnerLookupProgress(), beforeProvider, requestPolicy };
  const found = await organicSearch({ ...queryParts(row), query, cacheKey: `grooming-check-v1:${normalized(query)}` },
    1, Date.now() + PROVIDER_TIMEOUT_MS, progress);
  return { ...found, results: found.results.filter(item => item.link || item.summaryKind) };
}

export async function fetchPublicResearchPage(url: string) {
  return runtime.fetchPage(url);
}

async function withRowSearchLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = ownerSearchLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  ownerSearchLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (ownerSearchLocks.get(key) === current) ownerSearchLocks.delete(key);
  }
}

async function inspectPage(
  row: SalonEnrichmentRow,
  inputUrl: string,
  candidates: SalonOwnerNameCandidate[],
  pages: { count: number; attempted: number },
  errors: string[],
  homepage = false,
  organic = false,
  inheritedOrigin?: string,
): Promise<{ html: string; url: string; matched: boolean } | null> {
  if (pages.attempted >= MAX_PAGES_PER_ROW) return null;
  pages.attempted++;
  try {
    const page = await runtime.fetchPage(inputUrl);
    pages.count++;
    const text = stripHtml(page.html);
    const explicitMatch = businessAndLocationMatch(row, text);
    const contradictory = hasContradictoryLocation(row, text);
    const matched = !contradictory && (explicitMatch || (
      !!inheritedOrigin && new URL(page.url).origin === new URL(inheritedOrigin).origin
    ));
    const path = new URL(page.url).pathname;
    const kind = sourceKindForPath(path, homepage, organic);
    const matchExcerpt = matched ? businessLocationExcerpt(row, text) : "";
    const source = {
      url: page.url,
      excerpt: matchExcerpt ? `Business/location verification: ${matchExcerpt}` : "",
      kind,
    };
    const evidenceText = !matched ? "" : organic ? verifiedOrganicEvidenceText(row, text) : text;
    if (evidenceText) {
      mergeCandidates(candidates, extractSalonOwnerCandidates(evidenceText, source, true, true, row.businessName));
    } else if (organic && !contradictory) {
      const discoveryText = ownerInterviewDiscoveryText(row, text);
      if (discoveryText) {
        mergeCandidates(candidates, extractSalonOwnerCandidates(discoveryText, source, false, false, row.businessName));
      }
    }
    return { html: page.html, url: page.url, matched };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Public page fetch failed");
    return null;
  }
}

export function ownerLookupWebsiteUrl(row: SalonEnrichmentRow): string | null {
  if (row.websiteUrl?.trim()) {
    const candidate = /^https?:\/\//i.test(row.websiteUrl) ? row.websiteUrl : `https://${row.websiteUrl}`;
    try { return safeOrganicPage(candidate) ? new URL(candidate).href : null; }
    catch { return null; }
  }
  // Reviewed report rows deliberately have websiteUrl=null. Only a matching,
  // first-party email source may seed a free website inspection. Directory and
  // social sources must not be mistaken for salon-owned websites.
  const sourceData = row.sourceData as Record<string, unknown> | null;
  const evidence = row.evidence as Record<string, unknown> | null;
  const email = evidence?.email as Record<string, unknown> | undefined;
  if (sourceData?.Outcome !== "verified_first_party_email" || !row.email ||
      typeof email?.value !== "string" ||
      email.value.trim().toLowerCase() !== row.email.trim().toLowerCase() ||
      email.purpose !== "general" || typeof email.sourceUrl !== "string") return null;
  try {
    const url = new URL(email.sourceUrl);
    return url.protocol === "https:" && safeOrganicPage(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

async function performLookup(
  row: SalonEnrichmentRow,
  maxProviderCalls: number,
  searchesPerRow: 1 | 3,
  progress: OwnerLookupProgress,
): Promise<{ ownerName: OwnerNameResult; calls: number }> {
  const businessName = row.businessName?.trim();
  if (!businessName) {
    return {
      ownerName: { ...EMPTY_OWNER_NAME_RESULT, status: "excluded", error: "Business name is missing", lookedUpAt: new Date().toISOString() },
      calls: 0,
    };
  }
  if (!isSalonOwnerNameEligible(row)) {
    return {
      ownerName: {
        ...EMPTY_OWNER_NAME_RESULT,
        status: "excluded",
        error: `Owner lookup is not available for non-grooming category "${rowCategory(row)}"`,
        lookedUpAt: new Date().toISOString(),
      },
      calls: 0,
    };
  }
  const candidates = progress.candidates;
  const errors: string[] = [];
  const notices: string[] = [];
  const pages = progress.pages;
  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  const inspectedUrls = new Set<string>();
  const pageKey = (url: string) => {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  };
  const inspectOnce = async (
    url: string, isHomepage = false, organic = false, inheritedOrigin?: string,
  ) => {
    const key = pageKey(url);
    if (inspectedUrls.has(key)) return null;
    inspectedUrls.add(key);
    const page = await inspectPage(row, url, candidates, pages, errors, isHomepage, organic, inheritedOrigin);
    if (page) inspectedUrls.add(pageKey(page.url));
    return page;
  };
  const verifiedOwnerFound = () => candidates.some(candidate => candidate.roleConfirmed && candidate.businessMatched);
  const limitMessage = () => Date.now() >= deadline
    ? "Owner lookup incomplete: the lookup time limit has been reached"
    : `Owner lookup incomplete: the page limit has been reached (${pages.attempted} attempts, ${pages.count} pages loaded). Failed pages also count toward this limit.`;
  let homepage: { html: string; url: string; matched: boolean } | null = null;

  try {
    // Existing matched business site gets first priority, before paid search.
    const websiteUrl = ownerLookupWebsiteUrl(row);
    if (websiteUrl && safeOrganicPage(websiteUrl)) {
      const baseUrl = websiteUrl;
      homepage = await inspectOnce(baseUrl, new URL(baseUrl).pathname === "/");
      if (homepage && pages.attempted < MAX_PAGES_PER_ROW && !verifiedOwnerFound()) {
        const base = new URL(homepage.url);
        const paths = candidatePagePaths(homepage.html, base);
        for (const path of paths) {
          // Broken/irrelevant site paths must not consume the organic review budget.
          // Keep at least two attempts for independently matched search-result pages.
          if (pages.attempted >= MAX_PAGES_PER_ROW - 2 || Date.now() >= deadline) break;
          if (path === base.pathname) continue;
          await inspectOnce(
            new URL(path, base).toString(), false, false, homepage.matched ? homepage.url : undefined,
          );
          if (verifiedOwnerFound()) break;
        }
      }
    }

    for (const phrase of salonOwnerSearchQueries(row).slice(0, searchesPerRow)) {
      if (verifiedOwnerFound()) break;
      if (pages.attempted >= MAX_PAGES_PER_ROW || Date.now() >= deadline) {
        errors.push(limitMessage());
        break;
      }
      const search = await organicSearch(phrase, maxProviderCalls - progress.calls, deadline, progress);
      if (search.error) {
        errors.push(search.error.startsWith("Owner lookup incomplete:") ? search.error : `Owner lookup incomplete: ${search.error}`);
        if (search.budgetExhausted) continue; // Later cached phrases remain free; no more paid requests.
        break; // No automatic retries, including failures that may have been billed.
      }
      if (search.notice) notices.push(search.notice);
      const organicPages: string[] = [];
      // Summaries suggest candidates only; fetched matched pages establish roles.
      for (const result of prioritizeOwnerResults(row, search.results)) {
        const summary = [result.title, result.snippet].filter(Boolean).join(" — ");
        // An ownership phrase alone is not relevance to this salon. Do not
        // display other businesses' people or spend page attempts on them.
        if (!mentionsOwnerBusiness(row.businessName, summary)) continue;
        if (summary) {
          const suggestions = extractSalonOwnerSummaryCandidates(summary, {
            url: result.link || "https://www.google.com/search",
            excerpt: summary.slice(0, 350),
            kind: result.summaryKind || "organic_summary",
          });
          if (result.summaryKind === "google_ai_overview") {
            for (const candidate of suggestions) {
              candidate.role = "Unconfirmed Google AI Overview mention";
              candidate.sources.push(...(result.citations || []).filter(citation => citation.link).map(citation => ({
                url: citation.link!,
                excerpt: `AI Overview citation (not yet verified): ${[citation.title, citation.snippet].filter(Boolean).join(" — ")}`.slice(0, 800),
                kind: "google_ai_citation",
              })));
            }
          }
          mergeCandidates(candidates, suggestions);
        }
        const pageResults = result.summaryKind ? result.citations || [] : [result];
        for (const page of pageResults) {
          if (!mentionsOwnerBusiness(row.businessName, [page.title, page.snippet].filter(Boolean).join(" "))) continue;
          if (page.link && safeOrganicPage(page.link) &&
              !inspectedUrls.has(pageKey(page.link)) && !organicPages.includes(page.link)) {
            organicPages.push(page.link);
          }
        }
      }
      // Inspect this phrase before spending on any fallback phrase.
      for (const resultUrl of organicPages) {
        if (pages.attempted >= MAX_PAGES_PER_ROW || Date.now() >= deadline || verifiedOwnerFound()) break;
        await inspectOnce(resultUrl, false, true);
      }
      if (!verifiedOwnerFound() && organicPages.some(url => !inspectedUrls.has(pageKey(url)))) {
        errors.push(limitMessage());
      }
    }
  } catch (error) {
    // Cache reads, usage lookups and reservations can fail outside the provider
    // request's catch. Keep earlier candidates and usage, and stop this row.
    errors.push(`Owner lookup incomplete: ${error instanceof Error ? error.message : "Owner-search infrastructure failed"}`);
  }

  const distinct = candidates.filter((candidate, index) =>
    candidates.findIndex(item => item.id === candidate.id) === index,
  );
  const error = errors.length ? Array.from(new Set(errors)).join("; ").slice(0, 700) : undefined;
  const ownerName: OwnerNameResult = {
    status: distinct.length ? "needs_review" : error ? "failed" : "not_found",
    candidates: distinct,
    selectedCandidateId: null,
    approvedAt: null,
    usePersonalName: false,
    providerCalls: progress.calls,
    pagesFetched: pages.count,
    ...(error ? { error } : {}),
    ...(notices.length ? { notices: Array.from(new Set(notices)) } : {}),
    lookedUpAt: new Date().toISOString(),
  };
  return { ownerName, calls: progress.calls };
}

export async function lookupSalonOwnerName(
  rowId: string,
  userId: string,
  providerAllowance: number | boolean = 1,
  searchesPerRow: 1 | 3 = 1,
): Promise<OwnerNameResult | null> {
  return lookupSalonOwnerNameTracked(rowId, userId, providerAllowance, searchesPerRow, newOwnerLookupProgress());
}

/** Candidate research only: shares the queue's durable paid-request guard and
 * never approves names, updates Contacts, or changes greeting preferences. */
export async function researchSalonOwnerCandidates(
  row: SalonEnrichmentRow,
  beforeProvider: () => Promise<void>,
  requestPolicy?: SerpRequestPolicy,
): Promise<OwnerNameResult> {
  const progress = { ...newOwnerLookupProgress(), beforeProvider, requestPolicy };
  try {
    return (await performLookup(row, 3, 3, progress)).ownerName;
  } catch (error) {
    return { ...EMPTY_OWNER_NAME_RESULT, status: progress.candidates.length ? "needs_review" : "failed",
      candidates: progress.candidates, providerCalls: progress.calls, pagesFetched: progress.pages.count,
      lookedUpAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Name research failed." };
  }
}

async function lookupSalonOwnerNameTracked(
  rowId: string, userId: string, providerAllowance: number | boolean, searchesPerRow: 1 | 3,
  progress: OwnerLookupProgress,
): Promise<OwnerNameResult | null> {
  const maxProviderCalls = typeof providerAllowance === "boolean" ? Number(providerAllowance) : providerAllowance;
  if (!Number.isInteger(maxProviderCalls) || maxProviderCalls < 0 || maxProviderCalls > MAX_SEARCHES_PER_ROW ||
      ![1, 3].includes(searchesPerRow) || maxProviderCalls > searchesPerRow) {
    throw new Error("Invalid owner-search allowance");
  }
  return withRowSearchLock(rowId, async () => {
    const existingRow = await runtime.storage.getSalonEnrichmentRow(rowId, userId);
    if (!existingRow) return null;
    if (isResearchDirectoryRow(existingRow)) throw new Error(RESEARCH_READ_ONLY);
    if (existingRow.status === "pending" || existingRow.status === "processing") {
      return {
        ...EMPTY_OWNER_NAME_RESULT,
        status: "excluded",
        error: "Owner-name lookup is unavailable until row enrichment has finished",
      };
    }
    const lookupToken = randomUUID();
    const row = await runtime.storage.beginSalonOwnerNameLookup(rowId, userId, lookupToken);
    if (!row) return null;
    let result: { ownerName: OwnerNameResult; calls: number };
    try {
      result = await performLookup(row, maxProviderCalls, searchesPerRow, progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Owner-name search failed";
      const failed: OwnerNameResult = {
        ...EMPTY_OWNER_NAME_RESULT,
        status: progress.candidates.length ? "needs_review" : "failed",
        candidates: progress.candidates,
        providerCalls: progress.calls,
        pagesFetched: progress.pages.count,
        error: `Owner lookup incomplete: ${message}`,
        lookedUpAt: new Date().toISOString(),
      };
      try {
        await runtime.storage.completeSalonOwnerNameLookup(row.id, userId, lookupToken, failed);
      } catch (persistError) {
        failed.error = `${message}; could not save failure status: ${persistError instanceof Error ? persistError.message : "storage error"}`;
      }
      return failed;
    }

    let completed: boolean;
    try {
      completed = await runtime.storage.completeSalonOwnerNameLookup(row.id, userId, lookupToken, result.ownerName);
    } catch (persistError) {
      const message = persistError instanceof Error ? persistError.message : "storage error";
      const failed: OwnerNameResult = {
        ...result.ownerName,
        status: "failed",
        error: [result.ownerName.error, `Could not persist owner-name results: ${message}`].filter(Boolean).join("; "),
        providerCalls: Math.max(result.calls, result.ownerName.providerCalls),
        pagesFetched: result.ownerName.pagesFetched,
      };
      try {
        completed = await runtime.storage.completeSalonOwnerNameLookup(row.id, userId, lookupToken, failed);
      } catch {
        return failed;
      }
      if (completed) return failed;
      const current = await runtime.storage.getSalonEnrichmentRow(row.id, userId).catch(() => undefined);
      if (!current) return failed;
      const currentResult = readOwnerResult(current);
      return {
        ...currentResult,
        providerCalls: result.calls,
      };
    }
    if (!completed) {
      let current: SalonEnrichmentRow | undefined;
      try {
        current = await runtime.storage.getSalonEnrichmentRow(row.id, userId);
      } catch (error) {
        return {
          ...result.ownerName, providerCalls: progress.calls, status: "failed",
          error: `Owner lookup incomplete: could not read the current row after saving results: ${error instanceof Error ? error.message : "storage error"}`,
        };
      }
      if (!current) return {
        ...result.ownerName, providerCalls: progress.calls, status: "failed",
        error: "Owner lookup incomplete: the salon row is no longer available and results could not be saved",
      };
      const currentResult = readOwnerResult(current);
      return {
        ...currentResult,
        providerCalls: result.calls,
      };
    }
    return result.ownerName;
  });
}

export async function estimateSalonOwnerNameSearch(rows: SalonEnrichmentRow[], searchesPerRow: 1 | 3 = 1): Promise<{
  maxProviderCalls: number;
  maxPages: number;
  remainingCredits: number;
  allowed: boolean;
  reason?: string;
  searchesPerRow: 1 | 3;
}> {
  if (![1, 3].includes(searchesPerRow)) throw new Error("Invalid owner-search phrase limit");
  if (!rows.length || rows.length > MAX_ROWS_PER_REQUEST) {
    return { searchesPerRow, maxProviderCalls: 0, maxPages: 0, remainingCredits: 0, allowed: false, reason: "Select between 1 and 5 rows" };
  }
  const eligibleRows = rows.filter(isSalonOwnerNameEligible);
  if (!eligibleRows.length) {
    return {
      searchesPerRow,
      maxProviderCalls: 0,
      maxPages: 0,
      remainingCredits: 0,
      allowed: false,
      reason: "Selected rows are categorized as non-grooming businesses",
    };
  }
  const phrases = eligibleRows.flatMap(row => salonOwnerSearchQueries(row).slice(0, searchesPerRow));
  const uniquePhrases = phrases.filter((phrase, index) => phrases.findIndex(other =>
    other.cacheKey === phrase.cacheKey && other.zip === phrase.zip && other.state === phrase.state,
  ) === index);
  const misses = await Promise.all(uniquePhrases.map(async ({ cacheKey, zip, state }) => {
    return !(await runtime.storage.getSerpCache(zip, cacheKey, state, 30));
  }));
  const keyConfigured = !!process.env.SERPAPI_API_KEY;
  const status = await runtime.getUsageStatus();
  const callsLastHour = await runtime.storage.getSerpCallsInLastHour();
  const monthlyRemaining = Math.max(0, Math.min(
    (status.usage.monthlyQuota ?? 250) - status.usage.usedCredits,
    (status.usage.hardStopAt ?? 200) - status.usage.usedCredits,
  ));
  const hourlyRemaining = Math.max(0, (status.config.maxSerpCallsPerHour ?? 5) - callsLastHour);
  const remainingCredits = Math.min(monthlyRemaining, hourlyRemaining);
  const uncachedCount = misses.filter(Boolean).length;
  const maxProviderCalls = keyConfigured ? Math.min(uncachedCount, remainingCredits, eligibleRows.length * searchesPerRow) : 0;
  const hasWebsite = eligibleRows.some(row => {
    const url = ownerLookupWebsiteUrl(row);
    return !!url && safeOrganicPage(url);
  });
  const allowed = !!(misses.some(miss => !miss) || maxProviderCalls > 0 || hasWebsite);
  const reason = allowed
    ? undefined
    : !keyConfigured ? "No matched website is available and SERPAPI_API_KEY is not configured"
      : remainingCredits <= 0 ? "Monthly or hourly SERP credits are exhausted"
        : "No owner-name searches are available";
  return {
    searchesPerRow,
    maxProviderCalls,
    maxPages: eligibleRows.length * MAX_PAGES_PER_ROW,
    remainingCredits,
    allowed,
    ...(reason ? { reason } : {}),
  };
}

/** One numeric allowance for the whole batch, not a fresh allowance per row. */
export async function lookupSalonOwnerNameBatch(
  rows: SalonEnrichmentRow[], userId: string, maxProviderCalls: number, searchesPerRow: 1 | 3 = 1,
): Promise<{ results: Array<{ rowId: string; ownerName: OwnerNameResult }>; callsUsed: number }> {
  if (![1, 3].includes(searchesPerRow) || rows.length > MAX_ROWS_PER_REQUEST ||
      !Number.isInteger(maxProviderCalls) || maxProviderCalls < 0 || maxProviderCalls > rows.length * searchesPerRow) {
    throw new Error("Invalid batch owner-search allowance");
  }
  let callsUsed = 0;
  const results: Array<{ rowId: string; ownerName: OwnerNameResult }> = [];
  for (const row of rows) {
    const progress = newOwnerLookupProgress();
    let ownerName: OwnerNameResult | null;
    try {
      ownerName = await lookupSalonOwnerNameTracked(
        row.id, userId, Math.min(searchesPerRow, Math.max(0, maxProviderCalls - callsUsed)), searchesPerRow, progress,
      );
    } finally {
      // Never derive spending from a nullable/persisted result. If an unexpected
      // error escapes, this batch stops rather than issuing further requests.
      callsUsed += progress.calls;
    }
    if (ownerName) {
      results.push({ rowId: row.id, ownerName });
    }
  }
  return { results, callsUsed };
}

export function isApprovableSalonOwnerName(ownerName: OwnerNameResult | null | undefined): boolean {
  return isStrongApprovedOwnerCandidate(ownerName) !== null;
}

export function getSalonOwnerNameResult(row: SalonEnrichmentRow): OwnerNameResult {
  return readOwnerResult(row);
}

export const salonOwnerNameLimits = {
  maxRowsPerRequest: MAX_ROWS_PER_REQUEST,
  maxPagesPerRow: MAX_PAGES_PER_ROW,
  maxSearchesPerRow: MAX_SEARCHES_PER_ROW,
};