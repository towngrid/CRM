// Business Search API (Step 3a). Searches cost SerpAPI credits, so starting one is admin-only
// and needs `confirm: true` after the screen has shown the estimate.
import type { Express, RequestHandler } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as XLSX from "xlsx";
import { db } from "../db";
import { storage } from "../storage";
import { businessLeads, businessSearches, type BusinessLead } from "@shared/schema";
import {
  BUSINESS_TYPES, OTHER_BUSINESS_TYPE, AI_EMAIL_MONTHLY_CAP_USD, AI_EMAIL_TYPICAL_COST_USD, allEmails, bestEmail, businessTypeLabel,
  estimateCredits, isZip, normalizePlace, townAndZip,
} from "@shared/businessSearch";
import { leadListLabel, leadTypeLabel } from "@shared/leadTypes";
import { getSerpUsageStatus } from "../lead-discovery";
import { createDealRecord } from "../dealCreation";
import { getSerpApiKey } from "../appConfig";
import { serpAccount } from "./serp";
import { isRunning, markInterruptedSearches, resetForRecheck, runSearch } from "./runner";
import { loadScorePoints, rescoreEveryone, rescoreUser, saveScorePoints } from "./score";
import { aiKeyDiagnostics, aiKeySet, aiSpentThisMonth, findEmailFor } from "./emailFinder";
import { runPass2, savePass2 } from "./pass2";
import { DEFAULT_SCORE_POINTS, reasonsText } from "@shared/leadScore";

const searchInput = z.object({
  businessType: z.string().refine(v => v === OTHER_BUSINESS_TYPE || BUSINESS_TYPES.some(t => t.value === v), "Pick a business type"),
  businessTypeOther: z.string().max(60).optional().nullable(),
  leadList: z.enum(["get_seen", "ordering"]),
  places: z.array(z.string()).min(1, "Pick at least one town or zip code").max(200),
  pagesPerPlace: z.number().int().min(1).max(3).default(1),
});

function cleanInput(body: unknown) {
  const input = searchInput.parse(body);
  const places = Array.from(new Set(input.places.map(normalizePlace).filter((p): p is string => !!p)));
  if (places.length === 0) throw new z.ZodError([{ code: "custom", path: ["places"], message: "Pick at least one town or zip code" }]);
  if (input.businessType === OTHER_BUSINESS_TYPE && !input.businessTypeOther?.trim()) {
    throw new z.ZodError([{ code: "custom", path: ["businessTypeOther"], message: "Type the kind of business" }]);
  }
  return { ...input, places };
}

async function budget() {
  const status = await getSerpUsageStatus();
  return {
    usedThisMonth: status.usage.usedCredits,
    stopAt: status.usage.hardStopAt,
    monthlyPlan: status.usage.monthlyQuota,
    left: Math.max(0, status.usage.hardStopAt - status.usage.usedCredits),
    perHour: status.config.maxSerpCallsPerHour,
    keySet: !!getSerpApiKey(),
  };
}

/** Businesses earlier searches already found in each place (zip or town), capped at what this search returns per place. */
async function alreadyKnownIn(user: string, places: string[], pages: number): Promise<number> {
  let total = 0;
  for (const place of places) {
    const where = isZip(place)
      ? and(eq(businessLeads.userId, user), eq(businessLeads.zip, place))
      : and(eq(businessLeads.userId, user), sql`lower(${businessLeads.town}) = lower(${place})`);
    const [{ count }] = await db.select({ count: sql<number>`count(distinct coalesce(${businessLeads.googlePlaceId}, ${businessLeads.id}))::int` }).from(businessLeads).where(where);
    total += Math.min(count, pages * 20);
  }
  return total;
}

// Progress of "Find missing emails" per search (in memory; a restart just stops it, and
// running it again skips businesses that already have an email or were already looked up).
interface EmailJob { running: boolean; total: number; done: number; found: number; aiCostUsd: number; note: string | null }
const emailJobs = new Map<string, EmailJob>();
interface Pass2Job { running: boolean; total: number; done: number; lookups: number; note: string | null }
const pass2Jobs = new Map<string, Pass2Job>();

