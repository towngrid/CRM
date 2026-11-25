// Calculates and saves the Opportunity score (shared/leadScore.ts) for business leads.
// Free: it only reads what Pass 1 (and later Pass 2) already saved. Re-run after a search
// finishes, after Seann's hand check or set-aside, and after point values change.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { businessLeads, scorePoints } from "@shared/schema";
import { chainKey, chainNames, mergeScorePoints, scoreLead, type ScorePoint } from "@shared/leadScore";

export async function loadScorePoints(): Promise<ScorePoint[]> {
  const rows = await db.select().from(scorePoints);
  return mergeScorePoints(Object.fromEntries(rows.map(r => [r.key, r.points])));
}

export async function saveScorePoints(values: Record<string, number>): Promise<void> {
  await db.transaction(async tx => {
    for (const [key, points] of Object.entries(values)) {
      await tx.insert(scorePoints).values({ key, points, updatedAt: new Date() })
        .onConflictDoUpdate({ target: scorePoints.key, set: { points, updatedAt: new Date() } });
    }
  });
}

/** Re-scores every checked business of one user (chain detection looks across all their searches). */
export async function rescoreUser(userId: string): Promise<number> {
  const points = await loadScorePoints();
  const leads = await db.select().from(businessLeads).where(eq(businessLeads.userId, userId));
  const chains = chainNames(leads);

  // Average review count of the top 3 businesses in each search.
  const top3 = new Map<string, number>();
  const bySearch = new Map<string, number[]>();
  for (const l of leads) {
    const list = bySearch.get(l.searchId) ?? [];
    list.push(l.reviewCount ?? 0);
    bySearch.set(l.searchId, list);
  }
  bySearch.forEach((counts, searchId) => {
    const best = counts.sort((a, b) => b - a).slice(0, 3);
    if (best.length) top3.set(searchId, best.reduce((s, n) => s + n, 0) / best.length);
  });

  let updated = 0;
  for (const l of leads) {
    if (l.checkStatus !== "checked") continue;
    const sameName = chains.get(chainKey(l.name, l.town));
    const result = scoreLead({
      leadList: l.leadList,
      rating: l.rating,
      reviewCount: l.reviewCount,
      googleStatus: l.googleStatus,
      findings: l.findings,
      lastPostDate: l.lastPostDate,
      top3AverageReviews: top3.get(l.searchId) ?? null,
      chainReason: sameName ? `same name at ${sameName} addresses (chain or group)` : null,
      manualSetAside: l.setAsideByHand ? (l.setAsideReason || "set aside by you") : null,
    }, points);
    await db.update(businessLeads).set({
      score: result.score,
      tier: result.tier,
      scoreReasons: result.reasons,
      setAsideReason: result.setAsideReason,
    }).where(eq(businessLeads.id, l.id));
    updated++;
  }
  return updated;
}

/** Everyone's leads (used once after a deploy so existing searches get scores). */
export async function rescoreEveryone(): Promise<void> {
  const users = await db.selectDistinct({ userId: businessLeads.userId }).from(businessLeads);
  for (const u of users) await rescoreUser(u.userId);
}
