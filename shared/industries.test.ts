import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_INDUSTRIES, industryForSearch, industryGroups, industryLabel } from "./industries";
import { BUSINESS_TYPES } from "./businessSearch";

test("every Business Search type has an industry", () => {
  for (const t of BUSINESS_TYPES) assert.ok(industryForSearch(DEFAULT_INDUSTRIES, t.value), t.value);
  assert.deepEqual(industryForSearch(DEFAULT_INDUSTRIES, "restaurants"), { group: "Food", type: "Restaurants" });
  assert.deepEqual(industryForSearch(DEFAULT_INDUSTRIES, "other", "bakeries"), { group: "Other", type: "bakeries" });
  assert.equal(industryForSearch(DEFAULT_INDUSTRIES, "other", ""), null, "nothing typed: left blank, never guessed");
});

test("groups and labels", () => {
  assert.deepEqual(industryGroups(DEFAULT_INDUSTRIES).slice(0, 3), ["Pet care", "Food", "Home services"]);
  assert.equal(industryLabel("Home services", "Landscapers"), "Home services › Landscapers");
  assert.equal(industryLabel(null, null), "—");
});
