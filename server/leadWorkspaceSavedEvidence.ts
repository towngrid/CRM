import { existsSync, readFileSync } from "node:fs";
import Papa from "papaparse";
import type { SalonEnrichmentRow } from "@shared/schema";
import { directoryObject } from "@shared/directoryEligibility";
import { sameLead, unifiedUploadRow } from "./leadWorkspacePolicy";

// Read-only compatibility for the restored file: old staging omitted its review
// columns and clipped notes. Exact identity AND the same saved candidate are required.
// The old salon list (reports/) is not part of the TownGrid branch, so there is nothing to recover from.
const originalFile = new URL("../reports/salon-36-sales-lead-review.csv", import.meta.url);
const original = existsSync(originalFile) ? Papa.parse<Record<string, string>>(readFileSync(originalFile, "utf8"),
  { header: true, skipEmptyLines: true }).data : [];
export function recoveredLeadEvidence(row: SalonEnrichmentRow): SalonEnrichmentRow {
  const source = directoryObject(row.sourceData);
  if (source.originalInput || !["staged_unverified", "verification_attempted"].includes(String(source.stagingState))) return row;
  const candidate = String(source.uploadedEmailCandidate || "");
  const match = original.find(raw => sameLead(row, {
    businessName: raw["Business Name"], phone: raw.Phone, placeId: null, address: raw.Address, state: raw.State,
  }) && String(raw.Email || "").trim().toLowerCase() === candidate.trim().toLowerCase());
  if (!match) return row;
  const recovered = unifiedUploadRow(match, row.rowNumber - 1, row.userId);
  if (!recovered) return row;
  return { ...row, sourceData: { ...directoryObject(recovered.sourceData), ...source,
    originalInput: match, historicalFinding: directoryObject(recovered.sourceData).historicalFinding,
    historicalSourceUrl: directoryObject(recovered.sourceData).historicalSourceUrl },
    evidence: { ...directoryObject(recovered.evidence), ...directoryObject(row.evidence),
      originalNotes: match.notes, historicalFinding: directoryObject(recovered.evidence).historicalFinding } };
}