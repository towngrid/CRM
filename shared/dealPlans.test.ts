import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DEAL_PLANS, planChoices, planLabel, planPriceForLabel } from "./dealPlans";
import { DEAL_STAGES, DEAL_STAGE_VALUES, stageLabel } from "./dealStages";
import { LEAD_TYPES, leadTypesForList, parseLeadList, parseLeadType } from "./leadTypes";
import { insertDealSchema } from "./schema";
import { calculateCommission, getCommissionAmounts } from "./utils";

test("starting plans are TownGrid's, with the agreed prices", () => {
  assert.deepEqual(planChoices(DEFAULT_DEAL_PLANS), [
    "Get Seen - $129/mo",
    "Get Seen Plus - $179/mo",
    "Delivery Listing - $39/mo",
    "Restaurant Ordering - $79/mo",
    "Restaurant Ordering - $129/mo",
    "Founding Partner - $49/mo",
    "Unknown",
    "Logo (add-on) - $49 one-time",
    "Customer Emails (add-on) - $29/mo",
  ]);
});

test("a retired or older plan label stays selectable on its deal", () => {
  const choices = planChoices(DEFAULT_DEAL_PLANS, "Get Seen - $99/mo");
  assert.equal(choices[0], "Get Seen - $99/mo");
  const hidden = DEFAULT_DEAL_PLANS.map(p => (p.name === "Delivery Listing" ? { ...p, active: false } : p));
  assert.ok(!planChoices(hidden).includes("Delivery Listing - $39/mo"));
});

test("picking a plan fills in its price", () => {
  assert.equal(planPriceForLabel(DEFAULT_DEAL_PLANS, "Get Seen - $129/mo"), 129);
  assert.equal(planPriceForLabel(DEFAULT_DEAL_PLANS, "Unknown"), null);
  assert.equal(planLabel({ name: "Test", price: 49.5, billing: "monthly", kind: "plan" }), "Test - $49.50/mo");
});

for (const plan of planChoices(DEFAULT_DEAL_PLANS)) {
  test(`${plan} survives create/update validation and JSON round trips`, () => {
    const created = insertDealSchema.parse({ title: "Fixture deal", plan, value: "129" });
    const updated = insertDealSchema.partial().parse({ plan });
    assert.equal(JSON.parse(JSON.stringify(created)).plan, plan);
    assert.equal(JSON.parse(JSON.stringify(updated)).plan, plan);
  });
}

test("no ESyPet commission splits remain: every plan pays 0 until rules are set", () => {
  for (const plan of [...planChoices(DEFAULT_DEAL_PLANS), "Solo - $79/mo or $2 / Appoint", "Signature - $229/mo"]) {
    assert.deepEqual(getCommissionAmounts(plan), { upfront: 0, monthly: 0 });
    assert.equal(calculateCommission(plan), 0);
  }
});

test("pipeline keeps its 11 stages and adds Site Visit Booked after Left Message", () => {
  assert.equal(DEAL_STAGES.length, 12);
  const i = DEAL_STAGE_VALUES.indexOf("contacted_phone_left_message");
  assert.equal(DEAL_STAGE_VALUES[i + 1], "site_visit_booked");
  assert.equal(stageLabel("site_visit_booked"), "Site Visit Booked");
  assert.equal(new Set(DEAL_STAGE_VALUES).size, DEAL_STAGE_VALUES.length);
});

test("lead types match the spec and split by list", () => {
  assert.equal(leadTypesForList("get_seen").length, 5);
  assert.equal(leadTypesForList("ordering").length, 3);
  assert.equal(new Set(LEAD_TYPES.map(t => t.value)).size, LEAD_TYPES.length);
  assert.equal(parseLeadList("Get Seen"), "get_seen");
  assert.equal(parseLeadList("ORDERING"), "ordering");
  assert.equal(parseLeadList("salon"), null);
  assert.equal(parseLeadType("Social, no website"), "social_no_website");
  assert.equal(parseLeadType("starting_from_scratch"), "starting_from_scratch");
  assert.equal(parseLeadType("nonsense"), null);
});
