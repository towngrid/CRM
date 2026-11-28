import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardMetrics, monthLine } from "./dashboardMetrics";
import { activityText, contactDisplayName } from "./activityText";

const NOW = new Date(2026, 10, 28); // Nov 28, 2026
const deal = (stage: string, created: Date, won: Date | null = null, value = "0") => ({ stage, value, createdAt: created, wonDate: won });

test("dashboard figures are real month-by-month counts, not typed-in percentages", () => {
  const m = dashboardMetrics({
    now: NOW,
    contacts: [{}, {}, {}],
    approvedDates: [new Date(2026, 10, 27), new Date(2026, 9, 3), null],
    deals: [
      deal("new_lead_unqualified", new Date(2026, 10, 27)),
      deal("site_visit_booked", new Date(2026, 9, 15)),
      deal("won", new Date(2026, 9, 1), new Date(2026, 10, 20), "179"),
      deal("won", new Date(2026, 8, 1), new Date(2026, 9, 5), "129"),
      deal("lost", new Date(2026, 10, 2)),
    ],
    tasks: [{ status: "completed", completedAt: new Date(2026, 10, 1) }, { status: "pending", completedAt: null }],
  });
  assert.equal(m.totalContacts, 3);
  assert.deepEqual(m.contactsAdded, { thisMonth: 1, lastMonth: 1 });
  assert.equal(m.activeDeals, 2);
  assert.deepEqual(m.newDeals, { thisMonth: 2, lastMonth: 2 });
  assert.deepEqual(m.wonRevenue, { thisMonth: 179, lastMonth: 129 });
  assert.deepEqual(m.tasksCompletedByMonth, { thisMonth: 1, lastMonth: 0 });
  assert.equal(monthLine({ thisMonth: 0, lastMonth: 0 }), "None yet this month");
  assert.equal(monthLine({ thisMonth: 3, lastMonth: 1 }), "3 this month · 1 last month");
});

test("Recent Activity lines are sentences, never raw data", () => {
  const names = (id: string | null | undefined) => (id === "c1" ? "Dog Tales Pet Spa" : null);
  const evidence = JSON.stringify({ logId: "l", recipient: "dt@example.com", contactId: "c1", userId: "u", sequenceTrack: "t", sequenceNumber: 2, state: "sent", at: "x" });
  assert.equal(activityText({ type: "recipient_outreach_evidence", description: evidence }, names), "Email 2 sent to Dog Tales Pet Spa");
  assert.equal(activityText({ type: "deal_stage_changed", description: 'Deal "Plado" moved to site_visit_booked' }, names), 'Deal "Plado" moved to Site Visit Booked');
  assert.equal(activityText({ type: "contact_added", description: "New contact null null added", contactId: "c1" }, names), "New contact Dog Tales Pet Spa added");
  assert.equal(activityText({ type: "other", description: '{"a":1}', contactId: "c1" }, names), "Update for Dog Tales Pet Spa");
  assert.equal(activityText({ type: "task_created", description: 'Task "Call back" created' }, names), 'Task "Call back" created');
  assert.equal(contactDisplayName({ company: "The Metropolitan", firstName: null, lastName: null }), "The Metropolitan");
});
