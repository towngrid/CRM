// TownGrid lists and lead types (decided Nov 22, 2026: tag every business, don't grade it).
// One editable list: add, rename or reorder here. `value` is what is saved on a contact;
// never change an existing value, only its label.

export type LeadList = "get_seen" | "ordering";

export const LEAD_LISTS: readonly { value: LeadList; label: string }[] = [
  { value: "get_seen", label: "Get Seen" },
  { value: "ordering", label: "Ordering" },
];

export interface LeadType {
  value: string;
  label: string;
  list: LeadList;
  /** One line on what it means, shown as a hint. */
  meaning: string;
}

export const LEAD_TYPES: readonly LeadType[] = [
  { value: "social_no_website", list: "get_seen", label: "Social, no website", meaning: "Has Facebook or Instagram, no website." },
  { value: "starting_from_scratch", list: "get_seen", label: "Starting from scratch", meaning: "No website and no social. Lead with the price and \"we do it all for you\"." },
  { value: "old_or_broken_website", list: "get_seen", label: "Old or broken website", meaning: "Copyright 3+ years old, doesn't load, or not phone-friendly." },
  { value: "website_no_social", list: "get_seen", label: "Website, no social", meaning: "Working site, no Facebook or Instagram." },
  { value: "already_online", list: "get_seen", label: "Already online", meaning: "Working modern site and social. Lowest priority, still listed." },
  { value: "delivery_apps_no_own_ordering", list: "ordering", label: "On delivery apps, no own ordering", meaning: "On DoorDash, Grubhub, Uber Eats or Slice; no ordering on its own site." },
  { value: "no_online_ordering", list: "ordering", label: "No online ordering anywhere", meaning: "Not on delivery apps and no ordering on its own site." },
  { value: "own_ordering_already", list: "ordering", label: "Own ordering already", meaning: "Takes orders on its own site. A Get Seen prospect instead; note the platform." },
];

export function leadListLabel(value: string | null | undefined): string {
  return LEAD_LISTS.find(l => l.value === value)?.label ?? "—";
}

export function leadTypeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return LEAD_TYPES.find(t => t.value === value)?.label ?? value;
}

export function leadTypesForList(list: string | null | undefined): LeadType[] {
  return LEAD_TYPES.filter(t => !list || t.list === list);
}

const squash = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Reads a List cell from an imported file ("Get Seen", "get_seen", "ordering"...). */
export function parseLeadList(text: string | null | undefined): LeadList | null {
  if (!text?.trim()) return null;
  const key = squash(text);
  return LEAD_LISTS.find(l => squash(l.value) === key || squash(l.label) === key)?.value ?? null;
}

/** Reads a Lead type cell from an imported file, by label or saved value. */
export function parseLeadType(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const key = squash(text);
  return LEAD_TYPES.find(t => squash(t.value) === key || squash(t.label) === key)?.value ?? null;
}
