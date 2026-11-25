// Pass 1 website check: opens only the business's OWN website (allowed), never Facebook,
// Instagram, Yelp, BBB or delivery-app pages, and never follows a redirect onto them.
import { fetchPublicPage, RedirectRefused, type SalonFetchRuntime } from "../salonPublicFetch";
import {
  ORDERING_SERVICES, SOCIAL_SITES, hostMatches, hostOf, isNeverOpenUrl, orderingServiceForUrl,
  type FoundEmail, type FoundLink, type OrderingFindings, type SocialKey, type WebsiteFindings, type YesNoUnknown,
} from "@shared/businessSearch";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PAGE_TIMEOUT_MS = 12_000;
const MAX_EXTRA_PAGES = 5;

export interface SiteCheck {
  website: WebsiteFindings;
  socialLinks: Partial<Record<SocialKey, FoundLink>>;
  orderingLinks: OrderingFindings["siteLinks"];
  /** True when the page builds its content with JavaScript, so missing buttons may just be hidden. */
  jsLoaded: boolean;
}

// ── Reading raw page source ────────────────────────────────────────────────

/** Every absolute URL in the raw source, including escaped JSON ("https:\/\/...") and "//host/..." links. */
export function urlsInSource(html: string, base: string): string[] {
  const text = html.replace(/\\\//g, "/").replace(/&amp;/gi, "&");
  const found = new Set<string>();
  for (const m of Array.from(text.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[/?#][^\s"'<>()\\`]*)?/gi))) {
    let raw = m[0].replace(/[.,;:]+$/, "");
    if (raw.startsWith("//")) raw = `https:${raw}`;
    try { found.add(new URL(raw, base).href); } catch { /* skip */ }
  }
  return Array.from(found);
}

function hrefs(html: string, base: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  for (const m of Array.from(html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi))) {
    try { out.push({ url: new URL(m[1].replace(/&amp;/g, "&"), base).href, text: m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase() }); } catch { /* skip */ }
  }
  return out;
}

// Links that are page code or the website builder's own account, not the business's page.
const SOCIAL_JUNK = /^\/(2008\/fbml|wix|wixcom|squarespace|godaddy|weebly|bentobox|getbento|spothopper|popmenu|toasttab|toast|wordpress|wordpressdotcom|shopify|duda|webflow|elementor|yoast|popular|tags)(\/|$)/i;
// Share buttons, posts, events, photos: not the business's own page. ("/p/" is a Facebook page
// address but an Instagram post, so it is only skipped for Instagram; see socialLinksIn.)
const SOCIAL_SKIP = /\/(sharer|share|plugins|dialog|tr|intent|hashtag|reel|reels|explore|accounts|watch|embed|pin\/create|events|groups|photos|videos|posts|story\.php|permalink\.php)(\/|\?|$)|[?&](u|url)=/i;

export function socialLinksIn(html: string, pageUrl: string): Partial<Record<SocialKey, FoundLink>> {
  const found: Partial<Record<SocialKey, FoundLink>> = {};
  for (const url of urlsInSource(html, pageUrl)) {
    const host = hostOf(url);
    if (!host) continue;
    const site = SOCIAL_SITES.find(s => s.hosts.some(h => hostMatches(host, h)));
    if (!site || found[site.key]) continue;
    const path = new URL(url).pathname;
    if (path === "/" || path === "" || SOCIAL_JUNK.test(path) || SOCIAL_SKIP.test(new URL(url).pathname + new URL(url).search)) continue;
    if (site.key === "instagram" && /^\/p\//i.test(path)) continue;
    found[site.key] = { url, page: pageUrl };
  }
  return found;
}

export function orderingLinksIn(html: string, pageUrl: string): OrderingFindings["siteLinks"] {
  const out: OrderingFindings["siteLinks"] = [];
  const seen = new Set<string>();
  for (const url of urlsInSource(html, pageUrl)) {
    const service = orderingServiceForUrl(url);
    if (!service) continue;
    const host = hostOf(url)!;
    // Asset and tracking hosts (cdn.doordash.com images, js.squareup.com) aren't ordering buttons.
    if (/^(cdn|img|images|static|assets|js|fonts|api|analytics|pixel|web)\./.test(host) && !/order/.test(url)) continue;
    if (seen.has(service.key)) continue;
    seen.add(service.key);
    out.push({ service: service.key, label: service.label, url, page: pageUrl });
  }
  return out;
}

// ── Public emails on their own website ──────────────────────────────────────
// Only emails the site itself shows: mailto links (mail icons), emails written on the page,
// and emails hidden by Cloudflare's email protection. Never guessed.

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}/gi;
// Addresses that belong to the website builder, tracking tools or examples, not the business.
const NOT_BUSINESS_EMAIL = /@(?:.*\.)?(wixpress\.com|wix\.com|sentry\.io|sentry-next\.wixpress\.com|squarespace\.com|godaddy\.com|example\.(com|org)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|sentry\.wixpress\.com|bentobox\.com|getbento\.com|popmenu\.com|spothopper\.com|toasttab\.com|doordash\.com|grubhub\.com|ubereats\.com|slicelife\.com|chownow\.com|w3\.org|schema\.org|cloudflare\.com|googlegroups\.com)$/i;
const FILE_LIKE = /\.(png|jpe?g|gif|webp|svg|css|js|ico|woff2?)$/i;

function decodeCloudflareEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

function cleanEmail(raw: string): string | null {
  let e = raw.trim().toLowerCase();
  try { e = decodeURIComponent(e); } catch { /* keep as is */ }
  e = e.replace(/^mailto:/, "").split("?")[0].replace(/[.,;:]+$/, "");
  const m = e.match(EMAIL_RE);
  if (!m || m[0] !== e) return null;
  if (FILE_LIKE.test(e) || NOT_BUSINESS_EMAIL.test(e)) return null;
  if (/^(user|name|email|your(name|email)?|someone|test|john\.?doe|jane\.?doe)@/.test(e)) return null;
  // Hex-looking local parts are tracking ids (e.g. a1b2c3...@sentry).
  if (/^[0-9a-f]{16,}@/.test(e)) return null;
  return e;
}

export function emailsIn(html: string, pageUrl: string, siteHost: string | null): FoundEmail[] {
  const found = new Map<string, FoundEmail>();
  const add = (raw: string | null, how: FoundEmail["how"]) => {
    const email = raw ? cleanEmail(raw) : null;
    if (!email || found.has(email)) return;
    const domain = email.split("@")[1];
    const ownDomain = !!siteHost && (siteHost === domain || siteHost.endsWith(`.${domain}`) || domain.endsWith(`.${siteHost}`));
    found.set(email, { email, page: pageUrl, how, ownDomain });
  };
  for (const m of Array.from(html.matchAll(/href\s*=\s*["']\s*mailto:([^"'>\s]+)/gi))) add(m[1], "mailto");
  for (const m of Array.from(html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi))) add(decodeCloudflareEmail(m[1]), "protected");
  for (const m of Array.from(html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi))) add(decodeCloudflareEmail(m[1]), "protected");
  // Emails written on the page (visible text only, not scripts or styles).
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&#64;|&#x40;/gi, "@").replace(/&amp;/gi, "&");
  for (const m of Array.from(text.matchAll(EMAIL_RE))) add(m[0], "text");
  return Array.from(found.values());
}

/** Best first: on their own web address, then a mailto link, then the rest. */
export function sortEmails(emails: FoundEmail[]): FoundEmail[] {
  const rank = (e: FoundEmail) => (e.ownDomain ? 0 : 2) + (e.how === "text" ? 1 : 0) + (/^(info|contact|hello|orders?|catering|events)@/.test(e.email) ? 0 : 0.5);
  return [...emails].sort((a, b) => rank(a) - rank(b));
}

export function copyrightYear(html: string, now = new Date()): number | null {
  const text = html.replace(/&copy;|&#169;|&#xa9;/gi, "©").replace(/<[^>]*>/g, " ");
  let best: number | null = null;
  for (const m of Array.from(text.matchAll(/(?:©|\(c\)|copyright)\s*(?:©\s*)?(?:(\d{4})\s*(?:[-–—]|to)\s*)?(\d{4})/gi))) {
    const year = Number(m[2]);
    if (year >= 1995 && year <= now.getFullYear() && (best == null || year > best)) best = year;
  }
  return best;
}

export function hasViewport(html: string): boolean {
  return /<meta[^>]+name\s*=\s*["']?viewport/i.test(html);
}

const FORM_SERVICES = /jotform\.com|wufoo\.com|formspree\.io|typeform\.com|docs\.google\.com\/forms|forms\.gle|hsforms\.(net|com)|cognitoforms\.com|123formbuilder|formstack\.com|wpforms|contact-form-7|gform_wrapper|ninja-forms|fluentform|elementor-form|wixui-form|sqs-block-form|form-block/i;

export function hasContactForm(html: string): boolean {
  if (FORM_SERVICES.test(html)) return true;
  for (const m of Array.from(html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form\s*>/gi))) {
    const body = m[1];
    if (/<textarea\b/i.test(body) || /<input\b[^>]*type\s*=\s*["']?email/i.test(body)) {
      if (/search/i.test(m[0].slice(0, 200)) && !/<textarea\b/i.test(body)) continue;
      return true;
    }
  }
  return false;
}

const BUILDERS: [RegExp, string][] = [
  [/static\.wixstatic\.com|wix\.com\/|X-Wix|_wixCssImports|wixBiSession/i, "Wix"],
  [/squarespace\.com|static1\.squarespace|sqs-block/i, "Squarespace"],
  [/img1\.wsimg\.com|godaddy\.com\/websites|websites\.godaddy/i, "GoDaddy"],
  [/popmenu/i, "Popmenu"],
  [/getbento\.com|bentobox/i, "BentoBox"],
  [/spothopper/i, "SpotHopper"],
  [/irp\.cdn-website\.com|dudamobile|cdn-website\.com/i, "Duda"],
  [/weebly\.com|editmysite\.com/i, "Weebly / Square"],
  [/cdn\.shopify\.com/i, "Shopify"],
  [/webflow\.(com|io)/i, "Webflow"],
  [/wp-content|wp-includes/i, "WordPress"],
];
// Builders that commonly add ordering buttons with JavaScript after the page loads.
const JS_BUILDERS = new Set(["Wix", "Popmenu", "GoDaddy", "Duda", "SpotHopper"]);

export function siteBuilder(html: string): string | null {
  const generator = html.match(/<meta[^>]+name\s*=\s*["']generator["'][^>]+content\s*=\s*["']([^"']+)/i)?.[1];
  for (const [re, name] of BUILDERS) if (re.test(html)) return name;
  return generator ? generator.split(/[\s;]/)[0] : null;
}

function visibleTextLength(html: string): number {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
}

/** "Powered by Slice/ChowNow/Owner..." : the ordering company built and runs the site. */
export function orderingCompanyOwner(html: string, finalUrl: string): string | null {
  const byHost = orderingServiceForUrl(finalUrl);
  if (byHost?.buildsWebsites) return byHost.label;
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const m = text.match(/powered by\s+(slice|chownow|owner(?:\.com)?|menufy|beyondmenu|toast|popmenu|bentobox)/i);
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (name.startsWith("owner")) return "Owner.com";
  return ORDERING_SERVICES.find(s => s.label.toLowerCase().startsWith(name))?.label ??
    (name === "popmenu" ? "Popmenu" : name === "bentobox" ? "BentoBox" : null);
}

const EXTRA_PAGE = /contact|about|order|menu|delivery|takeout|take-out|pickup|location|find-us|visit/i;

// Contact pages first (emails, forms), then ordering pages, then the rest.
function pagePriority(path: string, text: string): number {
  const s = `${path} ${text}`;
  if (/contact|get-in-touch|reach-us/i.test(s)) return 0;
  if (/order|delivery|takeout|take-out|pickup/i.test(s)) return 1;
  if (/menu/i.test(s)) return 2;
  return 3;
}

function extraPages(html: string, base: string): string[] {
  const baseHost = hostOf(base);
  const candidates: { url: string; priority: number; index: number }[] = [];
  hrefs(html, base).forEach((link, index) => {
    const host = hostOf(link.url);
    if (!host || host !== baseHost) return;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?)(\?|$)/i.test(link.url)) return;
    const path = new URL(link.url).pathname;
    if (path === "/" || path === new URL(base).pathname) return;
    if (!EXTRA_PAGE.test(path) && !EXTRA_PAGE.test(link.text)) return;
    const clean = link.url.split("#")[0];
    if (!candidates.some(c => c.url === clean)) candidates.push({ url: clean, priority: pagePriority(path, link.text), index });
  });
  return candidates.sort((a, b) => a.priority - b.priority || a.index - b.index).slice(0, MAX_EXTRA_PAGES).map(c => c.url);
}

// ── The check ──────────────────────────────────────────────────────────────

function statusFromError(error: unknown): number | null {
  const m = String((error as Error)?.message ?? "").match(/HTTP (\d{3})/);
  return m ? Number(m[1]) : null;
}

function emptyWebsite(url: string | null, source: WebsiteFindings["source"]): WebsiteFindings {
  return {
    source, url, googleButton: url ? "ok" : "missing", loads: "unknown", httpStatus: null, finalUrl: null, error: null,
    copyrightYear: null, phoneFriendly: "unknown", contactForm: "unknown", builder: null, ownedByOrderingCompany: null, pagesRead: [],
  };
}

async function readPage(url: string, runtime?: SalonFetchRuntime) {
  const res = await fetchPublicPage(url, {
    timeoutMs: PAGE_TIMEOUT_MS,
    userAgent: BROWSER_UA,
    maxRedirects: 4,
    maxBytes: 4 * 1024 * 1024,
    runtime,
    allowRedirect: next => !isNeverOpenUrl(next.href),
  });
  return { html: res.body, finalUrl: res.finalUrl, status: res.status };
}

export async function checkWebsite(url: string | null, source: WebsiteFindings["source"], runtime?: SalonFetchRuntime): Promise<SiteCheck> {
  const website = emptyWebsite(url, source);
  const result: SiteCheck = { website, socialLinks: {}, orderingLinks: [], jsLoaded: false };
  if (!url) return result;
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  // Google's Website button goes to Facebook/Instagram: there is no real website. Never open it.
  const host = hostOf(full);
  const social = host ? SOCIAL_SITES.find(s => s.hosts.some(h => hostMatches(host, h))) : null;
  if (social) {
    website.googleButton = "social";
    if (social.key === "facebook" || social.key === "instagram") result.socialLinks[social.key] = { url: full, page: "Google listing" };
    return result;
  }
  // The "website" is an ordering/delivery page: record it, don't open it.
  const service = orderingServiceForUrl(full);
  if (service) {
    website.googleButton = "ordering_site";
    website.ownedByOrderingCompany = service.label;
    result.orderingLinks.push({ service: service.key, label: service.label, url: full, page: "Google listing" });
    return result;
  }
  if (isNeverOpenUrl(full)) return result;

  let home: { html: string; finalUrl: string; status: number };
  try {
    home = await readPage(full, runtime);
  } catch (error) {
    if (error instanceof RedirectRefused) {
      // The site forwards to Facebook or a delivery app: treat it like Google's button going there.
      const target = orderingServiceForUrl(error.target);
      website.finalUrl = error.target;
      website.loads = "yes";
      if (target) {
        website.googleButton = "ordering_site";
        website.ownedByOrderingCompany = target.label;
        result.orderingLinks.push({ service: target.key, label: target.label, url: error.target, page: full });
      } else {
        website.googleButton = "social";
        const t = hostOf(error.target) ?? "";
        if (hostMatches(t, "facebook.com")) result.socialLinks.facebook = { url: error.target, page: full };
        if (hostMatches(t, "instagram.com")) result.socialLinks.instagram = { url: error.target, page: full };
      }
      return result;
    }
    const status = statusFromError(error);
    website.httpStatus = status;
    website.error = String((error as Error)?.message ?? error).slice(0, 200);
    // 401/403/429/503 usually mean a bot shield, not a broken site; slow or very large pages aren't broken either.
    const slow = /timed out|size limit|socket hang up|ECONNRESET/i.test(website.error);
    if (slow || (status && [401, 403, 406, 429, 503].includes(status))) {
      website.loads = "unknown";
    } else {
      website.loads = "no";
      website.googleButton = source === "google" ? "dead" : website.googleButton;
    }
    return result;
  }

  website.loads = "yes";
  website.httpStatus = home.status;
  website.finalUrl = home.finalUrl;
  website.pagesRead.push(home.finalUrl);
  website.copyrightYear = copyrightYear(home.html);
  website.phoneFriendly = hasViewport(home.html) ? "yes" : "no";
  website.builder = siteBuilder(home.html);
  website.ownedByOrderingCompany = orderingCompanyOwner(home.html, home.finalUrl);
  let form = hasContactForm(home.html);
  const siteHost = hostOf(home.finalUrl);
  const emails: FoundEmail[] = emailsIn(home.html, home.finalUrl, siteHost);
  const addEmails = (list: FoundEmail[]) => { for (const e of list) if (!emails.some(x => x.email === e.email)) emails.push(e); };
  result.socialLinks = socialLinksIn(home.html, home.finalUrl);
  result.orderingLinks = orderingLinksIn(home.html, home.finalUrl);
  result.jsLoaded = (website.builder != null && JS_BUILDERS.has(website.builder)) || visibleTextLength(home.html) < 400;

  for (const page of extraPages(home.html, home.finalUrl)) {
    try {
      const p = await readPage(page, runtime);
      website.pagesRead.push(p.finalUrl);
      if (!form && hasContactForm(p.html)) form = true;
      addEmails(emailsIn(p.html, p.finalUrl, siteHost));
      const year = copyrightYear(p.html);
      if (year && (!website.copyrightYear || year > website.copyrightYear)) website.copyrightYear = year;
      for (const [key, link] of Object.entries(socialLinksIn(p.html, p.finalUrl)) as [SocialKey, FoundLink][]) {
        if (!result.socialLinks[key]) result.socialLinks[key] = link;
      }
      for (const link of orderingLinksIn(p.html, p.finalUrl)) {
        if (!result.orderingLinks.some(l => l.service === link.service)) result.orderingLinks.push(link);
      }
    } catch (error) {
      if (error instanceof RedirectRefused) {
        // e.g. an "Order" page that forwards to DoorDash: that is an ordering link, found without opening it.
        const target = orderingServiceForUrl(error.target);
        if (target && !result.orderingLinks.some(l => l.service === target.key)) {
          result.orderingLinks.push({ service: target.key, label: target.label, url: error.target, page });
        }
      }
      // Other extra-page failures don't change the home-page result.
    }
  }
  website.contactForm = form ? "yes" : (result.jsLoaded ? "unknown" : "no");
  website.emails = sortEmails(emails).slice(0, 5);
  return result;
}

/** Steps 6b and 7: what the business's own site says about ordering. */
export function orderingFromSite(check: SiteCheck): Pick<OrderingFindings, "siteLinks" | "sendsToApps" | "ownOrdering" | "ownOrderingPlatform"> {
  const w = check.website;
  if (!w.url || w.googleButton === "social") {
    return { siteLinks: check.orderingLinks, sendsToApps: "no_website", ownOrdering: "no_website", ownOrderingPlatform: null };
  }
  const links = check.orderingLinks;
  const marketplace = links.filter(l => ORDERING_SERVICES.find(s => s.key === l.service)?.marketplace);
  const own = links.filter(l => ORDERING_SERVICES.find(s => s.key === l.service)?.ownOrdering);
  const unreadable = w.loads !== "yes" && w.googleButton !== "ordering_site";
  const sendsToApps: YesNoUnknown = marketplace.length > 0 ? "yes" : (unreadable || check.jsLoaded ? "unknown" : "no");
  const ownOrdering: YesNoUnknown = own.length > 0 ? "yes" : (unreadable || check.jsLoaded ? "unknown" : "no");
  return { siteLinks: links, sendsToApps, ownOrdering, ownOrderingPlatform: own[0]?.label ?? null };
}
