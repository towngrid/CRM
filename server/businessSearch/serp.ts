// SerpAPI calls for Business Search. Every billable call goes through the shared monthly
// budget (reserveSerpCall: hard stop + hourly limit) and is counted on the search row.
// Answers are cached 30 days in serp_cache, so re-running a search costs nothing.
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { businessSearches } from "@shared/schema";
import { serpMonthYear, sharedSerpStopMessage } from "@shared/serpBudget";
import { getSerpApiKey } from "../appConfig";
import { getSerpUsageStatus } from "../lead-discovery";

const CACHE_TAG = "business_search";
const CACHE_DAYS = 30;
const TIMEOUT_MS = 30_000;

export class SerpBudgetStop extends Error {
  constructor(message: string, readonly hourly: boolean) {
    super(message);
    this.name = "SerpBudgetStop";
  }
}

export type SerpParams = Record<string, string>;

function cacheKey(params: SerpParams): string {
  return Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
}

/**
 * One SerpAPI request (any engine). `searchId` gets +1 credit when a billable call is made,
 * or +1 cached call when the answer came from the cache.
 */
export async function serpRequest(searchId: string, params: SerpParams): Promise<any> {
  const key = cacheKey(params);
  const cached = await storage.getSerpCache(CACHE_TAG, key, "", CACHE_DAYS);
  if (cached) {
    await db.update(businessSearches).set({ cachedCalls: sql`${businessSearches.cachedCalls} + 1` })
      .where(eq(businessSearches.id, searchId));
    return cached.resultsJson;
  }

  const apiKey = getSerpApiKey();
  if (!apiKey) throw new Error("SERPAPI_KEY is not set in Railway.");

  const status = await getSerpUsageStatus();
  if (status.isQuotaReached) {
    throw new SerpBudgetStop(sharedSerpStopMessage(status.usage.usedCredits, status.usage.hardStopAt), false);
  }
  const perHour = status.config.maxSerpCallsPerHour || 100;
  const monthYear = serpMonthYear();
  const reservationId = await storage.reserveSerpCall(monthYear, perHour);
  if (!reservationId) {
    const again = await getSerpUsageStatus();
    if (again.isQuotaReached) {
      throw new SerpBudgetStop(sharedSerpStopMessage(again.usage.usedCredits, again.usage.hardStopAt), false);
    }
    throw new SerpBudgetStop(`Hourly limit reached (${perHour} searches an hour).`, true);
  }

  // From here the call counts, even if the network fails (SerpAPI may still bill it).
  await db.update(businessSearches).set({ creditsUsed: sql`${businessSearches.creditsUsed} + 1` })
    .where(eq(businessSearches.id, searchId));
  const url = `https://serpapi.com/search.json?${new URLSearchParams({ ...params, api_key: apiKey })}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`SerpAPI answered HTTP ${response.status} with no JSON.`); }
  if (!response.ok || data?.error) {
    // "Google hasn't returned any results" is a normal empty answer, not a failure.
    if (typeof data?.error === "string" && /hasn't returned any results/i.test(data.error)) {
      await storage.createSerpCache(CACHE_TAG, key, "", data);
      return data;
    }
    throw new Error(`SerpAPI: ${typeof data?.error === "string" ? data.error : `HTTP ${response.status}`}`);
  }
  try {
    await storage.createSerpCache(CACHE_TAG, key, "", data);
  } catch (error) {
    console.error("[BusinessSearch] Cache save failed; the call stays counted:", error);
  }
  return data;
}

/** SerpAPI's own count of searches left this month (its account endpoint is free). */
export async function serpAccount(): Promise<{ plan: string | null; searchesLeft: number | null; perMonth: number | null; thisMonthUsage: number | null } | null> {
  const apiKey = getSerpApiKey();
  if (!apiKey) return null;
  try {
    const r = await fetch(`https://serpapi.com/account.json?${new URLSearchParams({ api_key: apiKey })}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const a = await r.json() as any;
    return {
      plan: a.plan_name ?? null,
      searchesLeft: typeof a.total_searches_left === "number" ? a.total_searches_left : (typeof a.plan_searches_left === "number" ? a.plan_searches_left : null),
      perMonth: typeof a.searches_per_month === "number" ? a.searches_per_month : null,
      thisMonthUsage: typeof a.this_month_usage === "number" ? a.this_month_usage : null,
    };
  } catch {
    return null;
  }
}
