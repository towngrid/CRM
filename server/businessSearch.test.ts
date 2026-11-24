import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideLeadType, dedupKeys, estimateCredits, isNeverOpenUrl, normalizePlace, resultMatchesBusiness, townAndZip, townForZip,
} from "@shared/businessSearch";
import { checkWebsite, copyrightYear, hasContactForm, orderingFromSite, orderingLinksIn, socialLinksIn } from "./businessSearch/website";
import type { SalonFetchRuntime } from "./salonPublicFetch";

const NOW = new Date("2026-11-23T12:00:00Z");
const site = (over: Partial<Parameters<typeof decideLeadType>[0]["website"]> = {}) => ({
  url: "https://joes.example", loads: "yes" as const, copyrightYear: 2026, phoneFriendly: "yes" as const, googleButton: "ok" as const, ...over,
});

test("Get Seen lead types follow the spec", () => {
  const base = { list: "get_seen" as const, now: NOW };
  assert.equal(decideLeadType({ ...base, website: site({ url: null, googleButton: "missing" }), hasFacebook: true, hasInstagram: false }), "social_no_website");
  assert.equal(decideLeadType({ ...base, website: site({ url: null, googleButton: "missing" }), hasFacebook: false, hasInstagram: false }), "starting_from_scratch");
  assert.equal(decideLeadType({ ...base, website: site({ copyrightYear: 2023 }), hasFacebook: true, hasInstagram: true }), "old_or_broken_website");
  assert.equal(decideLeadType({ ...base, website: site({ loads: "no" }), hasFacebook: false, hasInstagram: false }), "old_or_broken_website");
  assert.equal(decideLeadType({ ...base, website: site({ phoneFriendly: "no" }), hasFacebook: true, hasInstagram: false }), "old_or_broken_website");
  assert.equal(decideLeadType({ ...base, website: site(), hasFacebook: false, hasInstagram: false }), "website_no_social");
  assert.equal(decideLeadType({ ...base, website: site(), hasFacebook: true, hasInstagram: true }), "already_online");
  // Google's Website button goes to Facebook: that's not a website.
  assert.equal(decideLeadType({ ...base, website: site({ googleButton: "social" }), hasFacebook: true, hasInstagram: false }), "social_no_website");
  // A 2024 copyright is fine in 2026; 2023 is 3+ years old.
  assert.equal(decideLeadType({ ...base, website: site({ copyrightYear: 2024 }), hasFacebook: true, hasInstagram: false }), "already_online");
});

test("Ordering lead types follow the spec", () => {
  const base = { list: "ordering" as const, website: site(), hasFacebook: true, hasInstagram: true, now: NOW };
  const ordering = { ownOrdering: "no" as const, sendsToApps: "no" as const, appsFromSearch: [], siteLinks: [] };
  assert.equal(decideLeadType({ ...base, ordering: { ...ordering, ownOrdering: "yes" } }), "own_ordering_already");
  assert.equal(decideLeadType({ ...base, ordering: { ...ordering, appsFromSearch: [{ service: "doordash", label: "DoorDash", url: "u", title: "t" }] } }), "delivery_apps_no_own_ordering");
  assert.equal(decideLeadType({ ...base, ordering: { ...ordering, sendsToApps: "yes" } }), "delivery_apps_no_own_ordering");
  assert.equal(decideLeadType({ ...base, ordering }), "no_online_ordering");
});

test("search results only count when name and town or phone match", () => {
  const biz = { name: "Joe's Pizzeria of Glen Cove", town: "Glen Cove", phone: "(516) 555-0123" };
  assert.ok(resultMatchesBusiness({ title: "Joe's Pizzeria - Glen Cove, NY - Menu | DoorDash" }, biz));
  assert.ok(resultMatchesBusiness({ title: "Joes Pizzeria", snippet: "Call 516-555-0123 to order" }, biz));
  assert.ok(!resultMatchesBusiness({ title: "Joe's Pizzeria - Massapequa, NY" }, biz));
  assert.ok(!resultMatchesBusiness({ title: "Tony's Pizzeria - Glen Cove, NY" }, biz));
});

