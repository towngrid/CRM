import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_OWNER_NAME_RESULT, isStrongApprovedOwnerCandidate, type OwnerNameResult } from "@shared/salonOwnerName";
import type { SalonEnrichmentRow } from "@shared/schema";
import {
  businessAndLocationMatch,
  configureSalonOwnerNameDependencies,
  estimateSalonOwnerNameSearch,
  extractSalonOwnerCandidates,
  extractSalonOwnerSummaryCandidates,
  isSalonOwnerNameEligible,
  lookupSalonOwnerName,
  lookupSalonOwnerNameBatch,
  salonOwnerSearchQueries,
  ownerLookupWebsiteUrl,
  salonOwnerNameLimits,
  stripHtml,
  validatePublicHttpUrl,
} from "./salonOwnerNames";
import type { SalonOwnerNameDependencies } from "./salonOwnerNames";
import { ownerNameRowsInput, ownerNameSearchInput } from "./salonOwnerNameSearchInput";
import { ownerDiscoveryLocation, prioritizeOwnerResults } from "./salonOwnerDiscovery";
import { mentionsOwnerBusiness, relevantOwnerCandidate } from "@shared/salonOwnerDiscoveryRelevance";

const identity = {
  businessName: "Curly Tails",
  address: "5651 Tourist Dr",
  address1: "5651 Tourist Dr",
  city: "North Richland Hills",
  state: "TX",
  zipCode: "76117",
  websiteUrl: "https://www.curlytailsgrooming.com/",
};
const source = {
  url: "https://www.curlytailsgrooming.com/about",
  excerpt: "Business/location verification: Curly Tails at 5651 Tourist Dr, North Richland Hills TX 76117.",
  kind: "website_about",
};

test("owner extraction recognizes full names and independently confirms explicit owner roles", () => {
  const text = "Eliud Jimenez Founder & Groomer. Curly Tails is at 5651 Tourist Dr, North Richland Hills, TX 76117.";
  assert.equal(businessAndLocationMatch(identity, text), true);
  const candidates = extractSalonOwnerCandidates(text, source, true, false, identity.businessName);
  const eliud = candidates.find(candidate => candidate.firstName === "Eliud");
  assert.ok(eliud);
  assert.equal(eliud.lastName, "Jimenez");
  assert.equal(eliud.roleConfirmed, true);
  assert.equal(eliud.businessMatched, true);
  assert.equal(eliud.confidence, "high");
  assert.equal(isStrongApprovedOwnerCandidate({
    status: "needs_review",
    candidates,
    selectedCandidateId: eliud.id,
    approvedAt: new Date().toISOString(),
    usePersonalName: true,
    providerCalls: 0,
    pagesFetched: 1,
  }), eliud);

  const ownerPagePhrase = "Curly Tails, 5651 Tourist Dr, North Richland Hills TX 76117. As a business owner, founder Eliud Jimenez is committed to building the salon.";
  const founder = extractSalonOwnerCandidates(ownerPagePhrase, source, true, false, identity.businessName)
    .find(candidate => candidate.firstName === "Eliud");
  assert.ok(founder);
  assert.equal(founder.lastName, "Jimenez");
  assert.equal(founder.roleConfirmed, true);

  const capitalizedRole = extractSalonOwnerCandidates(
    "Curly Tails, 5651 Tourist Dr, North Richland Hills TX 76117. Founder & Groomer Eliud Jimenez.",
    source,
    true,
    false,
    identity.businessName,
  ).find(candidate => candidate.firstName === "Eliud");
  assert.ok(capitalizedRole);
  assert.equal(capitalizedRole.lastName, "Jimenez");
  assert.equal(capitalizedRole.roleConfirmed, true);

  const internalInitial = extractSalonOwnerCandidates(
    "Owner: Jane Q. Smith. Curly Tails, 5651 Tourist Dr, North Richland Hills TX 76117.",
    source,
    true,
    false,
    identity.businessName,
  ).find(candidate => candidate.firstName === "Jane");
  assert.ok(internalInitial);
  assert.equal(internalInitial.lastName, "Q Smith");

  const sentenceBoundary = extractSalonOwnerCandidates(
    "Owner: Jane. Sarah Smith provides grooming at the salon.",
    source,
    true,
    true,
    identity.businessName,
  );
  assert.deepEqual(sentenceBoundary.map(candidate => [candidate.firstName, candidate.lastName]), [["Jane", null]]);
});

test("exact business and location checks reject unrelated locations and business names", () => {
  assert.equal(businessAndLocationMatch(identity, "Curly Tails, 100 Main St, Dallas TX 75201"), false);
  assert.equal(businessAndLocationMatch(identity, "Curly Tails, 100 Main St, North Richland Hills TX 76117"), false);
  assert.equal(businessAndLocationMatch(identity, "Curly Tail, 5651 Tourist Dr North Richland Hills TX 76117"), false);
  assert.equal(businessAndLocationMatch(identity, "Other Salon, 5651 Tourist Dr North Richland Hills TX 76117"), false);
  assert.equal(businessAndLocationMatch(identity, "Curly Tails Grooming, 5651 Tourist Dr North Richland Hills TX 76117"), false);
  assert.equal(businessAndLocationMatch(identity, "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76118"), false);
  assert.equal(businessAndLocationMatch(identity, "Curly Tails, 5651 Tourist Dr Arlington TX 76117"), false);
  assert.equal(businessAndLocationMatch({ businessName: "Curly Tails" } as any, "Curly Tails owner Jane Smith"), false);
  assert.equal(
    businessAndLocationMatch(identity, "Curly Tails 5651 Tourist Dr NorthRichlandHillsTX76117"),
    true,
  );
});

test("historical, operator-only, staff, and review mentions do not confirm current ownership", () => {
  const examples = [
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Operated by Eliud Jimenez.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Eliud Jimenez was the owner.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Former owner: Eliud Jimenez.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Staff member Jane Smith says Eliud Jimenez is the owner.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Reviewer Jane Smith says Eliud Jimenez is the owner.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117.\nTestimonials\nEliud Jimenez is the owner of another salon.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Owner: Jane. Sarah Smith provides grooming.",
  ];
  for (const text of examples) {
    const candidates = extractSalonOwnerCandidates(text, source, true, false, identity.businessName);
    assert.ok(candidates.every(candidate => !candidate.roleConfirmed), text);
  }
});

test("distinct co-owners remain separate candidates and staff are never confirmed owners", () => {
  const pair = "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Jane Smith and Elizabeth Jones are co-owners.";
  const candidates = extractSalonOwnerCandidates(pair, source, true);
  assert.deepEqual(candidates.map(candidate => [candidate.firstName, candidate.lastName]), [
    ["Jane", "Smith"],
    ["Elizabeth", "Jones"],
  ]);
  assert.ok(candidates.every(candidate => candidate.roleConfirmed && candidate.role === "co-owner"));

  const staffText = "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Jane Smith is our groomer.";
  const staff = extractSalonOwnerCandidates(staffText, source, true);
  assert.equal(staff.length, 1);
  assert.equal(staff[0].roleConfirmed, false);
  assert.equal(staff[0].businessMatched, true);

  const firstOnly = extractSalonOwnerCandidates(
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Owner: Jacqueline Contact Us",
    source,
    true,
    true,
    identity.businessName,
  );
  assert.deepEqual(firstOnly.map(candidate => [candidate.firstName, candidate.lastName]), [["Jacqueline", null]]);
  assert.equal(firstOnly[0].roleConfirmed, true);
});

