// The pipeline stages, in order. Every screen, report and alert reads this one list.
// `value` is what is saved on a deal; never change an existing value.

export interface DealStage {
  value: string;
  label: string;
  /** Shorter wording for the daily report email. */
  shortLabel: string;
  /** Tailwind colour name used for pills and dots. */
  color: string;
}

export const DEAL_STAGES: readonly DealStage[] = [
  { value: "new_lead_unqualified",                     label: "New Lead Unqualified",                          shortLabel: "New Lead Unqualified",       color: "gray" },
  { value: "qualified_lead",                           label: "Qualified Lead",                                shortLabel: "Qualified Lead",             color: "blue" },
  { value: "contacted_emailed",                        label: "Contacted - Emailed",                           shortLabel: "Contacted — Emailed",        color: "sky" },
  { value: "contacted_phone_spoke_decision_maker",     label: "Contacted - Phone Spoke To Decision Maker",     shortLabel: "Spoke w/ Decision Maker",    color: "teal" },
  { value: "contacted_phone_spoke_non_decision_maker", label: "Contacted - Phone Spoke To Non-Decision Maker", shortLabel: "Spoke w/ Non-Decision Maker", color: "cyan" },
  { value: "contacted_phone_left_message",             label: "Contacted - Phone Left Message",                shortLabel: "Left Message",               color: "yellow" },
  { value: "site_visit_booked",                        label: "Site Visit Booked",                             shortLabel: "Site Visit Booked",          color: "lime" },
  { value: "trial_period_started",                     label: "Trial Period Started",                          shortLabel: "Trial Period Started",       color: "indigo" },
  { value: "pending_commitment",                       label: "Pending Commitment",                            shortLabel: "Pending Commitment",         color: "purple" },
  { value: "in_negotiation",                           label: "In Negotiation",                                shortLabel: "In Negotiation",             color: "orange" },
  { value: "won",                                      label: "Won",                                           shortLabel: "Won",                        color: "emerald" },
  { value: "lost",                                     label: "Lost",                                          shortLabel: "Lost",                       color: "red" },
];

export const DEAL_STAGE_VALUES: string[] = DEAL_STAGES.map(s => s.value);

// Tailwind needs full class names written out, so each colour is spelled in full here.
const PILL: Record<string, string> = {
  gray: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300",
  cyan: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  lime: "bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-300",
  indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};
const DOT: Record<string, string> = {
  gray: "bg-gray-400", blue: "bg-blue-500", sky: "bg-sky-500", teal: "bg-teal-500", cyan: "bg-cyan-500",
  yellow: "bg-yellow-500", lime: "bg-lime-500", indigo: "bg-indigo-500", purple: "bg-purple-500",
  orange: "bg-orange-500", emerald: "bg-emerald-500", red: "bg-red-500",
};

function find(value: string | null | undefined): DealStage | undefined {
  return DEAL_STAGES.find(s => s.value === value);
}

export function stageLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return find(value)?.label ?? value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function stageShortLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return find(value)?.shortLabel ?? stageLabel(value);
}

/** Background + text classes for a stage pill. */
export function stagePillClass(value: string | null | undefined): string {
  return PILL[find(value)?.color ?? "gray"];
}

/** Solid background class for a stage dot or bar. */
export function stageDotClass(value: string | null | undefined): string {
  return find(value) ? DOT[find(value)!.color] : "bg-muted";
}
