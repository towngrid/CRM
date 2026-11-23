import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import XLSX from "xlsx";
import express from "express";
import { directoryEligibility, directoryEligibilitySummary, directoryNotesEvidence, directoryObject,
  groomingReviewFor, isBookingOrOrderingUrl, withDirectoryNotes } from "../shared/directoryEligibility";
import type { SalonEnrichmentRow } from "../shared/schema";
import { hasPublicGeneralInquiryForm, importResultsToCRM, parseGoogleMapsResults } from "./lead-discovery";
import { stageSalonListRows } from "./salonListStaging";
import { canApproveSalonReportRow, salonReportScheduleRejection, salonReportSendRejection } from "./salonSearchReport";
import { importableSalonEmail } from "./bookingPageEmail";
import { canEnrollFormRow, validFormUrl } from "./formOutreachPolicy";
import { storage } from "./storage";
import { registerDirectoryEligibilityRoutes } from "./directoryEligibilityRoutes";

function row(category = "Pet groomer", extra: Record<string, unknown> = {}): SalonEnrichmentRow {
  return {
    id: "row", batchId: "batch", userId: "owner", businessName: "Fixture Business",
    address: "12 Main Street", placeId: "exact-id", status: "enriched", reviewStatus: "approved",
    identityMatchStatus: "strong", websiteUrl: "https://fixture.example/",
    email: "hello@fixture.example", bookingUrl: null, importedContactId: null, audienceTrack: "directory_general",
    sourceData: { category: "verified_public_email", Outcome: "verified_first_party_email",
      "Public email (review-only when marked)": "hello@fixture.example" },
    evidence: {
      directoryListing: { categories: [category], name: "Fixture Business", address: "12 Main Street",
        placeId: "exact-id", provider: "Fixture provider" },
      email: { value: "hello@fixture.example", source: "public_web_review", confidence: "high",
        purpose: "general", sourceUrl: "https://fixture.example/contact" },
    }, ...extra,
  } as SalonEnrichmentRow;
}
function reviewed(value: SalonEnrichmentRow, decision: "approved" | "excluded") {
  return { ...value, evidence: { ...directoryObject(value.evidence),
    groomingReview: groomingReviewFor(value, decision, "Human reviewed the current services and business identity") } };
}

test("exact identity never overrides unrelated categories; ambiguous pet businesses remain reviewable", () => {
  for (const category of ["American restaurant", "Grocery store", "Supermarket", "Dollar store", "Pharmacy", "Hair salon"]) {
    assert.equal(directoryEligibility(row(category)).flagged, true, category);
    assert.equal(directoryEligibility(row(category)).blocked, true, category);
  }
  for (const category of ["Pet store", "Pet supply store", "Pet boarding service", "Dog day care center", "Veterinarian", "Kennel"]) {
    const candidate = row(category, { reviewStatus: "needs_review" });
    assert.equal(directoryEligibility(candidate).classification, "ambiguous", category);
    const confirmed = reviewed(candidate, "approved");
    assert.equal(directoryEligibility(confirmed).blocked, false, category);
    assert.equal(confirmed.reviewStatus, "needs_review", "Suitability does not approve the email");
    assert.equal(confirmed.importedContactId, null);
  }
  assert.equal(directoryEligibility(row("Pet groomer")).blocked, false);
  assert.equal(directoryEligibility(row("Grocery store, Pet groomer")).blocked, true);
  assert.equal(directoryEligibility({ sourceData: { category: "review_only" } }).classification, "unknown");
});

test("decisions bind to business and provider evidence, support reversal, and never trust uploaded review decisions", () => {
  const candidate = row("Pet store");
  const approved = reviewed(candidate, "approved");
  assert.equal(directoryEligibility(approved).decision, "approved");
  assert.equal(directoryEligibility({ ...approved, businessName: "Another business" }).blocked, true);
  assert.equal(directoryEligibility({ ...approved, evidence: { ...directoryObject(approved.evidence),
    directoryListing: { ...directoryObject(approved.evidence).directoryListing, categories: ["Pharmacy"] } } }).blocked, true);
  const excluded = reviewed(approved, "excluded");
  assert.equal(directoryEligibility(excluded).blocked, true);
  assert.equal(directoryEligibility(reviewed(excluded, "approved")).blocked, false);
  assert.equal(directoryEligibility({ ...candidate, sourceData: { groomingReview: groomingReviewFor(candidate, "approved", "forged") } }).blocked, true);
  assert.equal(groomingReviewFor(candidate, "approved", " ").note, "");
});