test("search summary names remain unresolved and company/title words are not emitted as people", () => {
  const nextdoor = extractSalonOwnerSummaryCandidates(
    "A Dog's Tail team mentions Jacqueline and Elizabeth as neighborhood favorites.",
    { url: "https://www.nextdoor.com/public/", excerpt: "", kind: "organic_summary" },
  );
  assert.deepEqual(nextdoor.map(candidate => candidate.firstName), ["Jacqueline", "Elizabeth"]);
  assert.ok(nextdoor.every(candidate => candidate.lastName === null && !candidate.roleConfirmed));

  const roleSummary = extractSalonOwnerSummaryCandidates(
    "A Dog's Tail says Jacqueline and Elizabeth are co-owners according to a neighbor.",
    { url: "https://www.nextdoor.com/public/", excerpt: "", kind: "organic_summary" },
  );
  assert.deepEqual(roleSummary.map(candidate => candidate.firstName), ["Jacqueline", "Elizabeth"]);
  assert.ok(roleSummary.every(candidate =>
    candidate.lastName === null && !candidate.roleConfirmed && !candidate.businessMatched,
  ));

  assert.deepEqual(
    extractSalonOwnerCandidates("Owner: The Curly Tails Grooming Salon", source, true),
    [],
  );
});

test("explicit fetched-page owner evidence is approvable", () => {
  const candidate = extractSalonOwnerCandidates(
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Owner: Eliud Jimenez.",
    source,
    true,
  )[0];
  const approved: OwnerNameResult = {
    status: "needs_review",
    candidates: [candidate],
    selectedCandidateId: candidate.id,
    approvedAt: "2026-01-01T00:00:00.000Z",
    usePersonalName: true,
    providerCalls: 1,
    pagesFetched: 2,
  };
  assert.equal(isStrongApprovedOwnerCandidate(approved), candidate);
});

test("owner lookup request and page ceilings stay bounded", () => {
  assert.equal(salonOwnerNameLimits.maxRowsPerRequest, 5);
  assert.equal(salonOwnerNameLimits.maxPagesPerRow, 4);
});

