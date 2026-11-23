import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Papa from "papaparse";
import XLSX from "xlsx";
import { historicalApprovalEvidence, leadIdentityIndex, leadView, sameLead, unifiedUploadRow, validateLeadMaterial } from "./leadWorkspacePolicy";
import { recoveredLeadEvidence } from "./leadWorkspaceSavedEvidence";
import { importableSalonEmail } from "./bookingPageEmail";
import { enrichRow } from "./salonEnrichment";
import { directoryNotesEvidence, directoryEligibility, withDirectoryNotes } from "@shared/directoryEligibility";

const asRow = (raw: Record<string, unknown>, i = 0) => ({ ...unifiedUploadRow(raw, i, "fixture-owner"),
  id: `fixture-${i}`, serpCallsUsed: 0 }) as any;
test("manual approval accepts optional review fields without inventing publicly verified evidence", () => {
  const row = asRow({ Business: "Fixture Grooming", Address: "1 Main Street, Austin TX", Email: "team@fixture.example",
    "Email Source URL": "https://fixture.example/contact", "Email Review Status": "confirmed_first_party" });
  const manual = historicalApprovalEvidence(row, {});
  assert.equal(manual.source,"manual_approval");
  assert.equal(manual.confidence,"manual");
  assert.equal(manual.fetchedAt,null);
  assert.equal(manual.reviewNote,"");
  assert.equal(importableSalonEmail({...row,email:manual.value,reviewStatus:"approved",identityMatchStatus:"strong",
    evidence:{email:manual},sourceData:{...row.sourceData,Outcome:"manually_approved_email"}}),manual.value);
  const evidence = historicalApprovalEvidence(row, { identityConfirmed: true, historicalEvidenceConfirmed: true, reviewNote: "Business and general contact source inspected." });
  assert.equal(evidence.value, "team@fixture.example");
  const approved = { ...row, email: evidence.value, identityMatchStatus: "strong", reviewStatus: "approved",
    sourceData: { ...row.sourceData, Outcome: "verified_first_party_email", category: "verified_public_email" }, evidence: { email: evidence } };
  assert.equal(importableSalonEmail(approved), evidence.value);
  assert.equal(approved.firstName, undefined);
  assert.match(leadView(row).nextAction, /Confirm business/);
  assert.match(leadView(approved).nextAction, /Add to CRM/);
  assert.throws(() => historicalApprovalEvidence({ ...row, sourceData: { ...row.sourceData, uploadedEmailCandidate: "support@wix.com" } },
    { identityConfirmed: true, historicalEvidenceConfirmed: true, reviewNote: "Not a salon address." }), /restricted/);
});
test("complete notes and original research metadata retained; oversized sources reject explicitly", () => {
  const notes = "Full original source evidence. ".repeat(1000);
  const raw = { Business: "Fixture", notes, researchDate: "2026-10-01T00:00:00Z", nested: { email: { excerpt: notes } } };
  validateLeadMaterial([raw]);
  const row = asRow(raw);
  assert.equal(row.sourceData.originalInput, raw);
  assert.equal(leadView(row).evidenceNote, notes);
  assert.equal(row.sourceData.originalResearchDate, raw.researchDate);
  assert.throws(() => validateLeadMaterial([{ Business: "Fixture", notes: "x".repeat(64001) }]), /nothing has been truncated/);
  assert.throws(() => validateLeadMaterial(new Array(20001).fill({ Business: "Fixture" })), /20,000/);
});
test("duplicates use exact IDs/name-location, not a shared switchboard; names and approval labels remain untrusted", () => {
  const a = asRow({ Business: "Fixture", Address: "1 Main Street", Phone: "5551112222", State: "TX" });
  const b = asRow({ Business: "Fixture", Address: "2 Main Street", Phone: "5551112222", State: "TX" });
  assert.equal(sameLead(a,b), false);
  assert.equal(sameLead(a, { ...a, placeId: "place1" }), true);
  const imported = asRow({ Business: "Fixture", ownerName: { status: "approved", usePersonalName: true,
    candidates: [{ firstName: "Jane", role: "owner", roleConfirmed: true, businessMatched: true, sources: [{ url: "https://fixture.example/about", excerpt: "Owner Jane" }] }] } });
  assert.equal(imported.evidence.ownerName.status, "needs_review");
  assert.equal(imported.evidence.ownerName.candidates[0].roleConfirmed, false);
  assert.equal(imported.evidence.ownerName.usePersonalName, false);
});
test("discovery eligibility evidence retains unrelated-business exclusion through compatibility notes", () => {
  const evidence = { directoryListing: { businessName: "Fixture Auto Body", categories: ["Auto body shop"], address: "1 Main Street" } };
  const notes = withDirectoryNotes("Original discovery notes", evidence);
  const row = asRow({ Business: "Fixture Auto Body", Address: "1 Main Street", notes });
  row.evidence = { ...row.evidence, ...directoryNotesEvidence(notes) };
  assert.ok(Object.keys(row.evidence.directoryListing).length);
});
test("website-first shared service uses matched pages without provider calls; Unknown is not No software", async () => {
  let paid = 0;
  const row = { ...asRow({ Business: "Fixture Grooming", Address: "1 Main Street TX", websiteUrl: "https://fixture.example" }), identityMatchStatus: "strong" };
  const result = await enrichRow(row, { matchedWebsite: true,
    search: async () => { paid++; throw new Error("No provider invocation expected."); },
    crawl: async () => ({ html: "<h1>Fixture Grooming</h1><p>1 Main Street TX</p>", email: "team@fixture.example",
      emailSourceUrl: "https://fixture.example/contact", resolvedWebsiteUrl: "https://fixture.example", partialFailures: [], rejectedEmails: [] }) });
  assert.equal(paid, 0);
  assert.equal(result.email, "team@fixture.example");
  assert.equal(result.usesSoftware, "Unknown");
  assert.equal(result.reviewStatus, "needs_review");
});