function userId(req: any): string {
  return req.user.claims.sub;
}

// ── Table rows for the screen and the export ──────────────────────────────
export function leadRow(lead: BusinessLead) {
  const f = (lead.findings ?? {}) as any;
  const noSocial = !lead.facebookUrl && !lead.instagramUrl;
  const emails = allEmails(f);
  return {
    Name: lead.name,
    Score: lead.score ?? "",
    Tier: lead.tier ?? "",
    "Why this score": lead.setAsideReason ? `Set aside: ${lead.setAsideReason}` : reasonsText((lead.scoreReasons as any[]) ?? []),
    Town: lead.town ?? "",
    Zip: lead.zip ?? "",
    Phone: lead.phone ?? "",
    Email: emails[0]?.email ?? (f.website?.contactForm === "yes" ? "No email found (has contact form)" : "No email found"),
    "Email source": emails[0] ? `${emails[0].label}${emails[0].url ? `: ${emails[0].url}` : ""}` : "",
    "Other emails": emails.slice(1).map(e => e.email).join(", "),
    List: leadListLabel(lead.leadList),
    "Lead type": leadTypeLabel(lead.leadType),
    Website: lead.websiteUrl && f.website?.googleButton !== "social" ? lead.websiteUrl : "No Website found",
    "Website check": f.website ? websiteSummary(f.website) : "",
    Facebook: lead.facebookUrl ?? (noSocial ? "No social found" : "No Facebook found"),
    Instagram: lead.instagramUrl ?? (noSocial ? "No social found" : "No Instagram found"),
    "Social match": lead.facebookUrl || lead.instagramUrl ? "Likely match: check by hand" : "",
    "Delivery apps": lead.deliveryApps ?? "",
    "Sends customers to delivery apps from own site": yesNo(lead.sendsToApps),
    "Takes orders on own site": yesNo(lead.ownOrdering) + (f.ordering?.ownOrderingPlatform ? ` (${f.ordering.ownOrderingPlatform})` : ""),
    Rating: lead.rating ?? "",
    Reviews: lead.reviewCount ?? "",
    "Still open?": lead.stillOpenFlag ? `Check: ${(f.stillOpen?.reasons ?? []).join("; ")}` : "",
    "Google AI summary": f.stillOpen?.aiSummary ?? "",
    "Google listing": lead.googleUrl ?? "",
    "Google profile checked": f.pass2?.at ? String(f.pass2.at).slice(0, 10) : "",
    "Unclaimed on Google": f.pass2 ? (f.pass2.unclaimed ? "Yes" : "No") : "",
    "Owner replies (newest 10 reviews)": f.pass2 ? `${f.pass2.ownerRepliesOfNewest10} of ${f.pass2.reviewsChecked}` : "",
    "Unanswered 1-2 star review": f.pass2 ? (f.pass2.unansweredBadReview ? "Yes" : "No") : "",
    "Newest Google review": f.pass2?.newestReviewDate ? String(f.pass2.newestReviewDate).slice(0, 10) : "",
    "Newest Google Update post": f.pass2 ? (f.pass2.newestUpdateDate ? String(f.pass2.newestUpdateDate).slice(0, 10) : "None") : "",
    "Owner photos on Google": f.pass2 ? f.pass2.ownerPhotoCount : "",
    Address: lead.address ?? "",
    Category: lead.googleCategory ?? "",
  };
}

function yesNo(v: string | null): string {
  return ({ yes: "Yes", no: "No", unknown: "Unknown", no_website: "No website" } as Record<string, string>)[v ?? ""] ?? "";
}

