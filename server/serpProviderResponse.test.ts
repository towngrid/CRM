import assert from "node:assert/strict";
import test from "node:test";
import { readSerpProviderResponse, retryAfterMilliseconds } from "./serpProviderResponse";
import { newFullResearch, providerRateLimitWait } from "./fullResearchPolicy";
import { FULL_RESEARCH_DEFAULTS } from "@shared/fullResearch";

test("Retry-After supports seconds and HTTP dates, rejecting invalid/past values", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  assert.equal(retryAfterMilliseconds("120", now), 120000);
  assert.equal(retryAfterMilliseconds("Mon, 05 Oct 2026 12:10:00 GMT", now), 600000);
  for (const value of [null, "", "invalid", "-1", "Mon, 05 Oct 2026 11:00:00 GMT"]) {
    assert.equal(retryAfterMilliseconds(value, now), undefined);
  }
});

test("response handling separates transient throttles from exhausted credits and auth errors", async () => {
  for (const [status, error, temporary] of [
    [429, "Too many requests", true],
    [200, "Rate limit reached", true],
    [429, "Your account has run out of searches.", false],
    [429, "Your account has reached its searches limit", false],
    [200, "You have 0 searches left", false],
    [401, "Invalid API key", false],
    [403, "Rate limit", false],
  ] as const) {
    const blocks: any[] = [];
    const policy = { hourlyLimit: 40, onReservationBlocked: async () => {},
      onProviderBlocked: async (block: any) => { blocks.push(block); } };
    await assert.rejects(readSerpProviderResponse(new Response(JSON.stringify({ error }), {
      status, headers: { "Retry-After": "900" },
    }), policy));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].temporary, temporary, `${status}: ${error}`);
    assert.equal(blocks[0].retryAfterMs, temporary ? 900000 : undefined);
  }
});

test("non-JSON 429 schedules a cooldown; success does not invoke blocking hooks", async () => {
  const blocks: any[] = [];
  const policy = { hourlyLimit: 40, onReservationBlocked: async () => {},
    onProviderBlocked: async (block: any) => { blocks.push(block); } };
  await assert.rejects(readSerpProviderResponse(new Response("rate limited", { status: 429 }), policy));
  assert.equal(blocks[0].temporary, true);
  assert.deepEqual(await readSerpProviderResponse(new Response(JSON.stringify({ results: [] })), policy), { results: [] });
  assert.equal(blocks.length, 1);
});

test("backoff increases, respects Retry-After and rolling hourly allowances, and never raises caps", () => {
  const now = Date.now();
  const run = newFullResearch(FULL_RESEARCH_DEFAULTS, now);
  for (const minutes of [5, 10, 20, 40, 60]) {
    assert.equal(Date.parse(providerRateLimitWait(run, now).nextRunAt!) - now, minutes * 60000);
  }
  assert.equal(providerRateLimitWait(run, now).status, "paused");
  run.providerRateLimitCount = 0;
  assert.equal(Date.parse(providerRateLimitWait(run, now, 90 * 60000).nextRunAt!) - now, 90 * 60000);
  run.attempts = Array.from({ length: run.limits.paidCallsPerHour }, () => ({ at: new Date(now).toISOString(), rowId: "row", tool: "fixture" }));
  assert.equal(Date.parse(providerRateLimitWait(run, now).nextRunAt!) - now, 3600000);
  run.attempts = [];
  run.startedRows = Array.from({ length: 20 }, () => ({ at: new Date(now).toISOString(), id: "row" }));
  assert.equal(Date.parse(providerRateLimitWait(run, now).nextRunAt!) - now, 3600000);
  assert.deepEqual(run.limits, FULL_RESEARCH_DEFAULTS);
  run.enabled = false;
  assert.equal(providerRateLimitWait(run, now).status, "paused");
});
