// Step 4: research fields on a contact (docs/PRE-VISIT-RESEARCH.md) and the data behind the
// printable Pre-visit brief. Reads what Business Search already found; costs nothing.
import type { Express, RequestHandler } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { businessLeads } from "@shared/schema";
import { EMPTY_RESEARCH, readResearch, researchFromLead, type Research } from "@shared/research";
import { allEmails } from "@shared/businessSearch";

function scope(req: any): string | null {
  // Admins see every contact; salespeople only their own (same rule as the rest of the CRM).
  return req.user?.role === "admin" ? null : req.user?.claims?.sub;
}

async function leadForContact(contactId: string) {
  const [lead] = await db.select().from(businessLeads).where(eq(businessLeads.contactId, contactId)).orderBy(desc(businessLeads.createdAt)).limit(1);
  return lead ?? null;
}

/** Fills only the research fields that are still empty; what Seann typed is never overwritten. */
export function mergeEmpty(current: Research, filled: Research): Research {
  const out: Research = { ...current };
  for (const key of Object.keys(EMPTY_RESEARCH) as (keyof Research)[]) {
    const now = current[key];
    const isEmpty = now === "" || now === false || now == null || (key === "ownerStatus" && now === "Not confirmed" && !current.ownerFirstName);
    if (isEmpty && filled[key] !== undefined) (out as any)[key] = filled[key];
  }
  out.filledFromSearchAt = filled.filledFromSearchAt;
  return out;
}

export function registerResearchRoutes(app: Express, isAuthenticated: RequestHandler) {
  // Everything the Pre-visit brief and the Research tab show, in one call.
  app.get("/api/contacts/:id/brief", isAuthenticated, async (req: any, res) => {
    const contact = await storage.getContact(req.params.id, scope(req));
    if (!contact) return res.status(404).json({ message: "Contact not found" });
    const lead = await leadForContact(contact.id);
    const { mapsResult: _raw, ...leadOut } = lead ?? ({} as any);
    res.json({
      contact,
      research: readResearch(contact.research),
      lead: lead ? leadOut : null,
      emails: lead ? allEmails(lead.findings) : [],
    });
  });

  // "Fill from Business Search": empty fields only.
  app.post("/api/contacts/:id/research/fill", isAuthenticated, async (req: any, res) => {
    const contact = await storage.getContact(req.params.id, scope(req));
    if (!contact) return res.status(404).json({ message: "Contact not found" });
    const lead = await leadForContact(contact.id);
    if (!lead) return res.status(400).json({ message: "This contact didn't come from Business Search, so there is nothing to fill in." });
    const research = mergeEmpty(readResearch(contact.research), researchFromLead(lead));
    const updated = await storage.updateContact(contact.id, { research } as any, scope(req));
    res.json({ research: readResearch(updated?.research) });
  });
}
