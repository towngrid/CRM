import test from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { users, salonEnrichmentBatches, salonEnrichmentRows } from "@shared/schema";
import { convertSalonSearchReportEntry, canApproveSalonReportRow } from "./salonSearchReport";
import { preserveResearchDecision, registerSalonResearchRoutes, researchEntry } from "./salonResearch";
import {
  readResearchSnapshot, researchSignature, verifyResearchSignature,
  researchSnapshotSchema, RESEARCH_DATASET, SYNC_PATH,
} from "./salonResearchSnapshot";

test("research signatures are scoped, expire, and reject modified bodies", () => {
  const secret = "isolated-test-secret";
  const now = 1791069000000;
  const timestamp = String(now);
  const body = '{"dataset":"fixed"}';
  const signature = researchSignature(secret, timestamp, body);
  assert(verifyResearchSignature(secret, timestamp, signature, body, now));
  assert(!verifyResearchSignature(secret, timestamp, signature, `${body} `, now));
  assert(!verifyResearchSignature("other-secret", timestamp, signature, body, now));
  assert(!verifyResearchSignature(secret, timestamp, signature, body, now + 300001));
  assert(!verifyResearchSignature(undefined, timestamp, signature, body, now));
});

test("research synchronization preserves every explicit sales decision", () => {
  for (const row of [
    { reviewStatus: "approved", status: "enriched" },
    { reviewStatus: "rejected", status: "rejected" },
    { reviewStatus: "needs_review", status: "imported" },
    { reviewStatus: "needs_review", status: "enriched", importedContactId: "fixture-contact" },
  ]) assert(preserveResearchDecision(row));
  assert(!preserveResearchDecision({ reviewStatus: "needs_review", status: "enriched" }));
});