test("full summaries include hidden flagged, approved and excluded rows without approving unsuitable email rows", () => {
  const values = [row("Pharmacy"), row("Pet store"), row("Pet groomer"),
    reviewed(row("Dollar store"), "excluded")];
  assert.deepEqual(directoryEligibilitySummary(values), { total: 4, flagged: 1, needsGroomingReview: 2, approved: 1, excluded: 1 });
});

test("Maps parsing and legacy notes preserve category and identity evidence without losing existing notes", () => {
  const [parsed] = parseGoogleMapsResults({ place_results: { title: "Listing", type: "Pet store",
    types: ["store", "Pet store"], address: "12 Main Street", place_id: "exact-id" } });
  assert.deepEqual(parsed.categories, ["Pet store", "store"]);
  const metadata = { directoryListing: { categories: parsed.categories, name: parsed.title, address: parsed.address, placeId: parsed.placeId } };
  const notes = withDirectoryNotes("Original crawl notes", metadata);
  assert.ok(notes.startsWith("Original crawl notes"));
  const lead = { company: "Listing", address: parsed.address, notes };
  assert.equal(directoryEligibility(lead).blocked, true);
  const revised = withDirectoryNotes(notes, { ...directoryNotesEvidence(notes), groomingReview: groomingReviewFor(lead, "approved", "Reviewed grooming services") });
  assert.equal(directoryEligibility({ ...lead, notes: revised }).blocked, false);
  assert.ok(revised.startsWith("Original crawl notes"));
  assert.equal(revised.split("[Directory eligibility]").length, 2);
  assert.deepEqual(directoryNotesEvidence("malformed"), {});
});

test("unrelated and excluded rows cannot approve/import email, enroll forms or schedule/send sequences", () => {
  const blocked = row("Pharmacy");
  assert.equal(importableSalonEmail(blocked), null);
  assert.equal(canApproveSalonReportRow(blocked), false);
  const schedule = { row: { ...blocked, status: "imported", importedContactId: "contact" },
    contact: { userId: "owner", email: blocked.email, sequenceTrack: "directory_general" },
    sequence: { userId: "owner", sequenceTrack: "directory_general", sequenceNumber: 1, isActive: "true" },
    userId: "owner", hasOwnedDeal: true, scheduledSendAt: new Date(Date.now() + 60_000) };
  assert.match(salonReportScheduleRejection(schedule) || "", /grooming suitability/i);
  assert.match(salonReportSendRejection(schedule.row, schedule.contact, "owner") || "", /Grooming suitability/);
  const form = { ...blocked, email: null, contactRequestFormUrl: "https://fixture.example/contact", contactFormStatus: "verified" };
  assert.equal(canEnrollFormRow(form), false);
  assert.equal(canEnrollFormRow(reviewed(form, "approved")), true);
  assert.equal(importableSalonEmail(reviewed(blocked, "approved")), blocked.email);
  assert.equal(importableSalonEmail(reviewed(row("Pet groomer"), "excluded")), null);
});

test("booking/ordering pages and actions are not general forms even with contact headings and message fields", () => {
  const html = '<h1>Contact us</h1><form><input name="name"><textarea name="message"></textarea><button>Submit</button></form>';
  assert.equal(hasPublicGeneralInquiryForm(html, "https://fixture.example/contact"), true);
  for (const url of ["https://fixture.example/booking", "https://fixture.example/order",
    "https://fixture.example/booking.html", "https://fixture.example/BookAppointment",
    "https://fixture.example/%6frdering", "https://booking.fixture.example/contact",
    "https://fixture.example/checkout", "https://www.petco.com/shop/PetcoServicesBookGrooming",
    "https://toasttab.com/fixture", "https://squareup.com/appointments/book/id"]) {
    assert.equal(isBookingOrOrderingUrl(url), true, url);
    assert.equal(hasPublicGeneralInquiryForm(html, url), false, url);
    assert.equal(validFormUrl(url, url), false, url);
  }
  assert.equal(hasPublicGeneralInquiryForm(html.replace("<form>", '<form action="/order">'), "https://fixture.example/contact"), false);
  assert.equal(hasPublicGeneralInquiryForm(html.replace("Contact us", "Place your order"), "https://fixture.example/"), false);
  const malicious = row("Pet groomer");
  malicious.evidence = { directoryListing: { categories: ["Pet groomer"], sourceUrl: "javascript:alert(1)" } };
  assert.equal(directoryEligibility(malicious).listing.sourceUrl, null);
});

