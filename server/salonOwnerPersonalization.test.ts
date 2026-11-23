import assert from "node:assert/strict";
import test from "node:test";
import type { Contact, User } from "@shared/schema";
import {
  EMPTY_OWNER_NAME_RESULT,
  salonOwnerNameForImport,
  type OwnerNameResult,
} from "@shared/salonOwnerName";
import { replaceTemplateVariables } from "./sendgrid";
import { stripLegacyOwnerHtml } from "./salonOwnerNames";
import { convertSalonSearchReportEntry, salonSearchReportBatchSchema } from "./salonSearchReport";

const salesperson = {
  id: "test-user", firstName: "Sales", lastName: "Person",
  email: "sales@example.test", workEmail: "work@example.test",
} as User;

const companyContact = {
  id: "test-contact", userId: salesperson.id, company: "Example Salon",
  city: "Example City", firstName: null, lastName: null, useBusinessNameForEmail: "Yes",
} as Contact;

function approvedOwner(usePersonalName: boolean): OwnerNameResult {
  return {
    ...EMPTY_OWNER_NAME_RESULT,
    status: "needs_review",
    candidates: [{
      id: "owner-jane", firstName: "Jane", lastName: null,
      role: "owner", roleConfirmed: true, businessMatched: true, confidence: "high",
      sources: [{
        kind: "website_about", url: "https://example.test/about",
        excerpt: "Example Salon at 12 Main Street. Owner: Jane.",
      }],
    }],
    selectedCandidateId: "owner-jane",
    approvedAt: "2026-09-30T00:00:00.000Z",
    usePersonalName,
  };
}

test("actual sequence renderer uses explicitly approved personal first name, with no invented surname", () => {
  const imported = salonOwnerNameForImport(approvedOwner(true));
  const contact = { ...companyContact, ...imported };
  assert.equal(imported.lastName, null);
  assert.equal(
    replaceTemplateVariables("Hi [Contact_First_Name], [Business_Name] in [City].", contact, salesperson),
    "Hi Jane, Example Salon in Example City.",
  );
});

test("approved contact names and business-name email preference stay independent", () => {
  const imported = salonOwnerNameForImport(approvedOwner(false));
  assert.equal(imported.firstName, "Jane");
  assert.equal(imported.lastName, null);
  assert.equal(imported.useBusinessNameForEmail, "Yes");
  assert.equal(
    replaceTemplateVariables("Hi [Contact_First_Name]", { ...companyContact, ...imported }, salesperson),
    "Hi Example Salon team",
  );
});

test("unapproved team mentions never supply sequence first names", () => {
  const staged = approvedOwner(true);
  staged.candidates[0].roleConfirmed = false;
  staged.candidates[0].role = "team member";
  const imported = salonOwnerNameForImport(staged);
  assert.equal(imported.firstName, null);
  assert.equal(
    replaceTemplateVariables("Hi [Contact_First_Name]", { ...companyContact, ...imported }, salesperson),
    "Hi Example Salon team",
  );
});

test("unknown names and explicit legacy business-name preferences retain the actual fallback", () => {
  assert.equal(replaceTemplateVariables("[Contact_First_Name]", {
    ...companyContact, useBusinessNameForEmail: "No",
  }, salesperson), "Example Salon");
  assert.equal(replaceTemplateVariables("[Contact_First_Name]", {
    ...companyContact, firstName: "Manual", lastName: "Name", useBusinessNameForEmail: "Yes",
  }, salesperson), "Example Salon");
  assert.equal(replaceTemplateVariables("[Contact_First_Name]", {
    ...companyContact, firstName: "Manual", lastName: "Name", useBusinessNameForEmail: "No",
  }, salesperson), "Manual");
});

test("reusable legacy owner HTML helper preserves the existing Contacts text extraction", () => {
  const html = "<style>.hidden { display: none }</style><script>hidden()</script>" +
    "<h2>Owner: Jane</h2><p>Meet our team &amp; clients.</p>" +
    "<blockquote>Reviewer: Bob</blockquote>";
  const previous = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  assert.equal(stripLegacyOwnerHtml(html), previous);
  assert.equal(stripLegacyOwnerHtml(html), "Owner: Jane Meet our team &amp; clients. Reviewer: Bob");
});