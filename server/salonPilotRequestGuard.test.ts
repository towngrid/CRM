import test from "node:test";
import assert from "node:assert/strict";
import { storage } from "./storage";
import { pool } from "./db";
import { searchWithSerpApi } from "./lead-discovery";

test("last-moment closure prevents the HTTP request and releases only its unused reservation", async () => {
  const originals = {
    getSerpCache: storage.getSerpCache,
    getOrCreateSerpUsage: storage.getOrCreateSerpUsage,
    getOrCreateLeadDiscoveryConfig: storage.getOrCreateLeadDiscoveryConfig,
    reserveSerpCall: storage.reserveSerpCall,
    releaseSerpCall: storage.releaseSerpCall,
  };
  const originalFetch = globalThis.fetch;
  // A placeholder so the key-presence check passes; fetch is stubbed, so it is never sent anywhere.
  const oldKey = process.env.SERPAPI_KEY;
  process.env.SERPAPI_KEY = "test-only-key";
  let requests = 0, reservations = 0, releases = 0;
  const hourlyLimits: number[] = [];
  storage.getSerpCache = async () => undefined;
  storage.getOrCreateSerpUsage = async () => ({ usedCredits: 0, hardStopAt: 200 }) as any;
  storage.getOrCreateLeadDiscoveryConfig = async () => ({ maxSerpCallsPerHour: 20 }) as any;
  storage.reserveSerpCall = async (_month, hourlyLimit) => { reservations++; hourlyLimits.push(hourlyLimit); return "isolated-reservation"; };
  storage.releaseSerpCall = async () => { releases++; };
  globalThis.fetch = async () => { requests++; throw new Error("simulated uncertain network failure"); };
  try {
    // Existing key is checked for presence only and never accessed or displayed.
    await assert.rejects(searchWithSerpApi("Fixture", "00000", "CA", "fixture", {
      placeId: "fixed", beforeProviderRequest: () => { throw new Error("pilot closed"); },
    }), /pilot closed/);
    assert.equal(requests, 0);
    assert.equal(reservations, 1);
    assert.equal(releases, 1);
    await assert.rejects(searchWithSerpApi("Fixture", "00000", "CA", "fixture"),
      /simulated uncertain network failure/);
    assert.equal(requests, 1);
    assert.equal(reservations, 2);
    assert.equal(releases, 1, "initiated requests retain their allowance when billing is uncertain");
    for (const hourlyLimit of [40, 80]) {
      await assert.rejects(searchWithSerpApi("Fixture", "00000", "CA", "fixture", {
        requestPolicy: { hourlyLimit, onReservationBlocked: async () => {} },
      }), /simulated uncertain network failure/);
    }
    assert.deepEqual(hourlyLimits, [20, 20, 40, 80], "confirmed worker allowance reaches actual storage instead of falling back to legacy configuration");
    assert.equal(requests, 3);
    assert.equal(releases, 1, "neither old nor new allowance refunds a started provider attempt");
  } finally {
    if (oldKey === undefined) delete process.env.SERPAPI_KEY; else process.env.SERPAPI_KEY = oldKey;
    Object.assign(storage, originals);
    globalThis.fetch = originalFetch;
  }
});
test.after(() => pool.end());