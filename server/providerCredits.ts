import { getSerpApiKey } from "./appConfig";
import type { ProviderCredits } from "@shared/providerCredits";

/** Account metadata is not a search. Cache failures too, and coalesce concurrent checks. */
export function createProviderCreditsReader(
  fetcher: typeof fetch = fetch,
  apiKey: () => string | undefined = () => getSerpApiKey(),
  now: () => number = Date.now,
) {
  let cached: ProviderCredits | undefined;
  let expiresAt = 0;
  let pending: Promise<ProviderCredits> | undefined;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

  async function read(): Promise<ProviderCredits> {
    const unavailable: ProviderCredits = {
      status: "unavailable", remaining: null, monthlyLimit: null, usedThisMonth: null,
      checkedAt: new Date(now()).toISOString(),
    };
    const key = apiKey();
    if (!key) return unavailable;
    try {
      const response = await fetcher(`https://serpapi.com/account.json?${new URLSearchParams({ api_key: key })}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return unavailable;
      const data = await response.json();
      const remaining = count(data?.total_searches_left);
      if (data?.error || remaining === null) return unavailable;
      return {
        status: "available", remaining,
        monthlyLimit: count(data.searches_per_month),
        usedThisMonth: count(data.this_month_usage),
        checkedAt: new Date(now()).toISOString(),
      };
    } catch {
      // Do not log fetch errors: their URL may contain the account credential.
      return unavailable;
    }
  }

  return async function getCredits(): Promise<ProviderCredits> {
    if (cached && now() < expiresAt) return cached;
    if (!pending) {
      pending = read().then(result => {
        cached = result;
        expiresAt = now() + 60000;
        return result;
      }).finally(() => { pending = undefined; });
    }
    return pending;
  };
}

export const getProviderCredits = createProviderCreditsReader();
