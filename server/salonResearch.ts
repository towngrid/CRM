import type { Express, RequestHandler } from "express";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import XLSX from "xlsx";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { salonEnrichmentBatches, salonEnrichmentRows, type SalonEnrichmentBatch } from "@shared/schema";
import { stageSalonListRows } from "./salonListStaging";
import { directoryEligibility } from "@shared/directoryEligibility";
import { convertSalonSearchReportEntry, type ReviewedSalonReportEntry } from "./salonSearchReport";
import {
  ORIGINAL_DIRECTORY, RESEARCH_DATASET, SYNC_PATH, readResearchSnapshot,
  researchSignature, researchSnapshotSchema, verifyResearchSignature, type ResearchSnapshot,
} from "./salonResearchSnapshot";

type Progress = {
  datasetKey: string; directoryTotal: number; originalRows: number;
  snapshot: ResearchSnapshot | null; snapshotHash?: string;
  lastSyncedAt: string | null; lastRemoteSyncAt?: string;
};
let directoryCache: Record<string, unknown>[] | undefined;
function directory() {
  directoryCache ??= XLSX.utils.sheet_to_json<Record<string, unknown>>(
    XLSX.readFile(ORIGINAL_DIRECTORY).Sheets.Sheet1);
  return directoryCache;
}
function fixedSampleIds() {
  const workbook = XLSX.readFile("reports/salon-provider-comparison-sample.xlsx");
  return new Set(XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets.Sample)
    .map(row => row["Google Place ID"]));
}
export function validateFixedSample(snapshot: ResearchSnapshot) {
  const ids = fixedSampleIds();
  if (ids.size !== 120 || snapshot.rows.some(row => !ids.has(row.placeId))) {
    throw new Error("Research synchronization does not match the authorized fixed sample");
  }
}
const metadata = (batch: SalonEnrichmentBatch) => batch.researchProgress as Progress;
const datasetWhere = sql`${salonEnrichmentBatches.researchProgress}->>'datasetKey' = ${RESEARCH_DATASET}`;
async function researchBatch() {
  const batches = await db.select().from(salonEnrichmentBatches).where(datasetWhere).limit(2);
  if (batches.length > 1) throw new Error("Ambiguous research directory; synchronization stopped");
  return batches[0] ?? null;
}
function digest(snapshot: ResearchSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
const unchanged = (batch: SalonEnrichmentBatch, snapshot: ResearchSnapshot) =>
  metadata(batch).snapshotHash === digest(snapshot);

export function researchEntry(row: ResearchSnapshot["rows"][number]): ReviewedSalonReportEntry {
  const unrelatedBusiness = row.websiteIdentity === "rejected" &&
    directoryEligibility({ sourceData: { "Provider category": row.providerCategory } }).classification === "unrelated";
  return {
    Business: row.businessName, State: row.state,
    "Google Place ID": row.placeId, "Source address": row.address,
    Outcome: row.emailVerified ? "verified_first_party_email"
      : unrelatedBusiness ? "excluded_non_grooming"
      : row.websiteIdentity === "third_party_booking" ? "booking_only"
      : row.email ? "review_only_candidate" : "no_verified_email",
    "Public email (review-only when marked)": row.email,
    "Email evidence URL": row.emailSourceUrl,
    "Email use": row.emailVerified ? "Public business contact" : "Unverified candidate; review only",
    "Evidence and exceptions": row.notes,
  };
}
export function preserveResearchDecision(row: {
  importedContactId?: string | null; reviewStatus: string; status: string;
}) {
  return !!row.importedContactId || row.status === "imported" ||
    row.reviewStatus === "approved" || row.reviewStatus === "rejected";
}

async function applySnapshot(batchId: string, snapshot: ResearchSnapshot, remote = false) {
  validateFixedSample(snapshot);
  await db.transaction(async tx => {
    // Serialize sync, initialization, and existing approval/import operations on
    // their actual database rows. A sync never reverses a salesperson's decision.
    const [batch] = await tx.select().from(salonEnrichmentBatches)
      .where(eq(salonEnrichmentBatches.id, batchId)).for("update");
    if (!batch || metadata(batch)?.datasetKey !== RESEARCH_DATASET) throw new Error("Research directory not initialized");
    const previous = metadata(batch);
    if (previous.snapshot && Date.parse(snapshot.sourceUpdatedAt) < Date.parse(previous.snapshot.sourceUpdatedAt)) {
      throw new Error("Older research snapshot refused");
    }
    if (unchanged(batch, snapshot)) {
      // A matching initial snapshot still proves that the live bridge reached
      // production. Do not leave a completed pilot labeled disconnected forever.
      if (remote) await tx.update(salonEnrichmentBatches).set({
        researchProgress: { ...previous, lastRemoteSyncAt: new Date().toISOString(),
          lastSyncedAt: new Date().toISOString() },
      }).where(eq(salonEnrichmentBatches.id, batch.id));
      return;
    }
    const rows = await tx.select().from(salonEnrichmentRows)
      .where(and(eq(salonEnrichmentRows.batchId, batch.id),
        inArray(salonEnrichmentRows.placeId, snapshot.rows.map(row => row.placeId)))).for("update");
    if (rows.length !== 120) throw new Error("Directory does not contain all 120 pilot IDs");
    for (const result of snapshot.rows) {
      const row = rows.find(row => row.placeId === result.placeId)!;
      if (preserveResearchDecision(row)) continue;
      const resultHash = createHash("sha256").update(JSON.stringify(result)).digest("hex");
      if ((row.sourceData as Record<string, unknown>)?.researchResultHash === resultHash) continue;
      const converted = convertSalonSearchReportEntry(researchEntry(result), row.rowNumber, batch.id, batch.userId);
      const sourceData = {
        ...(row.sourceData as Record<string, unknown>), ...(converted.sourceData as Record<string, unknown>),
        category: result.emailVerified ? "verified_public_email"
          : researchEntry(result).Outcome === "excluded_non_grooming" ? "non_grooming"
          : result.websiteIdentity === "third_party_booking" ? "booking_only" : "review_only",
        // Disable unrelated paid verification/retry controls on the master list.
        stagingState: "research_directory",
        researchPaired: result.paired,
        researchWebsiteIdentity: result.websiteIdentity,
        researchResultHash: resultHash,
        "Provider category": result.providerCategory,
        "Provider business name": result.businessName,
        "Provider Place ID": result.placeId,
        "Provider address": result.address,
        "Booking URL (query removed)": result.websiteIdentity === "third_party_booking" ? result.websiteUrl : "",
      };
      await tx.update(salonEnrichmentRows).set({
        sourceData, email: converted.email,
        websiteUrl: result.websiteUrl || null,
        bookingUrl: result.websiteIdentity === "third_party_booking" ? result.websiteUrl : null,
        evidence: { ...(row.evidence as Record<string, unknown>), ...(converted.evidence as Record<string, unknown>),
          generalContactForm: result.generalFormUrl ? {
            sourceUrl: result.generalFormUrl, source: "public_web_review",
            status: "reviewed_structure_only", submitted: false,
          } : null },
        contactRequestFormUrl: result.generalFormUrl || null,
        identityMatchStatus: result.emailVerified ? "strong" : "unmatched",
        status: result.websiteIdentity === "rejected" ? "rejected" : "enriched",
        // This is source evidence, not approval. Rejected controls stay excluded.
        reviewStatus: result.websiteIdentity === "rejected" ? "rejected" : "needs_review",
        processedAt: new Date(),
      }).where(eq(salonEnrichmentRows.id, row.id));
    }
    const now = new Date().toISOString();
    await tx.update(salonEnrichmentBatches).set({
      researchProgress: { ...previous, snapshot, snapshotHash: digest(snapshot), lastSyncedAt: now,
        ...(remote ? { lastRemoteSyncAt: now } : {}) },
      processedRows: snapshot.rows.filter(row => row.paired).length,
      enrichedRows: snapshot.rows.filter(row => row.emailVerified).length,
      // This master list is review-only: never run the generic enrichment worker.
      status: "paused", updatedAt: new Date(),
    }).where(eq(salonEnrichmentBatches.id, batch.id));
  });
}

async function initialize(userId: string) {
  // One directory per application; concurrent clicks cannot create duplicate lists.
  const batchId = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${RESEARCH_DATASET}))`);
    const [existing] = await tx.select().from(salonEnrichmentBatches).where(datasetWhere);
    if (existing) return existing.id;
    const id = randomUUID();
    const inputs = directory().map(row => ({
      "Business Name": row.varLocationName,
      "Google Place ID": row.GooglePlaceID,
      Address: row.FormattedAddress,
      State: row.varLocationState,
      "ZIP Code": row.varLocationZip,
    }));
    const staged = stageSalonListRows(inputs, userId, id, []);
    if (staged.rows.length !== 13847 || staged.invalidCount) {
      throw new Error("Original directory changed; expected 13,847 distinct listings");
    }
    await tx.insert(salonEnrichmentBatches).values({
      id, userId, name: "CA, TX and NY salon research directory",
      fileName: "salon-public-web-review", totalRows: staged.rows.length,
      status: "paused", pilotLimit: 120, estimatedSerpCalls: 0,
      researchProgress: { datasetKey: RESEARCH_DATASET, directoryTotal: staged.rows.length,
        originalRows: inputs.length, snapshot: null, lastSyncedAt: null },
    });
    for (let offset = 0; offset < staged.rows.length; offset += 500) {
      await tx.insert(salonEnrichmentRows).values(staged.rows.slice(offset, offset + 500).map(row => ({
        ...row, sourceData: { ...(row.sourceData as object), stagingState: "research_directory",
          researchDataset: RESEARCH_DATASET,
          researchPaired: false },
        evidence: { note: "Original directory listing only. Not yet checked; not an approved CRM contact." },
      })));
    }
    return id;
  });
  // On production this is a clearly labeled initial snapshot, not a live worker.
  const snapshot = readResearchSnapshot();
  if (snapshot) await applySnapshot(batchId, snapshot);
}

function statusFor(batch: SalonEnrichmentBatch | null, canInitialize: boolean) {
  const progress = batch ? metadata(batch) : null;
  const snapshot = progress?.snapshot ?? (process.env.NODE_ENV !== "production" ? readResearchSnapshot() : null);
  const sourceAge = snapshot ? Date.now() - Date.parse(snapshot.sourceUpdatedAt) : Infinity;
  const production = process.env.NODE_ENV === "production";
  const connection = production ? progress?.lastRemoteSyncAt ? "connected_live_sync" : "disconnected_awaiting_sync"
    : "connected_workspace_source";
  const stopped = !!snapshot?.status.startsWith("stopped");
  return {
    available: !!batch || existsSync(ORIGINAL_DIRECTORY),
    initialized: !!batch, canInitialize,
    batchId: batch?.id ?? null, directoryTotal: progress?.directoryTotal ?? 13847,
    pilotTotal: 120, pilotCompleted: snapshot?.rows.filter(row => row.paired).length ?? 0,
    verifiedEmails: snapshot?.rows.filter(row => row.emailVerified).length ?? 0,
    verifiedForms: snapshot?.rows.filter(row => row.generalFormUrl).length ?? 0,
    requestsInitiated: snapshot?.attempts.length ?? 0,
    monthlyCap: 200, hourlyLimit: snapshot?.hourlyLimit ?? 20,
    status: snapshot?.status ?? "not_connected",
    sourceUpdatedAt: snapshot?.sourceUpdatedAt ?? null,
    lastSyncedAt: progress?.lastSyncedAt ?? null,
    nextAllowanceAt: snapshot?.nextAllowanceAt ?? null,
    stale: sourceAge > 180000 && snapshot?.status !== "lookups_complete_review_pending" &&
      snapshot?.status !== "stopped_by_user",
    connection,
    message: production && !progress?.lastRemoteSyncAt
      ? "Initial snapshot only. Live synchronization must be enabled after publishing; this page does not start lookups."
      : snapshot?.status === "stopped_by_user"
        ? `Pilot closed at ${snapshot.rows.filter(row => row.paired).length}/120 at your request. Stored findings remain available; no further lookups are scheduled.`
      : stopped ? "Research stopped. Stored results remain available. No automatic retry or extra spending."
      : snapshot?.status === "lookups_complete_review_pending"
        ? "All pilot lookups are saved; remaining source review is still pending."
        : "Only the 120-row pilot is authorized. The rest of the directory is stored for browsing, not being researched.",
  };
}

export function registerSalonResearchRoutes(app: Express, authenticated: RequestHandler, admin: RequestHandler) {
  app.get("/api/salon-research/status", authenticated, async (req: any, res) => {
    try {
      const isAdmin = req.user.role === "admin";
      const batch = await researchBatch();
      const owned = batch && (isAdmin || batch.userId === req.user.claims.sub) ? batch : null;
      // Do not disclose another account's research progress.
      if (batch && !owned) return res.status(403).json({ message: "Research list belongs to another account" });
      res.setHeader("Cache-Control", "no-store");
      res.json(statusFor(owned, isAdmin));
    } catch { res.status(503).json({ message: "Research status unavailable; no lookup was started" }); }
  });
  app.post("/api/salon-research/initialize", authenticated, admin, async (req: any, res) => {
    try {
      await initialize(req.user.claims.sub);
      res.json(statusFor(await researchBatch(), true));
    } catch (error) {
      res.status(409).json({ message: error instanceof Error ? error.message : "Directory initialization failed" });
    }
  });
  app.post(SYNC_PATH, async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(401).json({ message: "Unauthorized research synchronization" });
    }
    const body = JSON.stringify(req.body);
    if (Buffer.byteLength(body) > 256000 ||
        !verifyResearchSignature(process.env.SESSION_SECRET,
          String(req.headers["x-research-timestamp"] ?? ""),
          String(req.headers["x-research-signature"] ?? ""), body)) {
      return res.status(401).json({ message: "Unauthorized research synchronization" });
    }
    const parsed = researchSnapshotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid fixed-sample research snapshot" });
    try {
      const batch = await researchBatch();
      if (!batch) return res.status(409).json({ message: "An administrator must initialize the research directory first" });
      await applySnapshot(batch.id, parsed.data, true);
      res.json({ synchronized: true, completed: parsed.data.rows.filter(row => row.paired).length });
    } catch {
      res.status(409).json({ message: "Research synchronization refused; stored approvals were not changed" });
    }
  });
}

let syncBusy = false;
let lastErrorLogAt = 0;
async function synchronize() {
  if (syncBusy || process.env.NODE_ENV === "production") return;
  syncBusy = true;
  try {
    const snapshot = readResearchSnapshot();
    if (!snapshot) return;
    const batch = await researchBatch();
    if (batch && !unchanged(batch, snapshot)) await applySnapshot(batch.id, snapshot);
    // TownGrid never sends research to another app (the old push to the previous app was removed).
  } catch {
    // No secrets, payloads, contact addresses, or raw provider errors in logs.
    if (Date.now() - lastErrorLogAt > 300000) {
      console.warn("Research synchronization unavailable. Stored results retained; no paid lookup or retry was made.");
      lastErrorLogAt = Date.now();
    }
  } finally { syncBusy = false; }
}
export function startSalonResearchSynchronization() {
  if (process.env.NODE_ENV === "production") return;
  void synchronize();
  setInterval(() => { void synchronize(); }, 30000).unref();
}