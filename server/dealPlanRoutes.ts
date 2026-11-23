// Plans & prices: one editable list in the database, seeded from DEFAULT_DEAL_PLANS.
import type { Express, RequestHandler } from "express";
import { asc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { dealPlans } from "@shared/schema";
import { DEFAULT_DEAL_PLANS, type DealPlanInput, type DealPlanRecord } from "@shared/dealPlans";

type Row = typeof dealPlans.$inferSelect;

function toRecord(row: Row): DealPlanRecord {
  return {
    id: row.id,
    name: row.name,
    price: row.price == null ? null : Number(row.price),
    billing: row.billing as DealPlanRecord["billing"],
    kind: row.kind as DealPlanRecord["kind"],
    note: row.note,
    active: row.active === "true",
    sortOrder: row.sortOrder,
  };
}

function toRow(plan: DealPlanInput, sortOrder: number) {
  return {
    name: plan.name.trim(),
    price: plan.price == null || plan.billing === "none" ? null : plan.price.toFixed(2),
    billing: plan.billing,
    kind: plan.kind,
    note: plan.note?.trim() || null,
    active: plan.active ? "true" : "false",
    sortOrder,
  };
}

export async function seedDealPlans(): Promise<void> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(dealPlans);
  if (count > 0) return;
  await db.insert(dealPlans).values(DEFAULT_DEAL_PLANS.map((p, i) => toRow(p, i)));
  console.log(`[Plans] Added the ${DEFAULT_DEAL_PLANS.length} starting TownGrid plans.`);
}

export async function listDealPlans(): Promise<DealPlanRecord[]> {
  const rows = await db.select().from(dealPlans).orderBy(asc(dealPlans.sortOrder));
  return rows.map(toRecord);
}

export const dealPlanListSchema = z.array(z.object({
  name: z.string().trim().min(1, "Every plan needs a name").max(80),
  price: z.number().nonnegative().max(100000).nullable(),
  billing: z.enum(["monthly", "one_time", "none"]),
  kind: z.enum(["plan", "add_on"]),
  note: z.string().max(200).nullable().optional(),
  active: z.boolean(),
})).min(1, "Keep at least one plan").max(100);

export function registerDealPlanRoutes(app: Express, isAuthenticated: RequestHandler, isAdmin: RequestHandler) {
  app.get("/api/deal-plans", isAuthenticated, async (_req, res) => {
    try {
      res.json(await listDealPlans());
    } catch (error) {
      console.error("[Plans] list error:", error);
      res.status(500).json({ message: "Could not load plans" });
    }
  });

  // Replaces the whole list in the order given.
  app.put("/api/admin/deal-plans", isAdmin, async (req, res) => {
    const parsed = dealPlanListSchema.safeParse(req.body?.plans);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid plan list" });
    }
    try {
      await db.transaction(async (tx) => {
        await tx.delete(dealPlans);
        await tx.insert(dealPlans).values(parsed.data.map((p, i) => toRow(p, i)));
      });
      res.json(await listDealPlans());
    } catch (error) {
      console.error("[Plans] save error:", error);
      res.status(500).json({ message: "Could not save plans" });
    }
  });
}
