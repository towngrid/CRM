// Industry (Snap spec Part 2, Step 4): one editable list of groups and types, kept in Settings
// next to Plans & prices (table `industries`). These are only the starting values for an empty table.
// Every business stores both the group ("Home services") and the type ("Landscapers").

export interface IndustryRow {
  group: string;
  type: string;
  /** The Business Search type this industry type matches (shared/businessSearch.ts BUSINESS_TYPES). */
  searchType?: string | null;
}

export const OTHER_GROUP = "Other";

export const DEFAULT_INDUSTRIES: readonly IndustryRow[] = [
  { group: "Pet care", type: "Pet groomers", searchType: "pet_groomers" },
  { group: "Pet care", type: "Dog walkers", searchType: "dog_walkers" },
  { group: "Pet care", type: "Pet sitters", searchType: "pet_sitters" },
  { group: "Pet care", type: "Boarding / daycare" },
  { group: "Food", type: "Pizzerias", searchType: "pizzerias" },
  { group: "Food", type: "Restaurants", searchType: "restaurants" },
  { group: "Food", type: "Food trucks", searchType: "food_trucks" },
  { group: "Food", type: "Bakeries / cafés" },
  { group: "Food", type: "Delis" },
  { group: "Home services", type: "Landscapers", searchType: "landscapers" },
  { group: "Home services", type: "Cleaners", searchType: "cleaners" },
  { group: "Home services", type: "Handymen", searchType: "handymen" },
  { group: "Home services", type: "Plumbers" },
  { group: "Home services", type: "Electricians" },
  { group: "Home services", type: "HVAC" },
  { group: "Home services", type: "Painters" },
  { group: "Home services", type: "Roofers" },
  { group: "Home services", type: "Pest control" },
  { group: "Home services", type: "Pool services" },
  { group: "Auto", type: "Mobile detailers", searchType: "mobile_detailers" },
  { group: "Auto", type: "Auto repair" },
  { group: "Auto", type: "Body shops" },
  { group: "Auto", type: "Towing" },
  { group: "Beauty", type: "Hair salons" },
  { group: "Beauty", type: "Barbers" },
  { group: "Beauty", type: "Nail salons" },
  { group: "Beauty", type: "Spas" },
  { group: "Health and fitness", type: "Gyms" },
  { group: "Health and fitness", type: "Trainers" },
  { group: "Health and fitness", type: "Chiropractors" },
  { group: "Health and fitness", type: "Dentists" },
  { group: "Retail", type: "Shops and boutiques" },
  { group: "Professional services", type: "Accountants" },
  { group: "Professional services", type: "Insurance" },
  { group: "Professional services", type: "Real estate" },
  { group: "Professional services", type: "Lawyers" },
  { group: OTHER_GROUP, type: "Other" },
];

/** Groups in list order. */
export function industryGroups(rows: readonly IndustryRow[]): string[] {
  return Array.from(new Set(rows.map(r => r.group)));
}

/**
 * The industry a Business Search fills in: the type it searched for. "Other (type it)" searches
 * become group "Other" with the words Seann typed. Unknown types stay blank (never guessed).
 */
export function industryForSearch(rows: readonly IndustryRow[], searchType: string, otherText?: string | null): { group: string; type: string } | null {
  if (searchType === "other") {
    const t = otherText?.trim();
    return t ? { group: OTHER_GROUP, type: t } : null;
  }
  const row = rows.find(r => r.searchType === searchType);
  return row ? { group: row.group, type: row.type } : null;
}

export function industryLabel(group: string | null | undefined, type: string | null | undefined): string {
  if (!group && !type) return "—";
  if (group && type && group !== type) return `${group} › ${type}`;
  return (type || group)!;
}
