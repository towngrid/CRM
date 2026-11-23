// TownGrid plans. The live list is stored in the database (table deal_plans) and an
// admin edits it under Settings → Plans & prices, so prices can change without code.
// DEFAULT_DEAL_PLANS only fills an empty table on first start.
//
// A deal saves the plan's label as text (e.g. "Get Seen - $129/mo"). Changing a price
// later does not rewrite older deals: they keep the label they were sold with.

export type PlanBilling = "monthly" | "one_time" | "none";
export type PlanKind = "plan" | "add_on";

export interface DealPlanInput {
  name: string;
  price: number | null;
  billing: PlanBilling;
  kind: PlanKind;
  note?: string | null;
  active: boolean;
}

export interface DealPlanRecord extends DealPlanInput {
  id: string;
  sortOrder: number;
}

export const DEFAULT_DEAL_PLANS: DealPlanInput[] = [
  { name: "Get Seen", price: 129, billing: "monthly", kind: "plan", active: true },
  { name: "Get Seen Plus", price: 179, billing: "monthly", kind: "plan", note: "Price to confirm", active: true },
  { name: "Delivery Listing", price: 39, billing: "monthly", kind: "plan", active: true },
  { name: "Restaurant Ordering", price: 79, billing: "monthly", kind: "plan", active: true },
  { name: "Restaurant Ordering", price: 129, billing: "monthly", kind: "plan", active: true },
  { name: "Founding Partner", price: 49, billing: "monthly", kind: "plan", active: true },
  { name: "Logo", price: 49, billing: "one_time", kind: "add_on", active: true },
  { name: "Customer Emails", price: 29, billing: "monthly", kind: "add_on", active: true },
  { name: "Unknown", price: null, billing: "none", kind: "plan", active: true },
];

function money(price: number): string {
  return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}

/** The text saved on a deal and shown in every plan picker. */
export function planLabel(plan: Pick<DealPlanInput, "name" | "price" | "billing" | "kind">): string {
  const name = plan.kind === "add_on" ? `${plan.name} (add-on)` : plan.name;
  if (plan.price == null || plan.billing === "none") return name;
  return `${name} - ${money(plan.price)}${plan.billing === "monthly" ? "/mo" : " one-time"}`;
}

/** Labels for a picker: active plans first, then add-ons; keeps a deal's current label even if retired. */
export function planChoices(plans: DealPlanInput[], current?: string | null): string[] {
  const active = plans.filter(p => p.active);
  const labels = [
    ...active.filter(p => p.kind === "plan").map(planLabel),
    ...active.filter(p => p.kind === "add_on").map(planLabel),
  ];
  const unique = Array.from(new Set(labels));
  if (current && !unique.includes(current)) unique.unshift(current);
  return unique;
}

/** The price behind a label, for filling in a deal's value. Null when unknown. */
export function planPriceForLabel(plans: DealPlanInput[], label: string): number | null {
  const match = plans.find(p => planLabel(p) === label);
  return match?.price ?? null;
}