test("public page fetching rejects private, local, unsupported, and credential-bearing URLs", async () => {
  await assert.rejects(validatePublicHttpUrl("http://127.0.0.1/admin"), /public HTTP\(S\)|private/i);
  await assert.rejects(validatePublicHttpUrl("http://192.168.1.15/"), /public HTTP\(S\)|private/i);
  await assert.rejects(validatePublicHttpUrl("http://[::ffff:7f00:1]/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("http://[::ffff:a9fe:a9fe]/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("http://[::ffff:a00:1]/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("http://[2001:db8::1]/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("http://[fe80::1]/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("http://localhost/"), /public HTTP\(S\)/i);
  await assert.rejects(validatePublicHttpUrl("http://0x7f000001/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("ftp://example.com/file"), /public HTTP\(S\)/i);
  await assert.rejects(validatePublicHttpUrl("https://user:pass@example.com/"), /public HTTP\(S\)/i);
});

test("HTML text extraction retains paragraph boundaries and removes testimonial blocks", () => {
  assert.equal(
    stripHtml("<main><p>Owner: Jane</p><p>Contact Us</p><section class='testimonials'><p>Reviewer John says Jane owns a salon</p></section></main>"),
    "Owner: Jane\nContact Us",
  );
});

function orchestrationRow(overrides: Record<string, unknown> = {}): SalonEnrichmentRow {
  return {
    id: "salon-owner-test-row",
    userId: "salon-owner-test-user",
    ...identity,
    sourceData: { category: "Pet Grooming" },
    evidence: { ownerName: { status: "needs_review", selectedCandidateId: "old", approvedAt: "old", usePersonalName: true } },
    serpCallsUsed: 0,
    ...overrides,
  } as unknown as SalonEnrichmentRow;
}

function mockDependencies(
  row: SalonEnrichmentRow,
  options: {
    cached?: Array<{ title?: string; link?: string; snippet?: string }>;
    fetchPage?: SalonOwnerNameDependencies["fetchPage"];
    fetchProvider?: SalonOwnerNameDependencies["fetchProvider"];
    providerTimeoutMs?: number;
    reserve?: string | null;
    reserveLimit?: number;
    usage?: unknown;
    complete?: boolean;
    completeFailures?: number;
    cacheByKey?: Record<string, unknown>;
    rows?: SalonEnrichmentRow[];
    fault?: { stage: "cache" | "usage" | "reservation" | "rowRead"; at: number };
    deleteFirstRowOnCompletion?: boolean;
  } = {},
) {
  const observed = {
    begin: 0,
    complete: 0,
    cacheReads: 0,
    reservations: 0,
    releases: 0,
    providerAttempts: 0,
    pageAttempts: 0,
    token: "",
    persisted: null as OwnerNameResult | null,
    queries: [] as string[],
    cacheKeys: [] as string[],
    writtenKeys: [] as string[],
    usageReads: 0,
    rowReads: 0,
  };
  const current = { ...row };
  const usageStatus = (options.usage || {
    config: { maxSerpCallsPerHour: 5 },
    usage: { monthlyQuota: 100, usedCredits: 0, hardStopAt: 100 },
  }) as Awaited<ReturnType<SalonOwnerNameDependencies["getUsageStatus"]>>;
  const fakeStorage = {
    beginSalonOwnerNameLookup: async (rowId: string, _userId: string, token: string) => {
      observed.begin++;
      observed.token = token;
      return options.rows?.find(row => row.id === rowId) || current;
    },
    completeSalonOwnerNameLookup: async (_rowId: string, _userId: string, token: string, result: OwnerNameResult) => {
      observed.complete++;
      assert.equal(token, observed.token);
      observed.persisted = result;
      if (observed.complete <= (options.completeFailures || 0)) throw new Error("mock persistence failure");
      return options.complete ?? true;
    },
    getSalonEnrichmentRow: async (rowId: string) => {
      observed.rowReads++;
      if (options.fault?.stage === "rowRead" && observed.rowReads === options.fault.at) throw new Error("mock row-read failure");
      if (options.deleteFirstRowOnCompletion && observed.complete > 0 && rowId === row.id) return undefined;
      return options.rows?.find(row => row.id === rowId) || current;
    },
    getSerpCache: async (_zip: string, key: string) => {
      observed.cacheReads++;
      observed.cacheKeys.push(key);
      if (options.fault?.stage === "cache" && observed.cacheReads === options.fault.at) throw new Error("mock cache-read failure");
      const cached = options.cacheByKey?.[key] ?? options.cached;
      return cached ? { resultsJson: cached } : undefined;
    },
    reserveSerpCall: async () => {
      observed.reservations++;
      if (options.fault?.stage === "reservation" && observed.reservations === options.fault.at) throw new Error("mock reservation failure");
      if (observed.reservations > (options.reserveLimit ?? Infinity)) return null;
      return options.reserve === undefined ? "mock-reservation" : options.reserve;
    },
    releaseSerpCall: async () => { observed.releases++; },
    createSerpCache: async (_zip: string, key: string, _state: string, results: any[]) => {
      observed.writtenKeys.push(key);
      if (options.cacheByKey) options.cacheByKey[key] = results;
      return {} as any;
    },
    getSerpCallsInLastHour: async () => 0,
    revokeSalonOwnerName: async () => undefined,
  };
  const restore = configureSalonOwnerNameDependencies({
    storage: fakeStorage as unknown as SalonOwnerNameDependencies["storage"],
    getUsageStatus: async () => {
      observed.usageReads++;
      if (options.fault?.stage === "usage" && observed.usageReads === options.fault.at) throw new Error("mock usage-read failure");
      return usageStatus;
    },
    fetchPage: async url => {
      observed.pageAttempts++;
      if (options.fetchPage) return options.fetchPage(url);
      throw new Error("mock page fetch failed");
    },
    fetchProvider: async (...args) => {
      observed.providerAttempts++;
      observed.queries.push(new URL(String(args[0])).searchParams.get("q")!);
      if (options.fetchProvider) return options.fetchProvider(...args);
      throw new Error("mock provider timeout");
    },
    providerTimeoutMs: options.providerTimeoutMs,
  });
  return { observed, restore };
}

test("real lookup orchestration finds first-name-only owner on long official page and stops before paid search", async () => {
  const row = orchestrationRow();
  const deps = mockDependencies(row, {
    fetchPage: async url => ({
      url,
      html: `<main><p>Curly Tails, 5651 Tourist Dr, North Richland Hills, TX 76117.</p>${"Salon story. ".repeat(1800)}<p>Owner: Jacqueline</p></main>`,
    }),
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.ok(result);
    const jacqueline = result.candidates.find(candidate => candidate.firstName === "Jacqueline");
    assert.ok(jacqueline);
    assert.equal(jacqueline.lastName, null);
    assert.equal(jacqueline.roleConfirmed, true);
    assert.equal(result.selectedCandidateId, null);
    assert.equal(result.approvedAt, null);
    assert.equal(result.usePersonalName, false);
    assert.equal(result.providerCalls, 0);
    assert.equal(result.pagesFetched, 1);
    assert.equal(deps.observed.providerAttempts, 0);
    assert.equal(deps.observed.cacheReads, 0);
    assert.equal(deps.observed.begin, 1);
    assert.equal(deps.observed.complete, 1);
  } finally {
    deps.restore();
  }
});

test("reviewed first-party email pages seed free owner lookup even without a saved website", async () => {
  const row = orchestrationRow({
    websiteUrl: null,
    email: "hello@example.test",
    sourceData: { category: "Pet Grooming", Outcome: "verified_first_party_email" },
    evidence: { email: { value: "hello@example.test", purpose: "general", sourceUrl: "https://example.test/contact/" } },
  });
  const seen: string[] = [];
  const deps = mockDependencies(row, {
    usage: { config: { maxSerpCallsPerHour: 0 }, usage: { monthlyQuota: 0, usedCredits: 0, hardStopAt: 0 } },
    fetchPage: async url => {
      seen.push(url);
      return { url, html: "<p>Curly Tails, 5651 Tourist Dr, North Richland Hills, TX 76117.</p><p>Owner: Jane Smith.</p>" };
    },
  });
  try {
    const estimate = await estimateSalonOwnerNameSearch([row]);
    assert.equal(estimate.allowed, true);
    assert.equal(estimate.maxProviderCalls, 0);
    const result = await lookupSalonOwnerName(row.id, row.userId, false);
    assert.deepEqual(seen, ["https://example.test/contact/"]);
    assert.equal(result?.candidates[0]?.firstName, "Jane");
    assert.equal(result?.candidates[0]?.roleConfirmed, true);
    assert.equal(result?.candidates[0]?.sources[0]?.kind, "website_page");
    assert.equal(result?.providerCalls, 0);
    assert.equal(deps.observed.cacheReads, 1);
    assert.equal(deps.observed.providerAttempts, 0);
  } finally { deps.restore(); }
});

test("directory, changed email, social and purpose-restricted evidence never seed a salon-owned page", () => {
  const row = orchestrationRow({
    websiteUrl: null,
    email: "hello@example.test",
    sourceData: { category: "Pet Grooming", Outcome: "verified_first_party_email" },
    evidence: { email: { value: "hello@example.test", purpose: "general", sourceUrl: "https://example.test/contact/" } },
  });
  assert.equal(ownerLookupWebsiteUrl(row), "https://example.test/contact/");
  assert.equal(ownerLookupWebsiteUrl({ ...row, sourceData: { Outcome: "verified_independent_directory_email" } }), null);
  assert.equal(ownerLookupWebsiteUrl({ ...row, email: "changed@example.test" }), null);
  assert.equal(ownerLookupWebsiteUrl({ ...row, evidence: { email: { value: row.email, purpose: "vaccination_records", sourceUrl: "https://example.test/contact/" } } }), null);
  assert.equal(ownerLookupWebsiteUrl({ ...row, evidence: { email: { value: row.email, purpose: "general", sourceUrl: "https://www.facebook.com/example" } } }), null);
});

test("provider body timeout is bounded, clear and counted once without automatic retry", async () => {
  const row = orchestrationRow({ websiteUrl: null });
  const oldKey = process.env.SERPAPI_KEY;
  process.env.SERPAPI_KEY = "test-only-key";
  let signal: AbortSignal | undefined;
  const deps = mockDependencies(row, {
    providerTimeoutMs: 20,
    fetchProvider: async (_url, init) => {
      signal = init?.signal || undefined;
      const response = new Response("{}", { status: 200 });
      Object.defineProperty(response, "json", { value: () => new Promise(() => {}) });
      return response;
    },
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.equal(result?.status, "failed");
    assert.match(result?.error || "", /provider did not respond within the time limit/);
    assert.match(result?.error || "", /email review is unchanged/);
    assert.equal(signal?.aborted, true);
    assert.equal(result?.providerCalls, 1);
    assert.equal(deps.observed.providerAttempts, 1);
    assert.equal(deps.observed.reservations, 1);
    assert.equal(deps.observed.releases, 0);
  } finally {
    deps.restore();
    if (oldKey === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = oldKey;
  }
});

test("matched homepage identity can pass to a same-domain about page without conflicting location", async () => {
  const row = orchestrationRow();
  const deps = mockDependencies(row, {
    fetchPage: async url => url.endsWith("/about")
      ? { url, html: "<main><p>Founder Eliud Jimenez created the shop.</p></main>" }
      : {
        url,
        html: `<main><p>Curly Tails, 5651 Tourist Dr, North Richland Hills, TX 76117.</p><a href="/about">About</a></main>`,
      },
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.ok(result);
    const eliud = result.candidates.find(candidate => candidate.firstName === "Eliud");
    assert.ok(eliud);
    assert.equal(eliud.lastName, "Jimenez");
    assert.equal(eliud.roleConfirmed, true);
    assert.equal(result.pagesFetched, 2);
    assert.equal(result.providerCalls, 0);
  } finally {
    deps.restore();
  }
});

test("cached search results are free, remain unconfirmed, and do not reserve or attempt provider calls", async () => {
  const row = orchestrationRow({ websiteUrl: null });
  const deps = mockDependencies(row, {
    cached: [{
      title: "Curly Tails team",
      link: "https://www.nextdoor.com/public/",
      snippet: "Curly Tails team mentions Jacqueline as a neighborhood favorite.",
    }],
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.equal(result?.providerCalls, 0);
    assert.equal(result?.candidates[0]?.firstName, "Jacqueline");
    assert.equal(result?.candidates[0]?.roleConfirmed, false);
    assert.equal(deps.observed.cacheReads, 1);
    assert.equal(deps.observed.reservations, 0);
    assert.equal(deps.observed.providerAttempts, 0);
  } finally {
    deps.restore();
  }
});

test("a social-provider homepage is never treated as a first-party owner page", async () => {
  const row = orchestrationRow({ websiteUrl: "https://www.facebook.com/curlytails" });
  const deps = mockDependencies(row);
  try {
    await lookupSalonOwnerName(row.id, row.userId, false);
    assert.equal(deps.observed.pageAttempts, 0);
    assert.equal(deps.observed.cacheReads, 1);
  } finally {
    deps.restore();
  }
});

test("pending and processing rows are not started for owner-name lookup", async () => {
  for (const status of ["pending", "processing"]) {
    const row = orchestrationRow({ status });
    const deps = mockDependencies(row);
    try {
      const result = await lookupSalonOwnerName(row.id, row.userId, true);
      assert.equal(result?.status, "excluded");
      assert.equal(deps.observed.begin, 0);
      assert.equal(deps.observed.pageAttempts, 0);
      assert.equal(deps.observed.cacheReads, 0);
      assert.equal(deps.observed.providerAttempts, 0);
    } finally {
      deps.restore();
    }
  }
});

test("explicit non-grooming categories are excluded before cache, usage, or network access", async () => {
  const row = orchestrationRow({ sourceData: { category: "Hair Salon" }, websiteUrl: "https://example.invalid" });
  const deps = mockDependencies(row);
  try {
    const estimate = await estimateSalonOwnerNameSearch([row]);
    assert.equal(estimate.allowed, false);
    assert.equal(estimate.maxProviderCalls, 0);
    assert.equal(deps.observed.cacheReads, 0);
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.equal(result?.status, "excluded");
    assert.equal(result?.providerCalls, 0);
    assert.equal(deps.observed.pageAttempts, 0);
    assert.equal(deps.observed.reservations, 0);
    assert.equal(deps.observed.providerAttempts, 0);
  } finally {
    deps.restore();
  }
});

test("quota-zero lookup attempts no paid request and provider timeout is counted conservatively", async () => {
  const row = orchestrationRow({ websiteUrl: null });
  const oldKey = process.env.SERPAPI_KEY;
  process.env.SERPAPI_KEY = "test-only-key";
  try {
    const zeroQuota = mockDependencies(row, {
      usage: { config: { maxSerpCallsPerHour: 0 }, usage: { monthlyQuota: 0, usedCredits: 0, hardStopAt: 0 } },
    });
    try {
      const estimate = await estimateSalonOwnerNameSearch([row]);
      assert.equal(estimate.maxProviderCalls, 0);
      assert.equal(estimate.allowed, false);
      const noCalls = await lookupSalonOwnerName(row.id, row.userId, false);
      assert.equal(noCalls?.providerCalls, 0);
      assert.equal(zeroQuota.observed.reservations, 0);
      assert.equal(zeroQuota.observed.providerAttempts, 0);
    } finally {
      zeroQuota.restore();
    }

    const timeoutDeps = mockDependencies(row, {
      fetchProvider: async () => { throw new Error("mock network timeout"); },
    });
    try {
      const failed = await lookupSalonOwnerName(row.id, row.userId, true);
      assert.equal(failed?.status, "failed");
      assert.equal(failed?.providerCalls, 1);
      assert.equal(failed?.approvedAt, null);
      assert.equal(failed?.selectedCandidateId, null);
      assert.equal(timeoutDeps.observed.reservations, 1);
      assert.equal(timeoutDeps.observed.providerAttempts, 1);
      assert.equal(timeoutDeps.observed.releases, 0);
      assert.equal(timeoutDeps.observed.persisted?.providerCalls, 1);
    } finally {
      timeoutDeps.restore();
    }
  } finally {
    if (oldKey === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = oldKey;
  }
});

test("provider calls remain counted when first persistence fails and retry succeeds", async () => {
  const row = orchestrationRow({ websiteUrl: null });
  const oldKey = process.env.SERPAPI_KEY;
  process.env.SERPAPI_KEY = "test-only-key";
  const deps = mockDependencies(row, {
    completeFailures: 1,
    fetchProvider: async () => new Response(JSON.stringify({ organic_results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.equal(result?.status, "failed");
    assert.equal(result?.providerCalls, 1);
    assert.match(result?.error || "", /Could not persist owner-name results/);
    assert.equal(deps.observed.providerAttempts, 1);
    assert.equal(deps.observed.reservations, 1);
    assert.equal(deps.observed.complete, 2);
    assert.equal(deps.observed.persisted?.providerCalls, 1);
  } finally {
    deps.restore();
    if (oldKey === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = oldKey;
  }
});

test("owner lookup eligibility covers report workflow categories and rejects non-grooming", () => {
  assert.equal(isSalonOwnerNameEligible(orchestrationRow()), true);
  for (const category of [
    "verified_public_email",
    "review_only",
    "no_verified_email",
    "booking_only",
    "inaccessible",
    "Pet Grooming",
  ]) {
    assert.equal(
      isSalonOwnerNameEligible(orchestrationRow({ sourceData: { category } })),
      true,
      category,
    );
  }
  assert.equal(isSalonOwnerNameEligible(orchestrationRow({ sourceData: { category: "non_grooming" } })), false);
  assert.equal(isSalonOwnerNameEligible(orchestrationRow({ sourceData: { category: "excluded_non_grooming" } })), false);
  assert.equal(isSalonOwnerNameEligible(orchestrationRow({ sourceData: { category: "Pet Store" } })), false);
  assert.equal(isSalonOwnerNameEligible(orchestrationRow({ sourceData: { category: "Grooming Supply Store" } })), false);
});

test("category-less fixed-list uploads can run the opted-in owner stage after strong enrichment", async () => {
  const uploadedSourceData = {
    "Business Name": identity.businessName,
    "Street Address": identity.address,
    "Google Place ID": "upload-place-id",
    includeOwnerNames: true,
  };
  const row = orchestrationRow({
    sourceData: uploadedSourceData,
    status: "enriched",
    identityMatchStatus: "strong",
  });
  const { observed, restore } = mockDependencies(row, {
    fetchPage: async url => ({
      url,
      html: `<main>Curly Tails at 5651 Tourist Dr, North Richland Hills, TX 76117.
        <p>Owner: Jane.</p></main>`,
    }),
  });
  try {
    assert.equal(isSalonOwnerNameEligible(row), true);
    const result = await lookupSalonOwnerName(row.id, row.userId);
    assert.equal(result?.candidates[0]?.firstName, "Jane");
    assert.equal(result?.providerCalls, 0);
    assert.equal(observed.begin, 1);
    assert.equal(observed.complete, 1);
    assert.equal(isSalonOwnerNameEligible({ ...row, identityMatchStatus: "weak" }), false);
    assert.equal(isSalonOwnerNameEligible({
      ...row, sourceData: { ...uploadedSourceData, category: "non_grooming" },
    }), false);
  } finally {
    restore();
  }
});

test("owner discovery starts with the plain business/address search while preserving the exact-address fallback cache", () => {
  const row = orchestrationRow();
  const queries = salonOwnerSearchQueries(row);
  assert.equal(queries.length, 3);
  assert.equal(queries[0].query, '"Curly Tails" 5651 Tourist Dr, North Richland Hills, TX, 76117');
  assert.doesNotMatch(queries[0].query, /owner|founder/i);
  assert.equal(queries[1].query, 'Who is the owner of "Curly Tails" in North Richland Hills, TX?');
  assert.equal(queries[2].query, '"Curly Tails" "5651 Tourist Dr, North Richland Hills, TX, 76117" owner salon');
  assert.equal(queries[2].cacheKey, "salon-owner-organic:curly tails:5651 tourist dr north richland hills tx 76117");
  assert.equal(new Set(queries.map(item => item.cacheKey)).size, 3);
  const sparse = salonOwnerSearchQueries(orchestrationRow({ address: null, address1: null, city: null, state: null, zipCode: null }));
  for (const item of sparse) assert.doesNotMatch(item.query, /undefined|null|""| in \?/);
  assert.equal(new Set(sparse.map(item => item.query)).size, sparse.length);
});

test("formatted upload addresses supply locality for discovery without changing identity fields", () => {
  const row = orchestrationRow({ address: "1511 Washington Blvd, Detroit, MI 48226", address1: null, city: null, zipCode: null, state: "MI" });
  assert.equal(ownerDiscoveryLocation(row), "Detroit, MI");
  assert.equal(salonOwnerSearchQueries(row)[0].query, '"Curly Tails" 1511 Washington Blvd, Detroit, MI 48226');
  assert.equal(row.city, null);
  assert.equal(row.zipCode, null);
  assert.equal(ownerDiscoveryLocation(orchestrationRow({ address: "5651 Tourist Dr", city: null, state: null })), "");
});

test("business-specific owner interviews outrank generic results without trusting unrelated people", () => {
  const results = [
    { title: "Curly Tails grooming appointments", link: "https://fixture.example/book" },
    { title: "Founder Jane Smith", link: "https://fixture.example/other-business" },
    { title: "Meet Jane Smith of Curly Tails", snippet: "I’m the founder of Curly Tails.", link: "https://fixture.example/interview/jane" },
  ];
  assert.equal(prioritizeOwnerResults(orchestrationRow(), results)[0], results[2]);
});

test("LC's owner discovery ignores unrelated salon names and reserves fetched evidence for Tonya", async () => {
  await withTestProvider(async () => {
    const row = orchestrationRow({
      businessName: "LC'S Detroit Pet Salon",
      address: "1511 Washington Blvd, Detroit, MI 48226", address1: null,
      city: null, state: "MI", zipCode: null, websiteUrl: "https://booking.example/",
    });
    const interview = "https://voyagemichigan.com/interview/story-lesson-highlights-with-tonya-smith-of-detroit-highlight";
    const statement = "My name is Tonya Smith, and I’m the founder of LC’S Detroit Pet Salon and LC’S Foundation.";
    const seen: string[] = [];
    const deps = mockDependencies(row, {
      fetchProvider: async () => providerResponse([
        { title: "LEXY'S PET PARLOR", snippet: "Rachel, the owner knows and loves dogs.", link: "https://fixture.example/lexys" },
        { title: "Meet the Vote 4 the Best Pet Grooming Winner", snippet: "Glenn Gosine, the owner of Peticured Pet Nail Specialists.", link: "https://fixture.example/peticured" },
        { title: "Luke Fassbender's 25-Year Journey", snippet: "Luke Fassbender’s journey from pet groomer to store owner.", link: "https://fixture.example/luke" },
        { title: "Story & Lesson Highlights with Tonya Smith of Detroit", snippet: statement, link: interview },
      ]),
      fetchPage: async url => {
        seen.push(url);
        if (url !== interview) throw new Error("Public page returned HTTP 404");
        return { url, html: `<article><p>${statement}</p><p>Detroit, Michigan</p></article>` };
      },
    });
    try {
      const result = await lookupSalonOwnerName(row.id, row.userId, 1, 1);
      assert.deepEqual(seen, ["https://booking.example/", interview]);
      assert.deepEqual(result?.candidates.map(item => [item.firstName, item.lastName]), [["Tonya", "Smith"]]);
      assert.equal(result?.candidates[0].sources.some(item => item.kind === "organic_page" && item.url === interview), true);
      // Business discovery is not proof of the exact street location or approval.
      assert.equal(result?.candidates[0].businessMatched, false);
      assert.equal(result?.candidates[0].roleConfirmed, false);
      assert.equal(result?.approvedAt, null);
      assert.equal(result?.usePersonalName, false);
      assert.equal(result?.providerCalls, 1);
      assert.equal(deps.observed.pageAttempts, 2);
      assert.doesNotMatch(result?.error || "", /page limit/);
    } finally { deps.restore(); }
  });
});

test("discovery matches apostrophe variants and hides only unrelated stored summary suggestions", () => {
  const business = "LC'S Detroit Pet Salon";
  for (const mention of ["LC’S Detroit Pet Salon", "LCS Detroit Pet Salon", "LC'S Detroit Pet Salon"]) {
    assert.equal(mentionsOwnerBusiness(business, `Tonya Smith founded ${mention}.`), true);
  }
  assert.equal(mentionsOwnerBusiness("Curly Tails", "Curly Tailsworth"), false);
  assert.equal(mentionsOwnerBusiness("", "Owner Jane Smith"), false);
  const [unrelated] = extractSalonOwnerSummaryCandidates("Owner: Glenn Gosine of Peticured.", {
    url: "https://fixture.example/other", excerpt: "", kind: "organic_summary",
  });
  assert.ok(unrelated);
  assert.equal(relevantOwnerCandidate(unrelated, business), false);
  const [related] = extractSalonOwnerSummaryCandidates(`Owner: Tonya Smith of ${business}.`, {
    url: "https://fixture.example/lcs", excerpt: "", kind: "organic_summary",
  });
  assert.equal(relevantOwnerCandidate(related, business), true);
  assert.equal(related.roleConfirmed, false);
  assert.equal(relevantOwnerCandidate({ ...unrelated, sources: [{ ...source, kind: "website_about" }] }, identity.businessName), true);
});

test("first-person interview ownership requires fetched matched evidence, never a summary or historical claim", () => {
  const statement = "My name is Jane Smith, and I’m the founder of Curly Tails.";
  const [candidate] = extractSalonOwnerCandidates(statement, source, true, false, identity.businessName);
  assert.equal(candidate?.firstName, "Jane");
  assert.equal(candidate?.lastName, "Smith");
  assert.equal(candidate?.roleConfirmed, true);
  assert.equal(extractSalonOwnerSummaryCandidates(statement, { ...source, kind: "organic_summary" })[0]?.roleConfirmed, false);
  for (const text of [statement.replace("I’m the founder", "I was the founder"), `Reviewer says: ${statement}`]) {
    assert.equal(extractSalonOwnerCandidates(text, source, true, false, identity.businessName).some(item => item.roleConfirmed), false);
  }
  for (const otherBusiness of ["Another Salon", "Curly Tails Academy"]) {
    const text = statement.replace("of Curly Tails", `of ${otherBusiness}`);
    assert.equal(extractSalonOwnerCandidates(text, source, true, false, identity.businessName).some(item => item.roleConfirmed), false);
  }
});

test("explicit owner/operator variants confirm either direction without promoting operator-only or historical claims", () => {
  for (const role of ["owner/operator", "owner-operator", "owner and operator", "Owner / Operator"]) {
    for (const text of [`${role}: Jane Smith.`, `Jane Smith is the ${role}.`, `Jane Smith — ${role}.`]) {
      const jane = extractSalonOwnerCandidates(text, source, true).find(item => item.firstName === "Jane");
      assert.equal(jane?.roleConfirmed, true, text);
      assert.equal(jane?.lastName, "Smith", text);
    }
    for (const text of [`Former ${role}: Jane Smith.`, `Reviewer says ${role}: Jane Smith.`, `Jane Smith was the ${role}.`]) {
      assert.equal(extractSalonOwnerCandidates(text, source, true).some(item => item.roleConfirmed), false, text);
    }
  }
  assert.equal(extractSalonOwnerCandidates("Operator: Jane Smith.", source, true).some(item => item.roleConfirmed), false);
  assert.equal(extractSalonOwnerCandidates("Owned and operated by Jane Smith.", source, true)[0]?.roleConfirmed, true);
});

const providerResponse = (organic_results: Array<{ title?: string; link?: string; snippet?: string }> = []) =>
  new Response(JSON.stringify({ organic_results }), { status: 200, headers: { "Content-Type": "application/json" } });
const matchedPage = (url: string, evidence = "Owner/operator: Jane Smith.") => ({
  url, html: `<main><p>Curly Tails, 5651 Tourist Dr, North Richland Hills, TX 76117. ${evidence}</p></main>`,
});

test("broken website subpages leave room for a relevant owner interview before generic search results", async () => {
  await withTestProvider(async () => {
    const row = orchestrationRow();
    const visited: string[] = [];
    const interview = "https://fixture.example/interview/curly-tails";
    const deps = mockDependencies(row, {
      fetchProvider: async () => providerResponse([
        { title: "Curly Tails grooming appointments", link: "https://fixture.example/generic" },
        { title: "Curly Tails business listing", link: "https://fixture.example/listing" },
        { title: "Meet Jane Smith of Curly Tails", link: interview, snippet: "My name is Jane Smith, and I’m the founder of Curly Tails." },
      ]),
      fetchPage: async url => {
        visited.push(url);
        if (url === row.websiteUrl) return { url, html: "<main>Curly Tails, 5651 Tourist Dr, North Richland Hills TX 76117.<a href='/about'>About</a><a href='/team'>Team</a></main>" };
        if (url === interview) return matchedPage(url, "My name is Jane Smith, and I’m the founder of Curly Tails.");
        throw new Error("Public page returned HTTP 404");
      },
    });
    try {
      const result = await lookupSalonOwnerName(row.id, row.userId, 3, 3);
      const candidate = result?.candidates.find(item => item.firstName === "Jane");
      assert.equal(candidate?.lastName, "Smith");
      assert.equal(candidate?.roleConfirmed, true);
      assert.equal(candidate?.businessMatched, true);
      assert.equal(candidate?.sources.some(item => item.kind === "organic_page"), true);
      assert.equal(visited.length, 3);
      assert.equal(visited.at(-1), interview);
      assert.equal(result?.providerCalls, 1);
      assert.equal(result?.status, "needs_review");
      assert.equal(result?.approvedAt, null);
      assert.equal(result?.usePersonalName, false);
    } finally { deps.restore(); }
  });
});

test("a fetched first-person interview without the street address surfaces a candidate but cannot approve a name", async () => {
  const row = orchestrationRow({ websiteUrl: null });
  const interview = "https://fixture.example/interview/curly-tails";
  const deps = mockDependencies(row, {
    cached: [{ title: "Interview with Curly Tails founder", link: interview }],
    fetchPage: async url => ({ url, html: "<main><p>My name is Jane Smith, and I’m the founder of Curly Tails in North Richland Hills.</p></main>" }),
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, 0, 1);
    const candidate = result?.candidates.find(item => item.firstName === "Jane");
    assert.equal(candidate?.lastName, "Smith");
    assert.equal(candidate?.roleConfirmed, false);
    assert.equal(candidate?.businessMatched, false);
    assert.equal(candidate?.sources.some(item => item.kind === "organic_page"), true);
    assert.equal(result?.status, "needs_review");
    assert.equal(result?.providerCalls, 0);
    assert.equal(isStrongApprovedOwnerCandidate({ ...result!, approvedAt: new Date().toISOString(), selectedCandidateId: candidate!.id }), null);
  } finally { deps.restore(); }
});
async function withTestProvider(fn: () => Promise<void>) {
  const oldKey = process.env.SERPAPI_KEY;
  process.env.SERPAPI_KEY = "test-only-key";
  try { await fn(); } finally {
    if (oldKey === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = oldKey;
  }
}

function puppyCutzOverview(tokenOnly = false) {
  return {
    organic_results: [],
    ai_overview: tokenOnly ? { page_token: "fixture-token-never-fetch" } : {
      text_blocks: [
        { type: "paragraph", snippet: "Puppy Cutz is a pet groomer at 6665 Pelouze St, Detroit, MI 48210." },
        { type: "heading", snippet: "Business Details" },
        { type: "list", list: [{ title: "Groomer / Owner", snippet: "Eric", reference_indexes: [0] }] },
      ],
      references: [{ index: 0, title: "Puppy Cutz", link: "https://fixture.example/puppy-cutz", snippet: "Located in Southwest Detroit. Over 10 years experience." }],
    },
  };
}

test("Puppy Cutz inline AI Overview surfaces Eric and its citation with one request, caches it, and cannot approve it", async () => {
  await withTestProvider(async () => {
    const row = orchestrationRow({
      businessName: "Puppy Cutz", address: "6665 Pelouze St", address1: "6665 Pelouze St",
      city: "Detroit", state: "MI", zipCode: "48210", websiteUrl: null, identityMatchStatus: "unmatched",
    });
    const cacheByKey: Record<string, unknown> = {};
    const visited: string[] = [];
    const deps = mockDependencies(row, {
      cacheByKey,
      fetchProvider: async url => {
        const params = new URL(String(url)).searchParams;
        assert.equal(params.get("q"), '"Puppy Cutz" 6665 Pelouze St, Detroit, MI, 48210');
        assert.equal(params.get("hl"), "en");
        assert.equal(params.get("gl"), "us");
        return { ok: true, json: async () => puppyCutzOverview() } as Response;
      },
      fetchPage: async url => { visited.push(url); throw new Error("Public page returned HTTP 403"); },
    });
    try {
      const result = await lookupSalonOwnerName(row.id, row.userId, 1, 1);
      assert.equal(result?.providerCalls, 1);
      assert.equal(result?.status, "needs_review");
      const eric = result?.candidates.find(candidate => candidate.firstName === "Eric");
      assert.ok(eric);
      assert.equal(eric.lastName, null);
      assert.equal(eric.roleConfirmed, false);
      assert.equal(eric.businessMatched, false);
      assert.equal(eric.sources.some(source => source.kind === "google_ai_overview"), true);
      assert.equal(eric.sources.some(source => source.kind === "google_ai_citation"), true);
      assert.equal(relevantOwnerCandidate(eric, row.businessName), true);
      assert.equal(isStrongApprovedOwnerCandidate({ ...result!, selectedCandidateId: eric.id, approvedAt: "2026-10-04" }), null);
      assert.deepEqual(visited, ["https://fixture.example/puppy-cutz"]);
      assert.equal(result?.approvedAt, null);
      assert.equal(result?.usePersonalName, false);
      const cached = await lookupSalonOwnerName(row.id, row.userId, 0, 1);
      assert.equal(cached?.providerCalls, 0);
      assert.equal(cached?.candidates[0].firstName, "Eric");
      assert.equal(deps.observed.providerAttempts, 1);
    } finally { deps.restore(); }
  });
});

test("AI Overview retrieval tokens explain missing text without a hidden extra provider request, including cache reuse", async () => {
  await withTestProvider(async () => {
    const row = orchestrationRow({ websiteUrl: null });
    const deps = mockDependencies(row, {
      cacheByKey: {},
      fetchProvider: async () => ({ ok: true, json: async () => puppyCutzOverview(true) }) as Response,
    });
    try {
      const result = await lookupSalonOwnerName(row.id, row.userId, 1, 1);
      assert.equal(result?.providerCalls, 1);
      assert.match(result?.notices?.join("; ") || "", /not its text.*did not make that extra paid request/);
      assert.equal(result?.error,undefined);
      assert.equal(result?.status,"not_found");
      assert.equal(result?.candidates.length, 0);
      const cached = await lookupSalonOwnerName(row.id, row.userId, 0, 1);
      assert.equal(cached?.providerCalls, 0);
      assert.equal(cached?.error, result?.error);
      assert.deepEqual(cached?.notices,result?.notices);
      assert.equal(deps.observed.providerAttempts, 1);
      assert.equal(deps.observed.pageAttempts, 0);
    } finally { deps.restore(); }
  });
});

test("a public salon-specific Google Sites page is checked for owners before spending on organic search",async()=>{
  const row=orchestrationRow({websiteUrl:"https://sites.google.com/view/curly-tails/home"});
  const deps=mockDependencies(row,{fetchPage:async url=>matchedPage(url,"Owner: Jane Smith")});
  try{
    const result=await lookupSalonOwnerName(row.id,row.userId,0,1);
    assert.ok(result?.pagesFetched);
    assert.ok(result?.candidates.some(candidate=>candidate.firstName==="Jane"&&candidate.roleConfirmed&&candidate.businessMatched));
    assert.equal(result?.providerCalls,0);
    assert.equal(deps.observed.providerAttempts,0);
    assert.equal(result?.approvedAt,null);
    assert.equal(result?.usePersonalName,false);
  }finally{deps.restore();}
});

test("a fetched exact-location AI citation can confirm a first-name owner, but never auto-approve or personalize", async () => {
  await withTestProvider(async () => {
    const row = orchestrationRow({ websiteUrl: null });
    const deps = mockDependencies(row, {
      fetchProvider: async () => ({
        ok: true,
        json: async () => ({
          ai_overview: {
            text_blocks: [{ type: "paragraph", snippet: "Curly Tails. Owner: Jane", reference_indexes: [0] }],
            references: [{ index: 0, title: "Curly Tails", link: "https://fixture.example/about" }],
          },
        }),
      }) as Response,
      fetchPage: async url => matchedPage(url, "Owner: Jane"),
    });
    try {
      const result = await lookupSalonOwnerName(row.id, row.userId, 1, 1);
      assert.equal(result?.candidates[0].firstName, "Jane");
      assert.equal(result?.candidates[0].lastName, null);
      assert.equal(result?.candidates[0].roleConfirmed, true);
      assert.equal(result?.candidates[0].businessMatched, true);
      assert.equal(result?.providerCalls, 1);
      assert.equal(result?.pagesFetched, 1);
      assert.equal(result?.approvedAt, null);
      assert.equal(result?.usePersonalName, false);
    } finally { deps.restore(); }
  });
});

test("expanded lookup verifies a broader or natural-language result before another paid search", async () => {
  await withTestProvider(async () => {
    for (const winningPhrase of [1, 2]) {
      const row = orchestrationRow({ websiteUrl: null });
      const queries = salonOwnerSearchQueries(row);
      let inspected = false;
      const deps = mockDependencies(row, {
        fetchProvider: async url => {
          assert.equal(inspected, false, "never spend after verified fetched evidence");
          const index = queries.findIndex(item => item.query === new URL(String(url)).searchParams.get("q"));
          return providerResponse(index === winningPhrase ? [{ link: "https://fixture.example/about", snippet: "Curly Tails. Owner Jane Smith." }] : []);
        },
        fetchPage: async url => { inspected = true; return matchedPage(url); },
      });
      try {
        const result = await lookupSalonOwnerName(row.id, row.userId, 3, 3);
        assert.equal(result?.providerCalls, winningPhrase + 1);
        assert.deepEqual(deps.observed.queries, queries.slice(0, winningPhrase + 1).map(item => item.query));
        assert.equal(result?.candidates.find(item => item.firstName === "Jane")?.roleConfirmed, true);
        assert.equal(result?.approvedAt, null);
        assert.equal(result?.selectedCandidateId, null);
        assert.equal(result?.usePersonalName, false);
        assert.equal(deps.observed.pageAttempts, 1);
        assert.equal(result?.candidates[0].sources.some(item => item.kind === "organic_summary"), true);
        assert.equal(result?.candidates[0].sources.some(item => item.kind === "organic_page"), true);
      } finally { deps.restore(); }
    }
  });
});

test("single-search defaults, zero and partial numeric budgets never silently expand paid usage", async () => {
  await withTestProvider(async () => {
    const row = orchestrationRow({ websiteUrl: null });
    for (const budget of [undefined, 0, 1, 2]) {
      const deps = mockDependencies(row, { fetchProvider: async () => providerResponse() });
      try {
        const result = budget === undefined
          ? await lookupSalonOwnerName(row.id, row.userId)
          : await lookupSalonOwnerName(row.id, row.userId, budget, 3);
        assert.equal(result?.providerCalls, budget ?? 1);
        assert.equal(deps.observed.providerAttempts, budget ?? 1);
        if (budget !== undefined) assert.match(result?.error || "", /incomplete.*allowance/);
      } finally { deps.restore(); }
    }
  });
});

test("phrase caches are distinct, cached empty results are free, and repeated pages/candidates are merged", async () => {
  const row = orchestrationRow({ websiteUrl: null });
  const queries = salonOwnerSearchQueries(row);
  const cacheByKey = {
    [queries[0].cacheKey]: [],
    [queries[1].cacheKey]: [{ link: "https://fixture.example/staff", snippet: "Curly Tails. Owner Jane Smith." }],
    [queries[2].cacheKey]: [{ link: "https://fixture.example/staff#team", snippet: "Curly Tails. Owner Jane Smith." }],
  };
  const deps = mockDependencies(row, { cacheByKey, fetchPage: async url => matchedPage(url, "Manager: Jane Smith.") });
  try {
    const estimate = await estimateSalonOwnerNameSearch([row], 3);
    assert.equal(estimate.maxProviderCalls, 0);
    assert.equal(estimate.allowed, true);
    const result = await lookupSalonOwnerName(row.id, row.userId, 0, 3);
    assert.equal(result?.providerCalls, 0);
    assert.equal(result?.candidates.length, 1);
    assert.equal(result?.candidates[0].roleConfirmed, false);
    assert.equal(deps.observed.pageAttempts, 1);
    assert.equal(deps.observed.reservations, 0);
    assert.deepEqual(deps.observed.cacheKeys.slice(-3), queries.map(item => item.cacheKey));
  } finally { deps.restore(); }
});

test("new phrase caches preserve empty responses and let future confirmed lookups run without paid requests", async () => {
  await withTestProvider(async () => {
    const row = orchestrationRow({ websiteUrl: null });
    const cacheByKey = {};
    const deps = mockDependencies(row, { cacheByKey, fetchProvider: async () => providerResponse() });
    try {
      assert.equal((await lookupSalonOwnerName(row.id, row.userId, 3, 3))?.providerCalls, 3);
      assert.deepEqual(deps.observed.writtenKeys, salonOwnerSearchQueries(row).map(item => item.cacheKey));
      assert.equal((await estimateSalonOwnerNameSearch([row], 3)).maxProviderCalls, 0);
      assert.equal((await lookupSalonOwnerName(row.id, row.userId, 0, 3))?.providerCalls, 0);
      assert.equal(deps.observed.providerAttempts, 3);
    } finally { deps.restore(); }
  });
});

test("zero remaining paid allowance can still reuse a later cached phrase without attempting missing phrases", async () => {
  const row = orchestrationRow({ websiteUrl: null });
  const queries = salonOwnerSearchQueries(row);
  const deps = mockDependencies(row, {
    cacheByKey: { [queries[2].cacheKey]: [{ title: "Curly Tails", link: "https://fixture.example/about" }] },
    fetchPage: async url => matchedPage(url),
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, 0, 3);
    assert.equal(result?.candidates[0]?.roleConfirmed, true);
    assert.equal(result?.providerCalls, 0);
    assert.equal(deps.observed.providerAttempts, 0);
    assert.equal(deps.observed.reservations, 0);
  } finally { deps.restore(); }
});

test("concurrent review state never inflates actual paid usage with historical request counts", async () => {
  await withTestProvider(async () => {
    const row = orchestrationRow({
      websiteUrl: null, evidence: { ownerName: { ...EMPTY_OWNER_NAME_RESULT, providerCalls: 3 } },
    });
    const deps = mockDependencies(row, { complete: false, fetchProvider: async () => providerResponse() });
    try {
      const result = await lookupSalonOwnerNameBatch([row], row.userId, 1);
      assert.equal(result.callsUsed, 1);
      assert.equal(deps.observed.providerAttempts, 1);
    } finally { deps.restore(); }
  });
});

test("later cache, usage and reservation failures preserve earlier candidates and never refund batch spending", async () => {
  await withTestProvider(async () => {
    for (const stage of ["cache", "usage", "reservation"] as const) {
      const rows = [orchestrationRow({ id: "fault-row", websiteUrl: null }),
        orchestrationRow({ id: "next-row", businessName: "Next Salon", websiteUrl: null })];
      const deps = mockDependencies(rows[0], {
        rows, fault: { stage, at: 2 },
        fetchProvider: async () => providerResponse([{ link: "https://www.nextdoor.com/public/", snippet: "Curly Tails. Owner Jane Smith." }]),
      });
      try {
        const batch = await lookupSalonOwnerNameBatch(rows, rows[0].userId, 2, 3);
        assert.equal(deps.observed.providerAttempts, 2, stage);
        assert.equal(batch.callsUsed, deps.observed.providerAttempts, stage);
        assert.deepEqual(batch.results.map(item => item.ownerName.providerCalls), [1, 1], stage);
        const first = batch.results[0].ownerName;
        assert.equal(first.status, "needs_review", stage);
        assert.equal(first.candidates[0]?.firstName, "Jane", stage);
        assert.equal(first.candidates[0]?.roleConfirmed, false, stage);
        assert.equal(first.approvedAt, null, stage);
        assert.match(first.error || "", /incomplete.*mock.*failure/, stage);
      } finally { deps.restore(); }
    }
  });
});

test("concurrent row deletion, post-save read errors and persistence failures cannot refund initiated calls", async () => {
  await withTestProvider(async () => {
    for (const failure of ["deletion", "rowRead", "persistence"] as const) {
      const rows = [orchestrationRow({ id: "fault-row", websiteUrl: null }),
        orchestrationRow({ id: "next-row", businessName: "Next Salon", websiteUrl: null })];
      const deps = mockDependencies(rows[0], {
        rows, complete: failure === "persistence", completeFailures: failure === "persistence" ? 2 : 0,
        deleteFirstRowOnCompletion: failure === "deletion",
        fault: failure === "rowRead" ? { stage: "rowRead", at: 2 } : undefined,
        fetchProvider: async () => providerResponse(),
      });
      try {
        const batch = await lookupSalonOwnerNameBatch(rows, rows[0].userId, 2);
        assert.equal(deps.observed.providerAttempts, 2, failure);
        assert.equal(batch.callsUsed, 2, failure);
        assert.equal(batch.results[0].ownerName.providerCalls, 1, failure);
        assert.equal(batch.results[0].ownerName.status, "failed", failure);
        assert.ok(batch.results[0].ownerName.error, failure);
      } finally { deps.restore(); }
    }
  });
});

test("wrong-location fallback pages do not confirm ownership and failed fetch attempts consume the shared page cap", async () => {
  await withTestProvider(async () => {
    const row = orchestrationRow({ websiteUrl: null });
    const deps = mockDependencies(row, {
      fetchProvider: async () => providerResponse(Array.from({ length: 6 }, (_, index) => ({
        link: `https://fixture.example/page-${index}`, snippet: "Curly Tails. Owner Jane Smith.",
      }))),
      fetchPage: async url => url.endsWith("0")
        ? { url, html: "<main>Curly Tails, 999 Wrong St, Dallas, TX 75001. Owner/operator: Jane Smith.</main>" }
        : Promise.reject(new Error("Mock page failure")),
    });
    try {
      const result = await lookupSalonOwnerName(row.id, row.userId, 3, 3);
      assert.equal(result?.providerCalls, 1);
      assert.equal(deps.observed.pageAttempts, 4);
      assert.equal(result?.candidates.some(item => item.roleConfirmed), false);
      assert.match(result?.error || "", /incomplete.*page/);
    } finally { deps.restore(); }
  });
});

test("later quota exhaustion or provider timeout preserves prior review candidates and never retries", async () => {
  await withTestProvider(async () => {
    const row = orchestrationRow({ websiteUrl: null });
    for (const quotaFailure of [false, true]) {
      const deps = mockDependencies(row, {
        reserveLimit: quotaFailure ? 1 : undefined,
        providerTimeoutMs: 15,
        fetchProvider: async () => deps.observed.providerAttempts === 1
          ? providerResponse([{ link: "https://www.nextdoor.com/public/", snippet: "Curly Tails. Owner Jane Smith." }])
          : new Promise(() => {}),
      });
      try {
        const result = await lookupSalonOwnerName(row.id, row.userId, 3, 3);
        assert.equal(result?.status, "needs_review");
        assert.equal(result?.candidates[0].firstName, "Jane");
        assert.equal(result?.candidates[0].roleConfirmed, false);
        assert.equal(result?.providerCalls, quotaFailure ? 1 : 2);
        assert.equal(deps.observed.providerAttempts, quotaFailure ? 1 : 2);
        assert.match(result?.error || "", quotaFailure ? /incomplete.*quota/ : /incomplete.*time limit/);
      } finally { deps.restore(); }
    }
  });
});

test("batch allowance is shared across rows and expanded estimates honor hourly and monthly caps", async () => {
  await withTestProvider(async () => {
    const rows = Array.from({ length: 5 }, (_, index) => orchestrationRow({
      id: `row-${index}`, businessName: `Salon ${index}`, websiteUrl: null,
    }));
    const deps = mockDependencies(rows[0], {
      rows, fetchProvider: async () => providerResponse(),
      usage: { config: { maxSerpCallsPerHour: 12 }, usage: { monthlyQuota: 20, usedCredits: 3, hardStopAt: 10 } },
    });
    try {
      assert.equal((await estimateSalonOwnerNameSearch(rows)).maxProviderCalls, 5);
      const expanded = await estimateSalonOwnerNameSearch(rows, 3);
      assert.equal(expanded.maxProviderCalls, 7);
      assert.equal(expanded.maxPages, 20);
      assert.equal(expanded.searchesPerRow, 3);
      const batch = await lookupSalonOwnerNameBatch(rows, rows[0].userId, 4, 3);
      assert.equal(batch.callsUsed, 4);
      assert.deepEqual(batch.results.map(item => item.ownerName.providerCalls), [3, 1, 0, 0, 0]);
      assert.equal(deps.observed.providerAttempts, 4);
    } finally { deps.restore(); }
  });
});

test("search input requires explicit expansion, confirmation, unique owned-row identifiers and bounded budgets", () => {
  assert.equal(ownerNameRowsInput.parse({ rowIds: ["a"] }).searchesPerRow, 1);
  assert.equal(ownerNameSearchInput.parse({ rowIds: ["a"], maxProviderCalls: 1, confirmed: true }).searchesPerRow, 1);
  assert.equal(ownerNameSearchInput.safeParse({ rowIds: ["a"], maxProviderCalls: 3, confirmed: true }).success, false);
  assert.equal(ownerNameSearchInput.safeParse({ rowIds: ["a"], searchesPerRow: 3, maxProviderCalls: 3, confirmed: true }).success, true);
  for (const input of [
    { rowIds: ["a"], searchesPerRow: 2, maxProviderCalls: 2, confirmed: true },
    { rowIds: ["a"], searchesPerRow: 3, maxProviderCalls: 4, confirmed: true },
    { rowIds: ["a"], maxProviderCalls: -1, confirmed: true },
    { rowIds: ["a"], maxProviderCalls: 1.5, confirmed: true },
    { rowIds: ["a"], maxProviderCalls: 1, confirmed: false },
    { rowIds: ["a", "a"], maxProviderCalls: 1, confirmed: true },
    { rowIds: [], maxProviderCalls: 0, confirmed: true },
    { rowIds: ["a", "b", "c", "d", "e", "f"], maxProviderCalls: 6, confirmed: true },
  ]) assert.equal(ownerNameSearchInput.safeParse(input).success, false);
});