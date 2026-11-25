// Paid email steps (Seann, Nov 24: "any and all legal ways, cheapest first, stop when found").
// Steps 1–2 (their website, search results we already have) are free and run in Pass 1.
// Step 3: one Google search "name town email" (1 SerpAPI credit), search results only.
// Step 4: Claude with web search only (no page fetching), kept only when a cited source shows
//         the email, so nothing is guessed. Capped by AI_EMAIL_MONTHLY_CAP_USD.
// Facebook, Instagram, Yelp, BBB and delivery-app pages are never opened from code.
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { businessLeads, type BusinessLead } from "@shared/schema";
import {
  AI_EMAIL_MONTHLY_CAP_USD, AI_EMAIL_TYPICAL_COST_USD, bestEmail, resultMatchesBusiness,
  type EmailLookup, type SearchEmail,
} from "@shared/businessSearch";
import { serpRequest } from "./serp";
import { emailsInPlainText } from "./website";

export const AI_EMAIL_MODEL = "claude-opus-5-5";
// List prices per million tokens (input, output) for the model that answered; web search is $10 per 1,000.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20], "claude-opus-5": [5, 25], "claude-opus-4-8": [5, 25],
  "claude-sonnet-5-5": [2, 10], "claude-sonnet-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5],
};
const WEB_SEARCH_USD = 0.01;

export function aiKeySet(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

function monthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Dollars spent on AI email lookups this calendar month (all users). */
export async function aiSpentThisMonth(): Promise<number> {
  const [row] = await db.select({
    total: sql<string>`coalesce(sum((${businessLeads.findings}->'emailLookup'->'ai'->>'costUsd')::numeric), 0)`,
  }).from(businessLeads)
    .where(sql`${businessLeads.findings}->'emailLookup'->'ai'->>'at' >= ${monthStart()}`);
  return Number(row?.total ?? 0);
}

function lookupOf(lead: BusinessLead): EmailLookup {
  return (((lead.findings ?? {}) as any).emailLookup ?? {}) as EmailLookup;
}

async function saveLookup(lead: BusinessLead, lookup: EmailLookup): Promise<BusinessLead> {
  const findings = { ...((lead.findings ?? {}) as any), emailLookup: lookup };
  const [saved] = await db.update(businessLeads).set({ findings }).where(eq(businessLeads.id, lead.id)).returning();
  return saved;
}

// ── Step 3: one Google search ────────────────────────────────────────────────
async function emailSearchStep(lead: BusinessLead): Promise<SearchEmail[]> {
  const where = lead.town ? `${lead.town} NY` : (lead.zip ?? "");
  const data = await serpRequest(lead.searchId, { engine: "google", q: `"${lead.name}" ${where} email`, num: "10", hl: "en", gl: "us" });
  const who = { name: lead.name, town: lead.town, phone: lead.phone };
  const found: SearchEmail[] = [];
  for (const r of (data?.organic_results ?? []) as any[]) {
    const result = { title: r.title ?? "", snippet: r.snippet ?? "", link: r.link ?? "" };
    if (!result.link || !resultMatchesBusiness(result, who)) continue;
    for (const email of emailsInPlainText(`${result.title} ${result.snippet}`)) {
      if (!found.some(e => e.email === email)) found.push({ email, url: result.link, title: result.title });
    }
  }
  return found;
}

// ── Step 4: AI web search ────────────────────────────────────────────────────
type AiResult = NonNullable<EmailLookup["ai"]>;

/**
 * The AI's answer is kept only when a search result it cites shows that exact address,
 * so a made-up or guessed email is never saved. Anything else is listed as rejected.
 */
export function keepCitedEmails(text: string, quotes: { url: string; quote: string }[]): { emails: AiResult["emails"]; rejected: string[] } {
  const answer = text.match(/EMAIL:\s*(\S+)/i)?.[1] ?? "";
  const candidates = /^none\.?$/i.test(answer) ? [] : emailsInPlainText(`${answer} ${text}`);
  const emails: AiResult["emails"] = [];
  const rejected: string[] = [];
  for (const email of candidates) {
    const source = quotes.find(q => q.quote.toLowerCase().includes(email));
    if (source) emails.push({ email, url: source.url, quote: source.quote.slice(0, 300) });
    else rejected.push(email);
  }
  return { emails, rejected };
}

async function aiStep(lead: BusinessLead): Promise<AiResult> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY (Railway shared variable)
  const facts = [
    `Business name: ${lead.name}`,
    lead.address ? `Address: ${lead.address}` : null,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.websiteUrl ? `Website: ${lead.websiteUrl}` : null,
    lead.googleCategory ? `Type: ${lead.googleCategory}` : null,
  ].filter(Boolean).join("\n");
  const prompt = `Find the public contact email address of this local business.

${facts}

Use web search. Only give an email address that you actually see written in a search result about this exact business (same name, and the same town, address or phone). Never guess or build an address (for example "info@" plus their web address), and never give the email of a different business, a directory or a website company.

Answer with exactly one line:
EMAIL: the.address@example.com
or, if no search result shows one:
EMAIL: NONE`;

  const response = await client.beta.messages.create({
    model: AI_EMAIL_MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    tools: [{
      type: "web_search_20260209", name: "web_search", max_uses: 3,
      user_location: { type: "approximate", city: lead.town ?? undefined, region: "New York", country: "US" },
    }],
    messages: [{ role: "user", content: prompt }],
  });

  // What the model said, and the exact text each cited source showed.
  let text = "";
  const quotes: { url: string; quote: string }[] = [];
  for (const block of response.content as any[]) {
    if (block.type !== "text") continue;
    text += block.text;
    for (const c of block.citations ?? []) {
      if (typeof c.cited_text === "string") quotes.push({ url: c.url ?? "", quote: c.cited_text });
    }
  }
  const { emails, rejected } = keepCitedEmails(text, quotes);

  const usage: any = response.usage ?? {};
  const [inPrice, outPrice] = PRICES[response.model] ?? [5, 25];
  const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const costUsd = Math.round(((inputTokens * inPrice + (usage.output_tokens ?? 0) * outPrice) / 1_000_000 + searches * WEB_SEARCH_USD) * 10000) / 10000;
  return { at: new Date().toISOString(), model: response.model, emails, rejected, costUsd };
}

