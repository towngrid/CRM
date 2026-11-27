// Industry list (Snap spec Part 2): one editable list in the database, seeded from DEFAULT_INDUSTRIES.
import type { Express, RequestHandler } from "express";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { businessLeads, businessSearches, contacts, industries } from "@shared/schema";
import { DEFAULT_INDUSTRIES, industryForSearch, type IndustryRow } from "@shared/industries";

export interface IndustryRecord extends IndustryRow { id: string; active: boolean; sortOrder: number }

export async function listIndustries(includeHidden = false): Promise<IndustryRecord[]> {
  const rows = await db.select().from(industries).orderBy(asc(industries.sortOrder));
  return rows
    .map(r => ({ id: r.id, group: r.groupName, type: r.typeName, searchType: r.searchType, active: r.active === "true", sortOrder: r.sortOrder }))
    .filter(r => includeHidden || r.active);
}

export async function seedIndustries(): Promise<void> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(industries);
  if (count > 0) return;
  await db.insert(industries).values(DEFAULT_INDUSTRIES.map((r, i) => ({
    groupName: r.group, typeName: r.type, searchType: r.searchType ?? null, sortOrder: i, active: "true",
  })));
  console.log(`[Industries] Added the ${DEFAULT_INDUSTRIES.length} starting industries.`);
}

/**
 * Fills blanks only: businesses from their search type, contacts from the business they were
 * approved from. Never guesses, never overwrites what Seann set.
 */
export async function fillMissingIndustries(): Promise<void> {
  const list = await listIndustries(true);
  const blankLeads = await db.select({ id: businessLeads.id, searchType: businessSearches.businessType, other: businessSearches.businessTypeOther })
    .from(businessLeads).innerJoin(businessSearches, eq(businessLeads.searchId, businessSearches.id))
    .where(isNull(businessLeads.industryGroup));
  for (const l of blankLeads) {
    const ind = industryForSearch(list, l.searchType, l.other);
    if (ind) await db.update(businessLeads).set({ industryGroup: ind.group, industryType: ind.type }).where(eq(businessLeads.id, l.id));
  }
  const blankContacts = await db.select({ contactId: contacts.id, group: businessLeads.industryGroup, type: businessLeads.industryType })
    .from(contacts).innerJoin(businessLeads, eq(businessLeads.contactId, contacts.id))
    .where(and(isNull(contacts.industryGroup), sql`${businessLeads.industryGroup} is not null`));
  for (const c of blankContacts) {
    await db.update(contacts).set({ industryGroup: c.group, industryType: c.type }).where(eq(contacts.id, c.contactId));
  }
}

const industryInput = z.object({
  group: z.string().trim().min(1, "Every industry needs a group").max(60),
  type: z.string().trim().min(1, "Every industry needs a type").max(60),
  searchType: z.string().max(40).nullable().optional(),
  active: z.boolean().default(true),
});

export function registerIndustryRoutes(app: Express, isAuthenticated: RequestHandler, isAdmin: RequestHandler) {
  seedIndustries()
    .then(fillMissingIndustries)
    .catch(error => console.error("[Industries] seed/fill failed:", error));

  app.get("/api/industries", isAuthenticated, async (req, res) => {
    try { res.json(await listIndustries(req.query.all === "1")); }
    catch { res.status(500).json({ message: "Could not load industries" }); }
  });

  // Replaces the whole list in the order given (admin, Settings).
  app.put("/api/admin/industries", isAdmin, async (req, res) => {
    const parsed = z.array(industryInput).min(1).max(300).safeParse(req.body?.industries);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Check the list" });
    const seen = new Set<string>();
    for (const r of parsed.data) {
      const key = `${r.group.toLowerCase()}|${r.type.toLowerCase()}`;
      if (seen.has(key)) return res.status(400).json({ message: `"${r.group} › ${r.type}" is listed twice.` });
      seen.add(key);
    }
    try {
      await db.transaction(async tx => {
        await tx.delete(industries);
        await tx.insert(industries).values(parsed.data.map((r, i) => ({
          groupName: r.group, typeName: r.type, searchType: r.searchType || null, sortOrder: i, active: r.active ? "true" : "false",
        })));
      });
      res.json(await listIndustries(true));
    } catch (error) {
      console.error("[Industries] save failed:", error);
      res.status(500).json({ message: "Could not save the industries" });
    }
  });
}