test("lessons from the Glen Cove test (Nov 24)", () => {
  // "Ave" must not match "Avenue": Forest Ave Grill is not Forest Avenue Pizza.
  assert.ok(!resultMatchesBusiness({ title: "Forest Avenue Pizza - Glen Cove - Grubhub", link: "https://www.grubhub.com/restaurant/forest-avenue-pizza-90-forest-ave-glen-cove/1" },
    { name: "Forest Ave Grill", town: "Glen Cove" }));
  assert.ok(!resultMatchesBusiness({ title: "Forest Avenue Pizza Delivery Menu - Glen Cove", snippet: "Order from 90 Forest Ave, Glen Cove" },
    { name: "Forest Ave Grill", town: "Glen Cove" }));
  assert.ok(resultMatchesBusiness({ title: "Green Eats - Glen Cove", link: "https://greeneatsli.com" }, { name: "Green Eats", town: "Glen Cove" }));
  assert.equal(socialLinksIn(`<a href="https://www.facebook.com/events/capri-246/27497/">x</a>`, "https://x.example/").facebook, undefined);
  // Page code and the builder's own account aren't the business's Facebook.
  const html = `<html xmlns:fb="http://www.facebook.com/2008/fbml"><a href="https://www.facebook.com/wix">Wix</a>
    <a href="https://www.instagram.com/popular/american-cafe-glen-cove/">x</a><a href="https://www.facebook.com/RealPlace">fb</a></html>`;
  const social = socialLinksIn(html, "https://x.example/");
  assert.equal(social.facebook?.url, "https://www.facebook.com/RealPlace");
  assert.equal(social.instagram, undefined);
  // An ordering page isn't a website (Get Seen list).
  assert.equal(decideLeadType({ list: "get_seen", now: NOW, website: site({ googleButton: "ordering_site" }), hasFacebook: true, hasInstagram: false }), "social_no_website");
});

test("slow or very large websites are 'couldn't check', not broken", async () => {
  const runtime: SalonFetchRuntime = {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () => { throw new Error("Public page request timed out"); },
  };
  const result = await checkWebsite("https://slow.example/", "google", runtime);
  assert.equal(result.website.loads, "unknown");
  assert.equal(result.website.googleButton, "ok");
});

test("places, towns and duplicates", () => {
  assert.equal(townForZip("11542"), "Glen Cove");
  assert.equal(normalizePlace(" 11542 "), "11542");
  assert.equal(normalizePlace("Glen Cove"), "Glen Cove");
  assert.equal(normalizePlace("<script>"), null);
  assert.deepEqual(townAndZip("10 School St, Glen Cove, NY 11542"), { town: "Glen Cove", zip: "11542" });
  const a = dedupKeys({ name: "Joe's", address: "1 Main St", phone: "516-555-0123", website: "https://www.joes.com/" });
  const b = dedupKeys({ name: "Joes Pizza", address: "2 Elm", phone: null, website: "http://joes.com" });
  assert.ok(a.some(k => b.includes(k)), "same website = duplicate");
  // Two businesses that both "have" a DoorDash page aren't duplicates.
  const c = dedupKeys({ name: "A", website: "https://www.doordash.com/store/a" });
  const d = dedupKeys({ name: "B", website: "https://www.doordash.com/store/a" });
  assert.ok(!c.some(k => d.includes(k)));
});

test("credit estimate: Maps per place, then up to 3 per business on the Ordering list", () => {
  const e = estimateCredits(1, 1, "ordering");
  assert.equal(e.mapsCalls, 1);
  assert.equal(e.max, 1 + 20 * 3);
  assert.ok(e.likely < e.max && e.likely > 20);
  assert.equal(estimateCredits(2, 1, "get_seen").max, 2 + 40 * 2);
});

test("never opens Facebook, Instagram, Yelp, BBB or delivery-app pages", () => {
  for (const u of ["https://www.facebook.com/joes", "https://instagram.com/joes", "https://m.yelp.com/biz/x", "https://www.bbb.org/us/x",
    "https://www.doordash.com/store/x", "https://www.grubhub.com/x", "https://www.ubereats.com/x", "https://slicelife.com/x"]) {
    assert.ok(isNeverOpenUrl(u), u);
  }
  assert.ok(!isNeverOpenUrl("https://joespizza.com"));
});