// ── The waterfall for one business ───────────────────────────────────────────
export interface FindEmailResult {
  email: string | null;
  how: string;
  serpCredits: number;
  aiCostUsd: number;
}

/**
 * Runs the paid steps in order and stops at the first email. A step already tried for this
 * business is not paid for again. Returns what happened.
 */
export async function findEmailFor(leadId: string, userId: string, opts: { useSerp: boolean; useAi: boolean }): Promise<FindEmailResult> {
  let [lead] = await db.select().from(businessLeads).where(and(eq(businessLeads.id, leadId), eq(businessLeads.userId, userId)));
  if (!lead) throw new Error("Business not found");
  const already = bestEmail(lead.findings);
  if (already) return { email: already.email, how: `already found (${already.label})`, serpCredits: 0, aiCostUsd: 0 };

  let lookup = lookupOf(lead);
  let serpCredits = 0;
  if (opts.useSerp && !lookup.emailSearch) {
    const emails = await emailSearchStep(lead);
    serpCredits = 1; // counted on the search row by serpRequest (0 if it came from the 30-day cache)
    lookup = { ...lookup, emailSearch: { at: new Date().toISOString(), emails } };
    lead = await saveLookup(lead, lookup);
    if (emails.length) return { email: emails[0].email, how: "email search (1 credit)", serpCredits, aiCostUsd: 0 };
  }

  if (opts.useAi && !lookup.ai) {
    if (!aiKeySet()) return { email: null, how: "AI step skipped: ANTHROPIC_API_KEY is not set on the crm service", serpCredits, aiCostUsd: 0 };
    const spent = await aiSpentThisMonth();
    if (spent + AI_EMAIL_TYPICAL_COST_USD > AI_EMAIL_MONTHLY_CAP_USD) {
      return { email: null, how: `AI step skipped: this month's AI cap ($${AI_EMAIL_MONTHLY_CAP_USD}) is reached`, serpCredits, aiCostUsd: 0 };
    }
    const ai = await aiStep(lead);
    lookup = { ...lookup, ai };
    await saveLookup(lead, lookup);
    if (ai.emails.length) return { email: ai.emails[0].email, how: "AI search (source shown)", serpCredits, aiCostUsd: ai.costUsd };
    return { email: null, how: ai.rejected.length ? "AI suggested an email no source showed, so it wasn't kept" : "no email found anywhere", serpCredits, aiCostUsd: ai.costUsd };
  }
  return { email: null, how: "no email found", serpCredits, aiCostUsd: 0 };
}