test("authenticated eligibility endpoints persist independently, protect ownership and return whole-batch counts", async () => {
  let current = row("Pharmacy", { reviewStatus: "needs_review" });
  const calls: unknown[] = [];
  const originals: Record<string, any> = {};
  const fixtures: Record<string, any> = {
    getSalonEnrichmentRow: async (_id: string, scope: string | null) => scope === "other" ? undefined : current,
    updateSalonEnrichmentRow: async (_id: string, patch: any) => { calls.push(patch); current = { ...current, ...patch }; return current; },
    getSalonEnrichmentBatch: async (_id: string, scope: string | null) => scope === "other" ? undefined : { id: "batch", userId: "owner" },
    getSalonEnrichmentRows: async () => [current, row("Pet groomer"), reviewed(row("Dollar store"), "excluded")],
    refreshSalonEnrichmentBatchCounts: async () => undefined,
  };
  for (const [key, value] of Object.entries(fixtures)) { originals[key] = (storage as any)[key]; (storage as any)[key] = value; }
  const app = express(); app.use(express.json());
  registerDirectoryEligibilityRoutes(app, (req: any, res, next) => {
    if (!req.headers["x-fixture-user"]) return res.sendStatus(401);
    req.user = { claims: { sub: req.headers["x-fixture-user"], role: "salesperson" } }; next();
  });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (user: string, payload: unknown) => fetch(base + "/api/salon-enrichment/rows/row/eligibility", {
    method: "POST", headers: { "Content-Type": "application/json", "x-fixture-user": user }, body: JSON.stringify(payload),
  });
  try {
    assert.equal((await fetch(base + "/api/salon-enrichment/batches/batch/eligibility-summary")).status, 401);
    assert.equal((await request("other", { decision: "approved", note: "Review", confirmed: true })).status, 404);
    assert.equal((await request("owner", { decision: "approved", note: "Review" })).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await request("owner", { decision: "approved", confirmed: true })).status, 200);
    assert.equal(current.reviewStatus, "needs_review");
    assert.equal(current.importedContactId, null);
    assert.equal(directoryEligibility(current).blocked, false);
    assert.equal((await request("owner", { decision: "excluded", note: "No grooming services offered", confirmed: true })).status, 200);
    assert.equal(current.reviewStatus, "needs_review");
    assert.equal(directoryEligibility(current).blocked, true);
    const counts = await (await fetch(base + "/api/salon-enrichment/batches/batch/eligibility-summary", { headers: { "x-fixture-user": "owner" } })).json();
    assert.deepEqual(counts, { total: 3, flagged: 0, needsGroomingReview: 0, approved: 1, excluded: 2 });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const [key, value] of Object.entries(originals)) (storage as any)[key] = value;
  }
});

test("legacy import rejects blocked and foreign rows before any contact mutation", async () => {
  const original = storage.getLeadDiscoveryResultById;
  storage.getLeadDiscoveryResultById = async id => ({
    id, userId: id === "foreign" ? "other" : "owner", company: "Fixture", isImported: "false",
    notes: withDirectoryNotes("", { directoryListing: { categories: ["Pharmacy"] } }),
  }) as any;
  try {
    const result = await importResultsToCRM(["blocked", "foreign"], "owner");
    assert.equal(result.imported, 0);
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /grooming suitability/);
    assert.match(result.errors[1], /not found/);
  } finally { storage.getLeadDiscoveryResultById = original; }
});

test("single and bulk enrollment consult the source suitability guard before creating any queue entry", async () => {
  const originals = {
    getContact: storage.getContact, getEmailSequence: storage.getEmailSequence,
    getSalonReportSendRejection: storage.getSalonReportSendRejection,
  };
  let checked = 0;
  storage.getContact = async () => ({ id: "contact", userId: "owner", email: "hello@fixture.example" }) as any;
  storage.getEmailSequence = async () => ({ id: "sequence", userId: "owner", sequenceTrack: "directory_general" }) as any;
  storage.getSalonReportSendRejection = async () => { checked++; return "Grooming suitability is excluded"; };
  try {
    await assert.rejects(storage.createEmailSequenceLog({ contactId: "contact", sequenceId: "sequence" } as any, "owner"), /Grooming suitability/);
    const result = await storage.bulkCreateEmailSequenceLogs("sequence", ["contact"], "owner");
    assert.equal(result.successful.length, 0);
    assert.match(result.failed[0].error, /Grooming suitability/);
    assert.equal(checked, 2);
  } finally { Object.assign(storage, originals); }
});