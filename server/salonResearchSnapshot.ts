import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

export const RESEARCH_DATASET = "ca-tx-ny-salon-directory-v1";
export const ORIGINAL_DIRECTORY = "attached_assets/0_CRM_Data_CA_NY_TX_Statewide_UNREGISTERED_Grooming_Salons_08_1790473643094.xlsx";
const PROGRESS_FILE = "reports/salon-provider-comparison-progress.json";
const REVIEW_FILE = "reports/salon-provider-comparison-review.json";
export const SYNC_PATH = "/api/salon-research/sync";

const publicUrl = z.string().max(2000).refine(value => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
});
const rowSchema = z.object({
  placeId: z.string().min(1).max(200),
  businessName: z.string().max(500),
  address: z.string().max(1000),
  state: z.enum(["CA", "TX", "NY"]),
  paired: z.boolean(),
  websiteUrl: publicUrl,
  providerCategory: z.string().max(500),
  websiteIdentity: z.string().max(100),
  email: z.union([z.literal(""), z.string().email().max(320)]),
  emailSourceUrl: publicUrl,
  emailVerified: z.boolean(),
  generalFormUrl: publicUrl,
  notes: z.string().max(6000),
}).strict().superRefine((row, ctx) => {
  if (row.emailVerified && (!row.email || !row.emailSourceUrl.startsWith("https://") ||
    row.websiteIdentity !== "verified")) {
    ctx.addIssue({ code: "custom", message: "Verified email requires first-party source review" });
  }
});
export const researchSnapshotSchema = z.object({
  datasetKey: z.literal(RESEARCH_DATASET),
  sourceUpdatedAt: z.string().datetime(),
  status: z.enum(["running", "waiting_hourly_allowance", "stopped_budget_or_monthly_cap",
    "stopped_monthly_cap", "stopped_provider_balance", "stopped_lookup_failure",
    "stopped_by_user", "lookups_complete_review_pending"]),
  hourlyLimit: z.number().int().min(1).max(200),
  nextAllowanceAt: z.string().datetime().nullable(),
  attempts: z.array(z.object({
    placeId: z.string().min(1).max(200),
    initiatedAt: z.string().datetime(),
  }).strict()).max(120),
  rows: z.array(rowSchema).length(120),
}).strict().superRefine((snapshot, ctx) => {
  if (new Set(snapshot.rows.map(row => row.placeId)).size !== 120 ||
      new Set(snapshot.attempts.map(row => row.placeId)).size !== snapshot.attempts.length ||
      snapshot.attempts.some(attempt => !snapshot.rows.some(row => row.placeId === attempt.placeId))) {
    ctx.addIssue({ code: "custom", message: "Snapshot must preserve distinct fixed-sample IDs" });
  }
});
export type ResearchSnapshot = z.infer<typeof researchSnapshotSchema>;

export function readResearchSnapshot(hourlyLimit = 20): ResearchSnapshot | null {
  if (!existsSync(PROGRESS_FILE)) return null;
  const progress = JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
  const reviews = existsSync(REVIEW_FILE)
    ? JSON.parse(readFileSync(REVIEW_FILE, "utf8")).reviews ?? [] : [];
  const attempts = progress.attempts.map((attempt: any) => ({
    placeId: attempt.placeId, initiatedAt: attempt.initiatedAt,
  }));
  const recent = attempts.filter((attempt: any) =>
    Date.parse(attempt.initiatedAt) > Date.now() - 3600000);
  const nextAllowanceAt = progress.status === "waiting_hourly_allowance" && recent.length >= hourlyLimit
    ? new Date(Math.min(...recent.map((attempt: any) => Date.parse(attempt.initiatedAt))) + 3600000).toISOString()
    : null;
  const rows = Object.entries(progress.rows).map(([placeId, raw]) => {
    const record = raw as any;
    const sources = [record.dataForSeo, record.serpApi].filter(Boolean);
    const decisions = reviews.find((review: any) => review.placeId === placeId)?.sites ?? [];
    // A decision is usable only for an exact website returned for this Place ID.
    const matched = decisions.filter((decision: any) =>
      sources.some((source: any) => source.exactPlaceId && source.siteKey === decision.siteKey));
    const decision = matched.find((review: any) => review.websiteIdentity === "verified" && review.verifiedEmail)
      ?? matched.find((review: any) => review.websiteIdentity === "verified")
      ?? matched[0];
    const source = sources.find((item: any) => item.siteKey === decision?.siteKey) ?? sources[0];
    const rejected = decision?.rejectedEmails?.some((item: any) =>
      item.email?.toLowerCase() === decision.verifiedEmail?.toLowerCase());
    const emailVerified = !!decision?.verifiedEmail && decision.websiteIdentity === "verified" && !rejected;
    return {
      placeId,
      businessName: String(record.sample["Salon name"]),
      address: String(record.sample["Full address"] ?? ""),
      state: record.sample.State,
      paired: !!record.serpApi,
      websiteUrl: source?.returnedWebsite ?? "",
      providerCategory: record.dataForSeo?.category ?? "",
      websiteIdentity: decision?.websiteIdentity ?? "not_reviewed",
      email: emailVerified ? decision.verifiedEmail : decision?.reviewOnlyEmail ?? "",
      emailSourceUrl: emailVerified ? decision.emailSourceUrl : decision?.reviewOnlyEmailSourceUrl ?? "",
      emailVerified,
      generalFormUrl: decision?.websiteIdentity === "verified" ? decision.verifiedGeneralFormUrl ?? "" : "",
      notes: decision?.notes ?? "Source review is not complete. Do not treat this as proof no email exists.",
    };
  });
  return researchSnapshotSchema.parse({
    datasetKey: RESEARCH_DATASET, sourceUpdatedAt: progress.updatedAt,
    status: progress.status, hourlyLimit, nextAllowanceAt, attempts, rows,
  });
}

// Domain-separated service authentication permits research-only synchronization,
// never contact approval/import/sending. No session cookies or raw secret travel.
export function researchSignature(secret: string, timestamp: string, body: string): string {
  const key = createHmac("sha256", secret).update("towngrid:salon-research-sync:v1").digest();
  return createHmac("sha256", key).update(`${timestamp}\nPOST\n${SYNC_PATH}\n${body}`).digest("hex");
}
export function verifyResearchSignature(secret: string | undefined, timestamp: string,
  signature: string, body: string, now = Date.now()): boolean {
  if (!secret || !/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature) ||
      Math.abs(now - Number(timestamp)) > 300000) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"),
    Buffer.from(researchSignature(secret, timestamp, body), "hex"));
}