test("reads social and ordering links from raw page source, including escaped JSON", () => {
  const html = `<footer><a href="https://www.facebook.com/JoesPizzaGC">fb</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
    <script>var s={"ig":"https:\\/\\/www.instagram.com\\/joespizzagc\\/"}</script>
    <a href="https://order.online/store/joes-123">Order Online</a>
    <a href="https://www.doordash.com/store/joes-pizza-glen-cove-456/">Delivery</a>
    <img src="https://cdn.doordash.com/logo.png">
    © 2019 Joe's Pizza</footer>`;
  const social = socialLinksIn(html, "https://joes.example/");
  assert.equal(social.facebook?.url, "https://www.facebook.com/JoesPizzaGC");
  assert.equal(social.instagram?.url, "https://www.instagram.com/joespizzagc/");
  const ordering = orderingLinksIn(html, "https://joes.example/");
  assert.deepEqual(ordering.map(o => o.service).sort(), ["doordash", "doordash_storefront"]);
  assert.equal(copyrightYear(html, NOW), 2019);
  assert.equal(copyrightYear("Copyright &copy; 2012 - 2025 Joe's", NOW), 2025);
});

test("contact forms", () => {
  assert.ok(hasContactForm(`<form><input type="email" name="e"><textarea></textarea><button>Send</button></form>`));
  assert.ok(!hasContactForm(`<form role="search"><input type="text" name="q"></form>`));
  assert.ok(hasContactForm(`<iframe src="https://form.jotform.com/123"></iframe>`));
});

function fakeRuntime(pages: Record<string, { status: number; body?: string; location?: string }>, opened: string[]): SalonFetchRuntime {
  return {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url) => {
      opened.push(url.href);
      const page = pages[url.href] ?? { status: 404, body: "" };
      return {
        status: page.status,
        headers: { "content-type": "text/html", ...(page.location ? { location: page.location } : {}) },
        body: page.body ?? "",
      };
    },
  };
}

test("a website that redirects to Facebook is never opened past the redirect", async () => {
  const opened: string[] = [];
  const runtime = fakeRuntime({ "https://joes.example/": { status: 301, location: "https://www.facebook.com/joes" } }, opened);
  const result = await checkWebsite("https://joes.example/", "google", runtime);
  assert.deepEqual(opened, ["https://joes.example/"]);
  assert.equal(result.website.googleButton, "social");
  assert.equal(result.socialLinks.facebook?.url, "https://www.facebook.com/joes");
});

test("Google's Website button pointing to Facebook or DoorDash isn't opened at all", async () => {
  const opened: string[] = [];
  const runtime = fakeRuntime({}, opened);
  const fb = await checkWebsite("https://www.facebook.com/joes", "google", runtime);
  assert.equal(fb.website.googleButton, "social");
  const dd = await checkWebsite("https://www.doordash.com/store/joes-1", "google", runtime);
  assert.equal(dd.website.googleButton, "ordering_site");
  assert.deepEqual(opened, []);
});

test("own website: reads home and Order page, finds delivery buttons", async () => {
  const opened: string[] = [];
  const home = `<html><head><meta name="viewport" content="width=device-width"></head><body>
    ${"Welcome to Joe's, family owned since 1980. ".repeat(20)}
    <a href="/order">Order</a><a href="https://instagram.com/joes">ig</a> © 2025</body></html>`;
  const order = `<html><body><a href="https://www.grubhub.com/restaurant/joes-1">Grubhub</a>
    <a href="https://www.toasttab.com/joes/v3">Order pickup</a></body></html>`;
  const runtime = fakeRuntime({ "https://joes.example/": { status: 200, body: home }, "https://joes.example/order": { status: 200, body: order } }, opened);
  const result = await checkWebsite("https://joes.example/", "google", runtime);
  assert.equal(result.website.loads, "yes");
  assert.equal(result.website.phoneFriendly, "yes");
  assert.equal(result.website.copyrightYear, 2025);
  assert.ok(opened.every(u => u.startsWith("https://joes.example/")));
  const o = orderingFromSite(result);
  assert.equal(o.sendsToApps, "yes");
  assert.equal(o.ownOrdering, "yes");
  assert.equal(o.ownOrderingPlatform, "Toast");
  assert.equal(o.siteLinks.find(l => l.service === "grubhub")?.page, "https://joes.example/order");
});
