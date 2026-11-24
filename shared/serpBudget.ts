export const APPROVED_SERP_BUDGET = { monthlyQuota: 1000, hardStopAt: 800 } as const;

export type SharedProviderBudget = {
  monthYear: string;
  monthlyQuota: number;
  hardStopAt: number;
  used: number;
  remaining: number;
};

export function serpMonthYear(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** A new calendar month inherits the last saved budget, never a provider counter. */
export function savedSerpBudget(previous?: { monthlyQuota: number; hardStopAt: number }) {
  const budget = previous ?? { monthlyQuota: 1000, hardStopAt: 900 }; // TownGrid SerpAPI Starter plan (Nov 23)
  if (!Number.isSafeInteger(budget.monthlyQuota) || budget.monthlyQuota < 1 ||
      !Number.isSafeInteger(budget.hardStopAt) || budget.hardStopAt < 1 ||
      budget.hardStopAt > budget.monthlyQuota) {
    throw new Error("Invalid saved shared provider budget. An administrator must review it.");
  }
  return { monthlyQuota: budget.monthlyQuota, hardStopAt: budget.hardStopAt };
}

export function sharedSerpStopMessage(used: number, hardStopAt: number) {
  return `Shared app monthly safety stop reached (${used} / ${hardStopAt} counted attempts). SerpAPI may still have credits. An administrator must review the app's shared budget before resuming; prior spending remains counted.`;
}
