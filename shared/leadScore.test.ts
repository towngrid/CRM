import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SCORE_POINTS, chainKey, chainNames, mergeScorePoints, reasonsText, scoreLead, type ScoreInput } from "./leadScore";

const NOW = new Date("2026-11-24T12:00:00Z");
const points = mergeScorePoints({});
const base = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  leadList: "get_seen", rating: 4.6, reviewCount: 157, googleStatus: "open", lastPostDate: null,
  top3AverageReviews: 300, chainReason: null, manualSetAside: null, now: NOW,
  findings: {
    website: { url: "https://joes.example", source: "google", googleButton: "ok", loads: "yes", copyrightYear: 2026, phoneFriendly: "yes", ownedByOrderingCompany: null },
    social: { facebookUrl: "https://facebook.com/joes", instagramUrl: null, notLinkedFromSite: false },
    ordering: null,
  },
  ...over,
});
const keys = (r: ReturnType<typeof scoreLead>) => r.reasons.map(x => x.key).sort();

test("a busy business that already has everything scores low (tier C)", () => {
  const r = scoreLead(base(), points);
  assert.deepEqual(keys(r), ["good_rating"]);
  assert.equal(r.score, 10);
  assert.equal(r.tier, "C");
});

test("no website at all = +25 only, never +45 (Seann, Nov 24)", () => {
  const r = scoreLead(base({ findings: { website: { url: null, source: "none", googleButton: "missing" }, social: { facebookUrl: null, instagramUrl: null } } }), points);
  assert.deepEqual(keys(r), ["good_rating", "no_social", "no_website"]);
  assert.equal(r.score, 25 + 10 + 10);
  assert.equal(r.tier, "B");
});

test("Google's Website button goes to Facebook = +25 no website and +20", () => {
  const r = scoreLead(base({ findings: { website: { url: "https://facebook.com/x", googleButton: "social" }, social: { facebookUrl: "https://facebook.com/x" } } }), points);
  assert.deepEqual(keys(r), ["good_rating", "google_button_problem", "no_website"]);
  assert.equal(r.score, 55);
});

test("old website, not phone-friendly, run by Slice, few reviews", () => {
  const r = scoreLead(base({
    reviewCount: 40, top3AverageReviews: 400,
    findings: { website: { url: "https://x.example", source: "google", googleButton: "ok", loads: "yes", copyrightYear: 2019, phoneFriendly: "no", ownedByOrderingCompany: "Slice" }, social: { facebookUrl: "f" } },
  }), points);
  assert.deepEqual(keys(r), ["few_reviews", "good_rating", "old_website", "ordering_company_website"]);
  assert.match(reasonsText(r.reasons), /\+15 website © 2019, not phone-friendly/);
});

test("restaurants get ordering points on top of Get Seen points (Seann, Nov 24)", () => {
  const r = scoreLead(base({
    leadList: "ordering",
    findings: {
      website: { url: "https://x.example", source: "google", googleButton: "ok", loads: "yes", copyrightYear: 2026, phoneFriendly: "yes" },
      social: { facebookUrl: null, instagramUrl: "i", notLinkedFromSite: true },
      ordering: { ownOrdering: "no", sendsToApps: "yes", appsFromSearch: [{ service: "doordash" }, { service: "slice" }], siteLinks: [{ service: "ubereats" }] },
    },
  }), points);
  assert.deepEqual(keys(r), ["apps_no_own_ordering", "good_rating", "order_button_to_apps", "slice", "social_not_linked"]);
  assert.equal(r.score, 25 + 20 + 10 + 10 + 5);
  assert.equal(r.tier, "A");
});

test("own ordering already: no 'on apps, no own ordering' points; GloriaFood +30", () => {
  const f = (platform: string) => ({ website: { url: "u", googleButton: "ok", loads: "yes", phoneFriendly: "yes" }, social: { facebookUrl: "f" },
    ordering: { ownOrdering: "yes", ownOrderingPlatform: platform, sendsToApps: "no", appsFromSearch: [{ service: "doordash" }], siteLinks: [] } });
  assert.deepEqual(keys(scoreLead(base({ leadList: "ordering", findings: f("Toast") }), points)), ["good_rating"]);
  assert.deepEqual(keys(scoreLead(base({ leadList: "ordering", findings: f("GloriaFood") }), points)), ["gloriafood", "good_rating"]);
});

test("knock-outs are set aside, not scored", () => {
  assert.equal(scoreLead(base({ googleStatus: "permanently_closed" }), points).setAsideReason, "Google says permanently closed");
  assert.equal(scoreLead(base({ chainReason: "same name at 3 addresses" }), points).score, null);
  assert.equal(scoreLead(base({ manualSetAside: "no in-person service" }), points).setAsideReason, "no in-person service");
});

test("hand check: a post in the last 30 days adds points; edited values and tiers apply", () => {
  assert.ok(keys(scoreLead(base({ lastPostDate: "2026-11-10" }), points)).includes("recent_social_post"));
  const edited = mergeScorePoints({ good_rating: 50, tier_a: 50 });
  assert.equal(scoreLead(base(), edited).tier, "A");
  assert.equal(DEFAULT_SCORE_POINTS.find(p => p.key === "tier_a")?.points, 60);
});

test("chains: same name at two addresses", () => {
  assert.equal(chainKey("Plado Tasting Bar - Glen Cove", "Glen Cove"), "plado tasting bar");
  assert.equal(chainKey("Tocolo Cantina Glen Cove", "Glen Cove"), "tocolo cantina");
  assert.equal(chainKey("WOKOBOWL Modern Chinese Bowls（Glen Cove）", "Glen Cove"), "wokobowl modern chinese bowls");
  const chains = chainNames([
    { name: "Tocolo Cantina Glen Cove", town: "Glen Cove", address: "120 Village Sq" },
    { name: "Tocolo Cantina", town: "Garden City", address: "920 Franklin Ave" },
    { name: "Green Eats", town: "Glen Cove", address: "17 Bridge St" },
  ]);
  assert.equal(chains.get("tocolo cantina"), 2);
  assert.equal(chains.has("green eats"), false);
});