test("isolated API fixture stores the directory once and synchronizes without importing", async t => {
  if (process.env.RUN_SALON_RESEARCH_DB_FIXTURE !== "true") {
    t.skip("Opt-in database fixture; ordinary tests must not stage the full original directory or create records.");
    return;
  }
  // The real CRM authentication stays in place. Only this throwaway HTTP fixture
  // uses test middleware, and all test records are in the development database.
  assert.notEqual(process.env.NODE_ENV, "production");
  const [existing] = await db.select({ id: salonEnrichmentBatches.id })
    .from(salonEnrichmentBatches)
    .where(sql`${salonEnrichmentBatches.researchProgress}->>'datasetKey' = ${RESEARCH_DATASET}`);
  if (existing) {
    t.skip("A real research directory is already initialized; do not modify user data");
    return;
  }
  const userId = `research-fixture-${randomUUID()}`;
  const fixtureSecret = "isolated-api-fixture-not-a-real-secret";
  process.env.SESSION_SECRET = fixtureSecret;
  await db.insert(users).values({ id: userId, email: `${randomUUID()}@example.invalid`, role: "admin" });
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const authenticated: RequestHandler = (req: any, res, next) => {
    if (!req.headers["x-fixture-role"]) return res.status(401).json({ message: "Unauthorized" });
    req.user = {
      role: req.headers["x-fixture-role"],
      claims: { sub: req.headers["x-fixture-role"] === "admin" ? userId : "other-fixture-user" },
    };
    next();
  };
  const admin: RequestHandler = (req: any, res, next) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
    next();
  };
  registerSalonResearchRoutes(app, authenticated, admin);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const adminHeaders = { "x-fixture-role": "admin" };
  let batchId: string | undefined;
  try {
    assert.equal((await fetch(`${base}/api/salon-research/status`)).status, 401);
    assert.equal((await fetch(`${base}/api/salon-research/initialize`, {
      method: "POST", headers: { "x-fixture-role": "user" },
    })).status, 403);
    assert.equal((await fetch(`${base}${SYNC_PATH}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    })).status, 401);
    const initialized = await Promise.all([1, 2].map(() =>
      fetch(`${base}/api/salon-research/initialize`, { method: "POST", headers: adminHeaders })));
    for (const result of initialized) assert.equal(result.status, 200, await result.clone().text());
    const results = await Promise.all(initialized.map(result => result.json()));
    assert.equal(results[0].batchId, results[1].batchId);
    if (readResearchSnapshot()!.status === "stopped_by_user") {
      assert.equal(results[0].status, "stopped_by_user");
      assert.equal(results[0].nextAllowanceAt, null);
      assert.equal(results[0].stale, false);
      assert.match(results[0].message, /closed.*no further lookups/i);
    }
    batchId = results[0].batchId;
    const [batch] = await db.select().from(salonEnrichmentBatches)
      .where(and(eq(salonEnrichmentBatches.id, batchId!), eq(salonEnrichmentBatches.userId, userId)));
    assert(batch, "Fixture must never operate on another user's batch");
    const rows = await db.select().from(salonEnrichmentRows).where(eq(salonEnrichmentRows.batchId, batchId!));
    assert.equal(rows.length, 13847);
    assert.equal(new Set(rows.map(row => row.placeId)).size, 13847);
    assert(rows.every(row => !row.importedContactId));
    assert.equal(rows.filter(row => row.email).length, results[0].verifiedEmails);
    const initialBody = JSON.stringify((batch.researchProgress as any).snapshot);
    const initialTimestamp = String(Date.now());
    assert.equal((await fetch(`${base}${SYNC_PATH}`, {
      method: "POST", headers: { "Content-Type": "application/json",
        "x-research-timestamp": initialTimestamp,
        "x-research-signature": researchSignature(fixtureSecret, initialTimestamp, initialBody) },
      body: initialBody,
    })).status, 200);
    const [connected] = await db.select().from(salonEnrichmentBatches)
      .where(eq(salonEnrichmentBatches.id, batchId!));
    assert((connected.researchProgress as any).lastRemoteSyncAt);
    assert.equal((await fetch(`${base}/api/salon-research/status`, {
      headers: { "x-fixture-role": "user" },
    })).status, 403);

    const snapshot = readResearchSnapshot()!;
    const approved = rows.find(row => row.email)!;
    const rejected = rows.find(row => row.sourceData &&
      (row.sourceData as any).researchPaired && !row.email && row.reviewStatus !== "rejected")!;
    await db.update(salonEnrichmentRows).set({ reviewStatus: "approved" })
      .where(eq(salonEnrichmentRows.id, approved.id));
    await db.update(salonEnrichmentRows).set({ reviewStatus: "rejected" })
      .where(eq(salonEnrichmentRows.id, rejected.id));
    const updated = structuredClone(snapshot);
    updated.sourceUpdatedAt = new Date(Date.now() + 1000).toISOString();
    updated.rows.find(row => row.placeId === approved.placeId)!.notes = "New source note must not overwrite an approval";
    const body = JSON.stringify(updated);
    const timestamp = String(Date.now());
    const syncHeaders = {
      "Content-Type": "application/json", "x-research-timestamp": timestamp,
      "x-research-signature": researchSignature(fixtureSecret, timestamp, body),
    };
    const synced = await fetch(`${base}${SYNC_PATH}`, { method: "POST", headers: syncHeaders, body });
    assert.equal(synced.status, 200, await synced.clone().text());
    const [kept] = await db.select().from(salonEnrichmentRows).where(eq(salonEnrichmentRows.id, approved.id));
    assert.equal(kept.reviewStatus, "approved");
    assert.deepEqual(kept.evidence, approved.evidence);
    const [keptReject] = await db.select().from(salonEnrichmentRows).where(eq(salonEnrichmentRows.id, rejected.id));
    assert.equal(keptReject.reviewStatus, "rejected");
    // Refuse older signed data, rather than silently rolling progress backwards.
    const oldBody = JSON.stringify(snapshot);
    const oldTimestamp = String(Date.now());
    assert.equal((await fetch(`${base}${SYNC_PATH}`, {
      method: "POST", headers: { "Content-Type": "application/json",
        "x-research-timestamp": oldTimestamp,
        "x-research-signature": researchSignature(fixtureSecret, oldTimestamp, oldBody) }, body: oldBody,
    })).status, 409);
    const [after] = await db.select().from(salonEnrichmentBatches)
      .where(eq(salonEnrichmentBatches.id, batchId!));
    assert.equal(after.importedRows, 0);
    assert.equal(after.usedSerpCalls, 0);
  } finally {
    // Delete only fixtures created above; no existing contacts, deals, or imports.
    if (batchId) await db.delete(salonEnrichmentBatches)
      .where(and(eq(salonEnrichmentBatches.id, batchId), eq(salonEnrichmentBatches.userId, userId)));
    await db.delete(users).where(eq(users.id, userId));
    server.close();
    await once(server, "close");
  }
});
test.after(async () => { await pool.end(); });