function websiteSummary(w: any): string {
  if (!w.url) return "No website found";
  if (w.googleButton === "social") return "Google's Website button goes to Facebook/Instagram";
  if (w.googleButton === "ordering_site") return `Website is an ordering page (${w.ownedByOrderingCompany ?? "ordering company"})`;
  const parts: string[] = [];
  parts.push(w.loads === "yes" ? "loads" : w.loads === "no" ? "doesn't load" : "couldn't check (site blocks robots)");
  if (w.copyrightYear) parts.push(`© ${w.copyrightYear}`);
  if (w.loads === "yes") parts.push(w.phoneFriendly === "yes" ? "phone-friendly" : "not phone-friendly");
  if (w.contactForm === "yes") parts.push("contact form");
  if (w.builder) parts.push(w.builder);
  if (w.ownedByOrderingCompany) parts.push(`built by ${w.ownedByOrderingCompany}`);
  if (w.source === "search") parts.push("found by web search");
  return parts.join(", ");
}

export function registerBusinessSearchRoutes(app: Express, isAuthenticated: RequestHandler, isAdmin: RequestHandler) {
  markInterruptedSearches().catch(error => console.error("[BusinessSearch] Could not mark interrupted searches:", error));
  // Scores are cheap to recalculate; doing it at start-up keeps them in step with the current rules.
  rescoreEveryone().catch(error => console.error("[BusinessSearch] Could not score leads:", error));

  app.get("/api/score-points", isAuthenticated, async (_req, res) => {
    try { res.json(await loadScorePoints()); }
    catch { res.status(500).json({ message: "Could not load the point values" }); }
  });

  // Saves point values, then re-scores every business (free: no searches).
  app.put("/api/admin/score-points", isAdmin, async (req, res) => {
    const keys = new Set(DEFAULT_SCORE_POINTS.map(p => p.key));
    const parsed = z.record(z.number().int().min(-100).max(200)).safeParse(req.body?.values);
    if (!parsed.success) return res.status(400).json({ message: "Points must be whole numbers between -100 and 200." });
    const values = Object.fromEntries(Object.entries(parsed.data).filter(([k]) => keys.has(k)));
    const current = Object.fromEntries((await loadScorePoints()).map(p => [p.key, p.points]));
    const tierA = values.tier_a ?? current.tier_a, tierB = values.tier_b ?? current.tier_b;
    if (tierB >= tierA) return res.status(400).json({ message: "Tier A must start higher than tier B." });
    try {
      await saveScorePoints(values);
      await rescoreEveryone();
      res.json(await loadScorePoints());
    } catch (error) {
      console.error("[BusinessSearch] save points failed:", error);
      res.status(500).json({ message: "Could not save the point values" });
    }
  });

  // Seann sets a business aside by hand (e.g. no in-person service, wrong industry), or brings it back.
  app.post("/api/business-search/leads/:id/set-aside", isAuthenticated, async (req: any, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : null;
    const [lead] = await db.update(businessLeads)
      .set(reason ? { setAsideByHand: true, setAsideReason: reason } : { setAsideByHand: false, setAsideReason: null })
      .where(and(eq(businessLeads.id, req.params.id), eq(businessLeads.userId, userId(req)))).returning();
    if (!lead) return res.status(404).json({ message: "Business not found" });
    await rescoreUser(userId(req));
    res.json({ ok: true });
  });

  app.get("/api/business-search/budget", isAuthenticated, async (_req, res) => {
    try {
      res.json({ budget: await budget(), serpapi: await serpAccount() });
    } catch (error) {
      res.status(500).json({ message: "Could not read the search budget" });
    }
  });

  // Free: shows the credit estimate before anything runs.
  app.post("/api/business-search/estimate", isAuthenticated, async (req, res) => {
    try {
      const input = cleanInput(req.body);
      const known = await alreadyKnownIn(userId(req), input.places, input.pagesPerPlace);
      res.json({ places: input.places, estimate: estimateCredits(input.places.length, input.pagesPerPlace, input.leadList, known), budget: await budget() });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message ?? "Check the form" });
      res.status(500).json({ message: "Could not estimate" });
    }
  });

  app.post("/api/business-search", isAdmin, async (req: any, res) => {
    try {
      if (req.body?.confirm !== true) return res.status(400).json({ message: "Confirm the credit estimate first." });
      const input = cleanInput(req.body);
      const estimate = estimateCredits(input.places.length, input.pagesPerPlace, input.leadList, await alreadyKnownIn(userId(req), input.places, input.pagesPerPlace));
      const b = await budget();
      if (!b.keySet) return res.status(400).json({ message: "SERPAPI_KEY is not set in Railway." });
      if (estimate.likely > b.left) {
        return res.status(400).json({ message: `This search likely needs about ${estimate.likely} credits but only ${b.left} are left before this month's stop.` });
      }
      const [search] = await db.insert(businessSearches).values({
        userId: userId(req), businessType: input.businessType, businessTypeOther: input.businessTypeOther?.trim() || null,
        leadList: input.leadList, places: input.places, pagesPerPlace: input.pagesPerPlace, estimate,
      }).returning();
      void runSearch(search.id);
      res.json(search);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message ?? "Check the form" });
      console.error("[BusinessSearch] start failed:", error);
      res.status(500).json({ message: "Could not start the search" });
    }
  });

  app.get("/api/business-search", isAuthenticated, async (req: any, res) => {
    const rows = await db.select().from(businessSearches).where(eq(businessSearches.userId, userId(req)))
      .orderBy(desc(businessSearches.createdAt)).limit(50);
    res.json(rows.map(r => ({ ...r, label: businessTypeLabel(r.businessType, r.businessTypeOther), running: isRunning(r.id) })));
  });

  app.get("/api/business-search/:id", isAuthenticated, async (req: any, res) => {
    const [search] = await db.select().from(businessSearches)
      .where(and(eq(businessSearches.id, req.params.id), eq(businessSearches.userId, userId(req))));
    if (!search) return res.status(404).json({ message: "Search not found" });
    const leads = await db.select().from(businessLeads).where(eq(businessLeads.searchId, search.id)).orderBy(asc(businessLeads.createdAt));
    res.json({
      search: {
        ...search, label: businessTypeLabel(search.businessType, search.businessTypeOther), running: isRunning(search.id),
        emailJob: emailJobs.get(search.id) ?? null,
        pass2Job: pass2Jobs.get(search.id) ?? null,
      },
      leads: leads.map(({ mapsResult: _raw, ...lead }) => lead),
    });
  });

  app.post("/api/business-search/:id/resume", isAdmin, async (req: any, res) => {
    const [search] = await db.select().from(businessSearches)
      .where(and(eq(businessSearches.id, req.params.id), eq(businessSearches.userId, userId(req))));
    if (!search) return res.status(404).json({ message: "Search not found" });
    if (isRunning(search.id)) return res.json({ ok: true });
    await db.update(businessSearches).set({ status: "running", errorMessage: null }).where(eq(businessSearches.id, search.id));
    void runSearch(search.id);
    res.json({ ok: true });
  });

  // Redo the checks for every business (needs confirm: the screen shows the cost first).
  app.post("/api/business-search/:id/recheck", isAdmin, async (req: any, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ message: "Confirm the cost first." });
    const [search] = await db.select().from(businessSearches)
      .where(and(eq(businessSearches.id, req.params.id), eq(businessSearches.userId, userId(req))));
    if (!search) return res.status(404).json({ message: "Search not found" });
    if (isRunning(search.id)) return res.status(409).json({ message: "This search is still running." });
    await resetForRecheck(search.id);
    void runSearch(search.id);
    res.json({ ok: true, creditsBefore: search.creditsUsed });
  });

  // Admin: which ANTHROPIC variables the CRM sees (names and value type only, never the key).
  app.get("/api/admin/ai-key-check", isAdmin, (_req, res) => {
    res.json({ aiKeySet: aiKeySet(), variables: aiKeyDiagnostics() });
  });

  // ── Find missing emails (paid steps 3–4). Free estimate first, then confirm. ──
  const findEmailsInput = z.object({
    tiers: z.array(z.enum(["A", "B", "C"])).min(1).default(["A", "B"]),
    useAi: z.boolean().default(true),
  });

  async function emailCandidates(searchId: string, user: string, tiers: string[]) {
    const leads = await db.select().from(businessLeads).where(and(eq(businessLeads.searchId, searchId), eq(businessLeads.userId, user)));
    return leads.filter(l => l.checkStatus === "checked" && !l.setAsideReason && l.tier && tiers.includes(l.tier) && !bestEmail(l.findings));
  }

  app.post("/api/business-search/:id/find-emails/estimate", isAuthenticated, async (req: any, res) => {
    const parsed = findEmailsInput.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Pick at least one tier." });
    const leads = await emailCandidates(req.params.id, userId(req), parsed.data.tiers);
    const serp = leads.filter(l => !(l.findings as any)?.emailLookup?.emailSearch).length;
    const ai = leads.filter(l => !(l.findings as any)?.emailLookup?.ai).length;
    const spent = await aiSpentThisMonth();
    res.json({
      businesses: leads.length,
      serpCreditsMax: serp,
      aiLookupsMax: parsed.data.useAi ? ai : 0,
      aiCostMaxUsd: parsed.data.useAi ? Math.round(ai * AI_EMAIL_TYPICAL_COST_USD * 100) / 100 : 0,
      aiAvailable: aiKeySet(),
      aiSpentThisMonthUsd: Math.round(spent * 100) / 100,
      aiCapUsd: AI_EMAIL_MONTHLY_CAP_USD,
      budget: await budget(),
    });
  });

  app.post("/api/business-search/:id/find-emails", isAdmin, async (req: any, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ message: "Confirm the cost first." });
    const parsed = findEmailsInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Pick at least one tier." });
    if (emailJobs.get(req.params.id)?.running) return res.status(409).json({ message: "Already finding emails for this search." });
    const leads = await emailCandidates(req.params.id, userId(req), parsed.data.tiers);
    const job: EmailJob = { running: true, total: leads.length, done: 0, found: 0, aiCostUsd: 0, note: null };
    emailJobs.set(req.params.id, job);
    void (async () => {
      for (const l of leads) {
        try {
          const r = await findEmailFor(l.id, userId(req), { useSerp: true, useAi: parsed.data.useAi });
          if (r.email) job.found++;
          job.aiCostUsd += r.aiCostUsd;
          if (/cap|not set/.test(r.how)) job.note = r.how;
        } catch (error) {
          job.note = String((error as Error)?.message ?? error).slice(0, 200);
          if (/monthly safety stop|SERPAPI_KEY/i.test(job.note)) break;
        }
        job.done++;
      }
      job.running = false;
    })();
    res.json({ ok: true, total: leads.length });
  });

  // One business ("Find email" on its row).
  app.post("/api/business-search/leads/:id/find-email", isAdmin, async (req: any, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ message: "Confirm the cost first." });
    try {
      res.json(await findEmailFor(req.params.id, userId(req), { useSerp: true, useAi: req.body?.useAi !== false }));
    } catch (error) {
      res.status(500).json({ message: String((error as Error)?.message ?? "Could not look for an email") });
    }
  });

  // ── Pass 2: Google profile check, businesses scoring at least the "pass2_from" line (40) before it ──
  async function pass2Candidates(searchId: string, user: string, all = false) {
    const line = (await loadScorePoints()).find(p => p.key === "pass2_from")?.points ?? 40;
    const leads = await db.select().from(businessLeads).where(and(eq(businessLeads.searchId, searchId), eq(businessLeads.userId, user)));
    return { line, leads: leads.filter(l => l.checkStatus === "checked" && !l.setAsideReason && (l.score ?? 0) >= line && (all || !(l.findings as any)?.pass2)) };
  }

  app.post("/api/business-search/:id/pass2/estimate", isAuthenticated, async (req: any, res) => {
    const { line, leads } = await pass2Candidates(req.params.id, userId(req));
    res.json({ line, businesses: leads.length, creditsMax: leads.length * 4, creditsLikely: leads.length * 3, budget: await budget() });
  });

  app.post("/api/business-search/:id/pass2", isAdmin, async (req: any, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ message: "Confirm the cost first." });
    if (pass2Jobs.get(req.params.id)?.running) return res.status(409).json({ message: "Already checking Google profiles for this search." });
    const { leads } = await pass2Candidates(req.params.id, userId(req));
    const b = await budget();
    if (leads.length * 3 > b.left) return res.status(400).json({ message: `This needs about ${leads.length * 3} credits but only ${b.left} are left this month.` });
    const job: Pass2Job = { running: true, total: leads.length, done: 0, lookups: 0, note: null };
    pass2Jobs.set(req.params.id, job);
    const user = userId(req);
    void (async () => {
      for (const lead of leads) {
        try {
          const result = await runPass2(lead);
          await savePass2(lead, result);
          job.lookups += result.lookups;
        } catch (error) {
          job.note = String((error as Error)?.message ?? error).slice(0, 200);
          if (/monthly safety stop|SERPAPI_KEY/i.test(job.note)) break;
        }
        job.done++;
      }
      await rescoreUser(user).catch(() => {});
      job.running = false;
    })();
    res.json({ ok: true, total: leads.length });
  });

  // One business (button in its details).
  app.post("/api/business-search/leads/:id/pass2", isAdmin, async (req: any, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ message: "Confirm the cost first." });
    const [lead] = await db.select().from(businessLeads).where(and(eq(businessLeads.id, req.params.id), eq(businessLeads.userId, userId(req))));
    if (!lead) return res.status(404).json({ message: "Business not found" });
    try {
      const result = await runPass2(lead);
      await savePass2(lead, result);
      await rescoreUser(userId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: String((error as Error)?.message ?? "Google profile check failed") });
    }
  });

  app.post("/api/business-search/:id/stop", isAdmin, async (req: any, res) => {
    await db.update(businessSearches).set({ status: "stopped", errorMessage: "Stopped by you. Press Resume to finish." })
      .where(and(eq(businessSearches.id, req.params.id), eq(businessSearches.userId, userId(req))));
    res.json({ ok: true });
  });

  app.get("/api/business-search/:id/export", isAuthenticated, async (req: any, res) => {
    const [search] = await db.select().from(businessSearches)
      .where(and(eq(businessSearches.id, req.params.id), eq(businessSearches.userId, userId(req))));
    if (!search) return res.status(404).json({ message: "Search not found" });
    const leads = await db.select().from(businessLeads).where(eq(businessLeads.searchId, search.id)).orderBy(asc(businessLeads.createdAt));
    const rows = leads.map(leadRow);
    const name = `${businessTypeLabel(search.businessType, search.businessTypeOther)} ${search.places.join(" ")}`.replace(/[^a-z0-9 ]/gi, "").trim().replace(/\s+/g, "-").slice(0, 60) || "search";
    const sheet = XLSX.utils.json_to_sheet(rows);
    if (req.query.format === "xlsx") {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Businesses");
      const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${name}.xlsx"`);
      return res.send(buffer);
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
    res.send("﻿" + XLSX.utils.sheet_to_csv(sheet));
  });

  // Seann's hand check of the social accounts (never read from code).
  const handCheck = z.object({
    handChecked: z.boolean().optional(),
    facebookFollowers: z.number().int().min(0).nullable().optional(),
    instagramFollowers: z.number().int().min(0).nullable().optional(),
    lastPostDate: z.string().max(40).nullable().optional(),
    handCheckNotes: z.string().max(2000).nullable().optional(),
    // Email step 5: typed in by Seann (e.g. read on their Facebook page). "" clears it.
    email: z.string().trim().max(200).optional(),
  });
  app.patch("/api/business-search/leads/:id", isAuthenticated, async (req: any, res) => {
    const parsed = handCheck.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Check the values" });
    const { email, ...fields } = parsed.data;
    if (email && !z.string().email().safeParse(email).success) return res.status(400).json({ message: "That email address doesn't look right." });
    const [current] = await db.select().from(businessLeads)
      .where(and(eq(businessLeads.id, req.params.id), eq(businessLeads.userId, userId(req))));
    if (!current) return res.status(404).json({ message: "Business not found" });
    const update: Partial<typeof businessLeads.$inferInsert> = { ...fields };
    if (email !== undefined) {
      const f = (current.findings ?? {}) as any;
      const lookup = { ...(f.emailLookup ?? {}) };
      if (email) lookup.hand = { email: email.toLowerCase(), at: new Date().toISOString() };
      else delete lookup.hand;
      update.findings = { ...f, emailLookup: lookup };
    }
    const [lead] = await db.update(businessLeads).set(update).where(eq(businessLeads.id, current.id)).returning();
    await rescoreUser(userId(req)); // the hand check's last-post date can add points
    res.json(lead);
  });

  // Seann approves a business: it becomes a contact and a deal at the first pipeline stage.
  app.post("/api/business-search/leads/:id/approve", isAuthenticated, async (req: any, res) => {
    try {
      const [lead] = await db.select().from(businessLeads)
        .where(and(eq(businessLeads.id, req.params.id), eq(businessLeads.userId, userId(req))));
      if (!lead) return res.status(404).json({ message: "Business not found" });
      if (lead.contactId) return res.json({ contactId: lead.contactId, dealId: lead.dealId, already: true });
      const row = leadRow(lead);
      const street = lead.address ? lead.address.split(",")[0]?.trim() : null;
      const { town, zip } = townAndZip(lead.address);
      const email: string | null = bestEmail(lead.findings)?.email ?? null;
      const notes = [
        `From Business Search (${new Date().toISOString().slice(0, 10)}).`,
        `Website: ${row["Website check"] || row.Website}`,
        email ? `Email ${email}: ${row["Email source"]}` : null,
        lead.deliveryApps ? `Delivery apps: ${lead.deliveryApps}` : null,
        row["Takes orders on own site"] ? `Takes orders on own site: ${row["Takes orders on own site"]}` : null,
        lead.score != null ? `Opportunity score: ${lead.score} (tier ${lead.tier}): ${row["Why this score"]}` : null,
        lead.rating != null ? `Google: ${lead.rating} stars, ${lead.reviewCount ?? 0} reviews` : null,
        lead.googleUrl ? `Google listing: ${lead.googleUrl}` : null,
        lead.stillOpenFlag ? `Still open? ${row["Still open?"]}` : null,
      ].filter(Boolean).join("\n");
      const contact = await storage.createContact({
        company: lead.name,
        email,
        useBusinessNameForEmail: "Yes",
        phone: lead.phone,
        phoneWork: lead.phone,
        address: street,
        city: town ?? lead.town,
        state: "NY",
        zipCode: zip ?? lead.zip,
        leadList: lead.leadList,
        leadType: lead.leadType,
        hasWebsite: row.Website === "No Website found" ? "No" : "Yes",
        websiteUrl: row.Website === "No Website found" ? null : lead.websiteUrl,
        facebookUrl: lead.facebookUrl,
        instagramHandle: lead.instagramUrl,
        leadSource: "Google Search",
        notes,
        status: "active",
      } as any, userId(req));
      const deal = await createDealRecord(db, { title: lead.name, contactId: contact.id } as any, userId(req));
      await db.update(businessLeads).set({ approvedAt: new Date(), contactId: contact.id, dealId: deal.id }).where(eq(businessLeads.id, lead.id));
      res.json({ contactId: contact.id, dealId: deal.id });
    } catch (error) {
      console.error("[BusinessSearch] approve failed:", error);
      res.status(500).json({ message: "Could not add this business to Contacts" });
    }
  });
}
