// Dashboard figures from real data (Step 5): this month compared with last month.
// Replaces ESyCRM's typed-in "+12% from last month" numbers.

export interface MonthPair { thisMonth: number; lastMonth: number }

export interface DashboardMetrics {
  totalContacts: number;
  /** Businesses approved from Business Search into Contacts. Contacts have no "created" date. */
  contactsAdded: MonthPair;
  activeDeals: number;
  newDeals: MonthPair;
  /** Value of deals won, by the month they were won. */
  wonRevenue: MonthPair;
  wonDeals: MonthPair;
  tasksCompleted: number;
  tasksCompletedByMonth: MonthPair;
}

interface DealLike { stage: string; value: string | null; createdAt: Date | string | null; wonDate: Date | string | null }
interface TaskLike { status: string; completedAt: Date | string | null }

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export function dashboardMetrics(input: {
  contacts: unknown[];
  deals: DealLike[];
  tasks: TaskLike[];
  approvedDates: (Date | string | null)[];
  now?: Date;
}): DashboardMetrics {
  const now = input.now ?? new Date();
  const thisKey = monthKey(now);
  const lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const pair = <T>(items: T[], date: (t: T) => Date | string | null, amount: (t: T) => number = () => 1): MonthPair => {
    const out = { thisMonth: 0, lastMonth: 0 };
    for (const item of items) {
      const raw = date(item);
      if (!raw) continue;
      const k = monthKey(new Date(raw));
      if (k === thisKey) out.thisMonth += amount(item);
      else if (k === lastKey) out.lastMonth += amount(item);
    }
    return out;
  };
  const won = input.deals.filter(d => d.stage === "won");
  const value = (d: DealLike) => Number.parseFloat(d.value || "0") || 0;
  return {
    totalContacts: input.contacts.length,
    contactsAdded: pair(input.approvedDates, d => d),
    activeDeals: input.deals.filter(d => !["won", "lost"].includes(d.stage)).length,
    newDeals: pair(input.deals, d => d.createdAt),
    wonRevenue: pair(won, d => d.wonDate, value),
    wonDeals: pair(won, d => d.wonDate),
    tasksCompleted: input.tasks.filter(t => t.status === "completed").length,
    tasksCompletedByMonth: pair(input.tasks.filter(t => t.status === "completed"), t => t.completedAt),
  };
}

/** "3 this month · 1 last month", or "None yet this month". */
export function monthLine(p: MonthPair, format: (n: number) => string = n => String(n)): string {
  if (!p.thisMonth && !p.lastMonth) return "None yet this month";
  return `${format(p.thisMonth)} this month · ${format(p.lastMonth)} last month`;
}
