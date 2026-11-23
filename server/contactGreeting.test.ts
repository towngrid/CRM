import assert from "node:assert/strict";
import test from "node:test";
import type { Contact, User } from "@shared/schema";
import { replaceTemplateVariables } from "./sendgrid";

const salesperson = { firstName: "Sales", lastName: "Person" } as User;
const contact = {
  firstName: "Eliud",
  company: "Curly Tails",
  useBusinessNameForEmail: "No",
} as Contact;
const render = (template: string, overrides: Partial<Contact> = {}) =>
  replaceTemplateVariables(template, { ...contact, ...overrides }, salesperson);

test("a mixed group uses a personal or business-team greeting per recipient", () => {
  const recipients: Partial<Contact>[] = [
    {},
    { firstName: null },
    { firstName: "Eliud", useBusinessNameForEmail: "Yes" },
    { firstName: "" },
    { firstName: "  " },
  ];
  const expected = [
    "Hi Eliud,",
    "Hi Curly Tails team,",
    "Hi Curly Tails team,",
    "Hi Curly Tails team,",
    "Hi Curly Tails team,",
  ];
  for (const template of ["[Contact_Greeting]", "Hi [Contact_First_Name],"]) {
    assert.deepEqual(recipients.map(recipient => render(template, recipient)), expected);
  }
});

test("saved greetings support leading whitespace, HTML and formatted name tokens", () => {
  for (const template of [
    "\n Hi [Contact_First_Name],\n\nWelcome.",
    "<p>Hi [Contact_First_Name],</p><p>Welcome.</p>",
    "<p>Hi <strong>[Contact_First_Name]</strong>,</p>",
    "<div><p>Hi&nbsp;[Contact_First_Name],</p></div>",
  ]) {
    assert.equal(render(template, { firstName: null }), template.replace("[Contact_First_Name]", "Curly Tails team"));
    assert.equal(render(template), template.replace("[Contact_First_Name]", "Eliud"));
  }
});

test("first-name tokens outside the opening salutation retain their existing meaning", () => {
  assert.equal(render("A question for [Contact_First_Name] about [Business_Name]", { firstName: null }),
    "A question for Curly Tails about Curly Tails");
  assert.equal(render("Hi [Contact_First_Name],\n[Contact_First_Name] at [Business_Name].", { firstName: null }),
    "Hi Curly Tails team,\nCurly Tails at Curly Tails.");
});

test("existing directory subjects use personal or team names for a mixed group", () => {
  const subject = "[Contact_First_Name], are you on Google Maps yet?";
  const suffix = ", are you on Google Maps yet?";
  assert.equal(render(subject), `Eliud${suffix}`);
  assert.equal(render(subject, { firstName: null }), `Curly Tails team${suffix}`);
  assert.equal(render(subject, { firstName: "Eliud", useBusinessNameForEmail: "Yes" }), `Curly Tails team${suffix}`);
  assert.equal(render(subject, { firstName: " " }), `Curly Tails team${suffix}`);
  assert.equal(render(`  ${subject}`, { firstName: null }), `  Curly Tails team${suffix}`);
  assert.equal(render(subject, { firstName: null, company: null }), `Hello${suffix}`);
});

test("missing business and personal names produce a neutral greeting", () => {
  for (const template of ["[Contact_Greeting]", "Hi [Contact_First_Name],"]) {
    assert.equal(render(template, { firstName: null, company: null }), "Hi there,");
    assert.equal(render(template, { firstName: " ", company: " " }), "Hi there,");
  }
});

test("greetings do not change contact records or replace manually written names", () => {
  const before = { ...contact };
  assert.equal(render("Hi Pat,\nYour salon is [Business_Name]."), "Hi Pat,\nYour salon is Curly Tails.");
  assert.equal(render("[Contact_Greeting]"), "Hi Eliud,");
  assert.deepEqual(contact, before);
});