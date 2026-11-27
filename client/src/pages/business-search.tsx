// Business Search (Step 3a): pick a business type and towns/zips, see the SerpAPI credit
// estimate, confirm, then review each business's website, social, ordering and lead type.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  AI_EMAIL_TYPICAL_COST_USD, BUSINESS_TYPES, LONG_ISLAND_ZIPS, OTHER_BUSINESS_TYPE, allEmails, defaultListFor, townForZip,
  type CreditEstimate, type EmailLookup,
} from "@shared/businessSearch";
import { LEAD_LISTS, LEAD_TYPES, leadListLabel, leadTypeLabel, type LeadList } from "@shared/leadTypes";
import { ArrowLeft, ChevronDown, ChevronRight, Download, ExternalLink, Pause, Play, Search, X } from "lucide-react";

type Budget = { usedThisMonth: number; stopAt: number; monthlyPlan: number; left: number; perHour: number; keySet: boolean };
type SerpAccount = { plan: string | null; searchesLeft: number | null; perMonth: number | null; thisMonthUsage: number | null } | null;
type SearchRow = {
  id: string; label: string; businessType: string; leadList: string; places: string[]; pagesPerPlace: number; status: string;
  estimate: CreditEstimate | null; creditsUsed: number; cachedCalls: number; businessesFound: number; businessesChecked: number;
  outsideArea: number; duplicatesRemoved: number; alreadyFound: number; errorMessage: string | null; createdAt: string; finishedAt: string | null; running: boolean;
  emailJob?: { running: boolean; total: number; done: number; found: number; aiCostUsd: number; note: string | null } | null;
  pass2Job?: { running: boolean; total: number; done: number; lookups: number; note: string | null } | null;
};

type FindEmailsEstimate = {
  businesses: number; serpCreditsMax: number; aiLookupsMax: number; aiCostMaxUsd: number; aiAvailable: boolean;
  aiSpentThisMonthUsd: number; aiCapUsd: number; budget: Budget;
};

/** "Find missing emails": pick tiers, see the cost, confirm. Free steps already ran in the search. */
function FindEmailsDialog({ searchId, open, onOpenChange }: { searchId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const [tiers, setTiers] = useState<string[]>(["A", "B"]);
  const [useAi, setUseAi] = useState(true);
  const { data: est } = useQuery<FindEmailsEstimate>({
    queryKey: ["find-emails-estimate", searchId, tiers.join(","), useAi],
    queryFn: async () => (await apiRequest("POST", `/api/business-search/${searchId}/find-emails/estimate`, { tiers, useAi })).json(),
    enabled: open && tiers.length > 0,
  });
  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/business-search/${searchId}/find-emails`, { confirm: true, tiers, useAi })).json(),
    onSuccess: () => { onOpenChange(false); queryClient.invalidateQueries({ queryKey: ["/api/business-search"] }); },
    onError: e => toast({ title: "Didn't start", description: errorText(e), variant: "destructive" }),
  });
  const toggle = (t: string) => setTiers(tiers.includes(t) ? tiers.filter(x => x !== t) : [...tiers, t]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Find missing emails?</DialogTitle>
          <DialogDescription>
            Their websites and the search results we already have were checked for free. For each business still missing an email:
            1) one Google "email" search (1 SerpAPI credit); 2) only if still missing, an AI web search. An AI answer is kept only when a source it cites shows the email. It stops at the first email found.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-4">
            <span>Tiers:</span>
            {["A", "B", "C"].map(t => (
              <label key={t} className="flex items-center gap-1.5"><Checkbox checked={tiers.includes(t)} onCheckedChange={() => toggle(t)} />{t}</label>
            ))}
            <label className="flex items-center gap-1.5"><Checkbox checked={useAi} onCheckedChange={v => setUseAi(v === true)} />Use AI step</label>
          </div>
          {est && (
            <>
              <p><b>{est.businesses}</b> businesses without an email.</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Email search: at most <b>{est.serpCreditsMax}</b> SerpAPI credits ({est.budget.left} left this month).</li>
                {useAi && (est.aiAvailable
                  ? <li>AI search: at most <b>{est.aiLookupsMax}</b> lookups, about <b>${est.aiCostMaxUsd.toFixed(2)}</b> (usually less: it only runs where the email search found nothing). This month: ${est.aiSpentThisMonthUsd.toFixed(2)} of the ${est.aiCapUsd} cap.</li>
                  : <li className="text-amber-700 dark:text-amber-400">AI step is off: the crm service has no ANTHROPIC_API_KEY variable yet.</li>)}
              </ul>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => start.mutate()} disabled={start.isPending || !est || est.businesses === 0}>Yes, find emails</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
type Lead = {
  id: string; name: string; address: string | null; town: string | null; zip: string | null; phone: string | null;
  rating: number | null; reviewCount: number | null; googleCategory: string | null; googleUrl: string | null;
  websiteUrl: string | null; facebookUrl: string | null; instagramUrl: string | null; deliveryApps: string | null;
  ownOrdering: string | null; sendsToApps: string | null; stillOpenFlag: boolean; googleStatus: string | null;
  leadList: string; leadType: string | null; checkStatus: string; checkError: string | null; findings: any;
  handChecked: boolean; facebookFollowers: number | null; instagramFollowers: number | null; lastPostDate: string | null; handCheckNotes: string | null;
  approvedAt: string | null; contactId: string | null; dealId: string | null;
  score: number | null; tier: string | null; scoreReasons: { key: string; points: number; text: string }[] | null;
  setAsideReason: string | null; setAsideByHand: boolean;
};

function errorText(error: unknown): string {
  const raw = String((error as Error)?.message ?? error).replace(/^\d{3}:\s*/, "");
  try { return JSON.parse(raw).message ?? raw; } catch { return raw; }
}

const yesNo = (v: string | null) => ({ yes: "Yes", no: "No", unknown: "Unknown", no_website: "No website" } as Record<string, string>)[v ?? ""] ?? "—";

function placeLabel(place: string): string {
  const town = /^\d{5}$/.test(place) ? townForZip(place) : null;
  return town ? `${place} ${town}` : place;
}

// ── New search form ───────────────────────────────────────────────────────
function NewSearch({ onStarted, isAdmin }: { onStarted: (id: string) => void; isAdmin: boolean }) {
  const { toast } = useToast();
  const [type, setType] = useState("restaurants");
  const [other, setOther] = useState("");
  const [list, setList] = useState<LeadList>("ordering");
  const [places, setPlaces] = useState<string[]>([]);
  const [placeText, setPlaceText] = useState("");
  const [pages, setPages] = useState("1");
  const [estimate, setEstimate] = useState<{ places: string[]; estimate: CreditEstimate; budget: Budget } | null>(null);
  const { data: budgetData } = useQuery<{ budget: Budget; serpapi: SerpAccount }>({ queryKey: ["/api/business-search/budget"] });

  const pickType = (value: string) => { setType(value); setList(defaultListFor(value)); };
  const addPlaces = (items: string[]) => setPlaces(prev => Array.from(new Set([...prev, ...items])));
  const addTyped = () => {
    const parts = placeText.split(/[,;\n]+/).map(p => p.trim()).filter(Boolean)
      .map(p => p.match(/^(\d{5})\b/)?.[1] ?? p);
    if (parts.length) addPlaces(parts);
    setPlaceText("");
  };
  const body = () => ({ businessType: type, businessTypeOther: type === OTHER_BUSINESS_TYPE ? other : null, leadList: list, places, pagesPerPlace: Number(pages) });

  const estimateMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/business-search/estimate", body())).json(),
    onSuccess: setEstimate,
    onError: e => toast({ title: "Can't estimate yet", description: errorText(e), variant: "destructive" }),
  });
  const startMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/business-search", { ...body(), confirm: true })).json(),
    onSuccess: (search: SearchRow) => {
      setEstimate(null);
      queryClient.invalidateQueries({ queryKey: ["/api/business-search"] });
      onStarted(search.id);
    },
    onError: e => toast({ title: "Search didn't start", description: errorText(e), variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">New search</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Business type</Label>
            <Select value={type} onValueChange={pickType}>
              <SelectTrigger data-testid="select-business-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BUSINESS_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                <SelectItem value={OTHER_BUSINESS_TYPE}>Other (type it)</SelectItem>
              </SelectContent>
            </Select>
            {type === OTHER_BUSINESS_TYPE && <Input placeholder="e.g. bakeries" value={other} onChange={e => setOther(e.target.value)} />}
          </div>
          <div className="space-y-1.5">
            <Label>List</Label>
            <Select value={list} onValueChange={v => setList(v as LeadList)}>
              <SelectTrigger data-testid="select-lead-list"><SelectValue /></SelectTrigger>
              <SelectContent>{LEAD_LISTS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Ordering also checks delivery apps and online ordering.</p>
          </div>
          <div className="space-y-1.5">
            <Label>How many per place</Label>
            <Select value={pages} onValueChange={setPages}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Up to 20 businesses</SelectItem>
                <SelectItem value="2">Up to 40 businesses</SelectItem>
                <SelectItem value="3">Up to 60 businesses</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Where (towns or zip codes)</Label>
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-sm" list="li-zips" placeholder="Type a zip or town, e.g. 11542 or Glen Cove" value={placeText}
              onChange={e => setPlaceText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }} data-testid="input-place" />
            <datalist id="li-zips">{LONG_ISLAND_ZIPS.map(z => <option key={z.zip} value={`${z.zip} ${z.town}`} />)}</datalist>
            <Button type="button" variant="outline" onClick={addTyped}>Add</Button>
            <Button type="button" variant="outline" onClick={() => addPlaces(LONG_ISLAND_ZIPS.filter(z => z.county === "Nassau").map(z => z.zip))}>All of Nassau</Button>
            <Button type="button" variant="outline" onClick={() => addPlaces(LONG_ISLAND_ZIPS.filter(z => z.county === "Suffolk").map(z => z.zip))}>All of Suffolk</Button>
            {places.length > 0 && <Button type="button" variant="ghost" onClick={() => setPlaces([])}>Clear</Button>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {places.map(p => (
              <Badge key={p} variant="secondary" className="gap-1">
                {placeLabel(p)}
                <button type="button" aria-label={`Remove ${p}`} onClick={() => setPlaces(places.filter(x => x !== p))}><X className="h-3 w-3" /></button>
              </Badge>
            ))}
            {places.length === 0 && <span className="text-sm text-muted-foreground">No places picked yet.</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => estimateMutation.mutate()} disabled={!isAdmin || places.length === 0 || estimateMutation.isPending} data-testid="button-estimate">
            <Search className="mr-2 h-4 w-4" />Check the cost first
          </Button>
          {budgetData && (
            <span className="text-sm text-muted-foreground">
              This month: {budgetData.budget.usedThisMonth} of {budgetData.budget.stopAt} searches used (the CRM stops at {budgetData.budget.stopAt}).
              {budgetData.serpapi?.searchesLeft != null && <> SerpAPI says {budgetData.serpapi.searchesLeft} left on your plan.</>}
            </span>
          )}
          {!isAdmin && <span className="text-sm text-muted-foreground">Only an admin can run searches.</span>}
        </div>
      </CardContent>

      <Dialog open={!!estimate} onOpenChange={open => { if (!open) setEstimate(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run this search?</DialogTitle>
            <DialogDescription>Nothing has been searched yet. This is the cost in SerpAPI searches (credits).</DialogDescription>
          </DialogHeader>
          {estimate && (
            <div className="space-y-2 text-sm">
              <p><b>{type === OTHER_BUSINESS_TYPE ? other : BUSINESS_TYPES.find(t => t.value === type)?.label}</b> in {estimate.places.map(placeLabel).join(", ")} · {leadListLabel(list)} list</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Google Maps: {estimate.estimate.mapsCalls} search{estimate.estimate.mapsCalls === 1 ? "" : "es"} (up to {estimate.estimate.maxBusinesses} businesses)</li>
                <li>Checks: up to {estimate.estimate.perBusinessMax} searches per business (website if Google has none, Facebook/Instagram if the website doesn't link them{list === "ordering" ? ", delivery apps" : ""}). Reading their websites is free.</li>
              </ul>
              {estimate.estimate.alreadyKnown > 0 && (
                <p><b>{estimate.estimate.alreadyKnown}</b> businesses here were already found in your earlier searches. They'll be skipped (0 credits).
                  {estimate.estimate.alreadyKnown >= estimate.estimate.maxBusinesses && " To find new ones, pick a higher \"How many per place\"."}</p>
              )}
              <p className="text-base">Likely about <b>{estimate.estimate.likely}</b> credits, at most <b>{estimate.estimate.max}</b>.</p>
              <p className="text-muted-foreground">Left this month before the CRM's stop: {estimate.budget.left}. Searches already made in the last 30 days are reused for free.</p>
              {estimate.estimate.likely > estimate.budget.left && <p className="font-medium text-destructive">Not enough credits left this month for this search.</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEstimate(null)}>Cancel</Button>
            <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending || !estimate || estimate.estimate.likely > estimate.budget.left} data-testid="button-run-search">
              Yes, run it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Past searches ─────────────────────────────────────────────────────────
function statusBadge(s: SearchRow) {
  const label = ({ queued: "Starting", running: "Running", done: "Done", stopped: "Stopped", failed: "Failed" } as Record<string, string>)[s.status] ?? s.status;
  return <Badge variant={s.status === "done" ? "default" : s.status === "failed" ? "destructive" : "secondary"}>{label}</Badge>;
}

function PastSearches({ onOpen }: { onOpen: (id: string) => void }) {
  const { data = [] } = useQuery<SearchRow[]>({ queryKey: ["/api/business-search"], refetchInterval: q => (q.state.data ?? []).some(s => s.status === "running" || s.status === "queued") ? 5000 : false });
  if (data.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Your searches</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Search</TableHead><TableHead>Status</TableHead><TableHead>Businesses</TableHead><TableHead>Credits used</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.map(s => (
              <TableRow key={s.id} className="cursor-pointer" onClick={() => onOpen(s.id)}>
                <TableCell className="font-medium">{s.label} in {s.places.slice(0, 4).map(placeLabel).join(", ")}{s.places.length > 4 ? ` +${s.places.length - 4} more` : ""}</TableCell>
                <TableCell>{statusBadge(s)}</TableCell>
                <TableCell>{s.businessesChecked} of {s.businessesFound} checked</TableCell>
                <TableCell>{s.creditsUsed}</TableCell>
                <TableCell>{new Date(s.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Results ───────────────────────────────────────────────────────────────
function LinkOr({ url, empty }: { url: string | null; empty: string }) {
  if (!url) return <span className="text-muted-foreground">{empty}</span>;
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{host}<ExternalLink className="h-3 w-3" /></a>;
}

function emailCell(l: Lead) {
  const emails = allEmails(l.findings);
  if (emails.length) {
    return (
      <span className="whitespace-nowrap" title={emails[0].label}>
        <a href={`mailto:${emails[0].email}`} className="text-primary hover:underline" onClick={e => e.stopPropagation()}>{emails[0].email}</a>
        {emails[0].kind === "ai_search" && <Badge variant="outline" className="ml-1 text-[10px]">AI</Badge>}
        {emails.length > 1 && <span className="text-muted-foreground"> +{emails.length - 1}</span>}
      </span>
    );
  }
  if (l.findings?.website?.contactForm === "yes") return <span className="text-muted-foreground">Contact form only</span>;
  return <span className="text-muted-foreground">No email found</span>;
}

/** Every email with where it came from, the paid steps tried, and "Find email" for this business. */
function EmailPanel({ lead, isAdmin }: { lead: Lead; isAdmin: boolean }) {
  const { toast } = useToast();
  const [asking, setAsking] = useState(false);
  const emails = allEmails(lead.findings);
  const lookup = (lead.findings?.emailLookup ?? {}) as EmailLookup;
  const find = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/business-search/leads/${lead.id}/find-email`, { confirm: true })).json(),
    onSuccess: (r: { email: string | null; how: string; aiCostUsd: number }) => {
      setAsking(false);
      toast({ title: r.email ? `Found ${r.email}` : "No email found", description: `${r.how}${r.aiCostUsd ? ` · AI cost $${r.aiCostUsd.toFixed(2)}` : ""}` });
      queryClient.invalidateQueries({ queryKey: ["/api/business-search"] });
    },
    onError: e => { setAsking(false); toast({ title: "Didn't work", description: errorText(e), variant: "destructive" }); },
  });
  const tried = [
    lookup.emailSearch ? `email search ${new Date(lookup.emailSearch.at).toLocaleDateString()} (${lookup.emailSearch.emails.length ? "found" : "nothing"})` : null,
    lookup.ai ? `AI search ${new Date(lookup.ai.at).toLocaleDateString()} (${lookup.ai.emails.length ? "found" : "nothing"}, $${lookup.ai.costUsd.toFixed(2)})` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-1 md:col-span-2">
      <h4 className="font-semibold">Email</h4>
      {emails.length ? (
        <ul className="space-y-0.5">
          {emails.map(e => (
            <li key={e.email}>
              <a href={`mailto:${e.email}`} className="text-primary hover:underline">{e.email}</a>{" "}
              <span className="text-muted-foreground">({e.label}{e.url ? <>: <a href={e.url} target="_blank" rel="noreferrer" className="hover:underline">source</a></> : ""})</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-muted-foreground">No email found on their website or in search results yet.</p>}
      {lookup.ai?.rejected?.length ? <p className="text-xs text-muted-foreground">AI also suggested {lookup.ai.rejected.join(", ")}, but no source showed it, so it wasn't kept.</p> : null}
      {tried.length > 0 && <p className="text-xs text-muted-foreground">Already tried: {tried.join(" · ")}</p>}
      {isAdmin && !emails.length && (!lookup.emailSearch || !lookup.ai) && (
        asking ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>Uses up to 1 SerpAPI credit, then (only if still missing) about ${AI_EMAIL_TYPICAL_COST_USD.toFixed(2)} of AI search. Go ahead?</span>
            <Button size="sm" onClick={() => find.mutate()} disabled={find.isPending}>{find.isPending ? "Looking…" : "Yes, find it"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={find.isPending}>Cancel</Button>
          </div>
        ) : <Button size="sm" variant="outline" onClick={() => setAsking(true)}>Find email</Button>
      )}
    </div>
  );
}

function websiteCell(l: Lead) {
  const w = l.findings?.website;
  if (!l.websiteUrl || w?.googleButton === "social") return <span className="text-muted-foreground">No Website found</span>;
  return <LinkOr url={l.websiteUrl} empty="No Website found" />;
}

function socialCell(l: Lead, which: "facebook" | "instagram") {
  const url = which === "facebook" ? l.facebookUrl : l.instagramUrl;
  if (!l.facebookUrl && !l.instagramUrl) return <span className="text-muted-foreground">No social found</span>;
  return <LinkOr url={url} empty={which === "facebook" ? "No Facebook found" : "No Instagram found"} />;
}

function TierBadge({ lead }: { lead: Lead }) {
  if (lead.setAsideReason) return <Badge variant="outline" className="text-muted-foreground" title={lead.setAsideReason}>Set aside</Badge>;
  if (lead.score == null) return <span className="text-muted-foreground">—</span>;
  const cls = lead.tier === "A" ? "bg-emerald-600 text-white hover:bg-emerald-600" : lead.tier === "B" ? "bg-amber-500 text-white hover:bg-amber-500" : "";
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><b>{lead.score}</b><Badge variant={lead.tier === "C" ? "secondary" : "default"} className={cls}>{lead.tier}</Badge></span>;
}

/** Pass 2 results for one business, or a button to run it (about 3 credits). */
function GoogleProfilePanel({ lead, isAdmin }: { lead: Lead; isAdmin: boolean }) {
  const { toast } = useToast();
  const [asking, setAsking] = useState(false);
  const p = lead.findings?.pass2;
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/business-search/leads/${lead.id}/pass2`, { confirm: true })).json(),
    onSuccess: (r: { lookups: number }) => { setAsking(false); toast({ title: "Google profile checked", description: `${r.lookups} SerpAPI credits at most (0 for any reused from the last 30 days).` }); queryClient.invalidateQueries({ queryKey: ["/api/business-search"] }); },
    onError: e => { setAsking(false); toast({ title: "Didn't work", description: errorText(e), variant: "destructive" }); },
  });
  const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString() : "none";
  return (
    <div className="space-y-1">
      <h4 className="font-semibold">Google profile</h4>
      {p ? (
        <ul className="space-y-0.5">
          <li>Claimed by the owner: <b>{p.unclaimed ? "No: unclaimed (\"Own this business?\")" : "Yes"}</b></li>
          <li>Owner replied to <b>{p.ownerRepliesOfNewest10} of the newest {p.reviewsChecked}</b> reviews{p.unansweredBadReview ? "; a 1–2 star review has no reply" : ""}</li>
          <li>Newest review: {day(p.newestReviewDate)}</li>
          <li>Newest "Updates" post: {p.newestUpdateDate ? day(p.newestUpdateDate) : "none found"}</li>
          <li>Photos from the owner: {p.ownerPhotoCount >= 10 ? "10 or more" : p.ownerPhotoCount}</li>
          {p.hoursLastUpdated && <li>Hours: {p.hoursLastUpdated}</li>}
          <li className="text-xs text-muted-foreground">Checked {day(p.at)}</li>
        </ul>
      ) : <p className="text-muted-foreground">Not checked yet.</p>}
      {isAdmin && !p && lead.checkStatus === "checked" && !lead.setAsideReason && (
        asking ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>Uses about 3 SerpAPI credits (at most 4). Go ahead?</span>
            <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? "Checking…" : "Yes, check it"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={run.isPending}>Cancel</Button>
          </div>
        ) : <Button size="sm" variant="outline" onClick={() => setAsking(true)}>Check Google profile</Button>
      )}
    </div>
  );
}

/** "Google profile check" for every business scoring 40+: cost first, then confirm. */
function Pass2Dialog({ searchId, open, onOpenChange }: { searchId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const { data: est } = useQuery<{ line: number; businesses: number; creditsMax: number; creditsLikely: number; budget: Budget }>({
    queryKey: ["pass2-estimate", searchId],
    queryFn: async () => (await apiRequest("POST", `/api/business-search/${searchId}/pass2/estimate`, {})).json(),
    enabled: open,
  });
  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/business-search/${searchId}/pass2`, { confirm: true })).json(),
    onSuccess: () => { onOpenChange(false); queryClient.invalidateQueries({ queryKey: ["/api/business-search"] }); },
    onError: e => toast({ title: "Didn't start", description: errorText(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check Google profiles?</DialogTitle>
          <DialogDescription>
            For each business scoring {est?.line ?? 40} or more (not yet checked): is the Google profile unclaimed, does the owner reply to reviews,
            any recent "Updates" posts, any photos from the owner. Search results only; nothing is opened on Google.
          </DialogDescription>
        </DialogHeader>
        {est && (
          <div className="space-y-1 text-sm">
            <p><b>{est.businesses}</b> businesses to check.</p>
            <p>About <b>{est.creditsLikely}</b> SerpAPI credits, at most <b>{est.creditsMax}</b> ({est.budget.left} left this month).</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => start.mutate()} disabled={start.isPending || !est || est.businesses === 0}>Yes, check them</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScorePanel({ lead }: { lead: Lead }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const setAside = useMutation({
    mutationFn: async (r: string | null) => (await apiRequest("POST", `/api/business-search/leads/${lead.id}/set-aside`, { reason: r })).json(),
    onSuccess: () => { setReason(""); queryClient.invalidateQueries({ queryKey: ["/api/business-search"] }); },
    onError: e => toast({ title: "Didn't work", description: errorText(e), variant: "destructive" }),
  });
  return (
    <div className="space-y-2 md:col-span-2">
      <h4 className="font-semibold">Opportunity score {lead.score != null && <>: {lead.score} (tier {lead.tier})</>}</h4>
      {lead.setAsideReason ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Set aside, not scored: <b>{lead.setAsideReason}</b>{!lead.setAsideByHand && " (found automatically)"}.</span>
          {lead.setAsideByHand && <Button size="sm" variant="outline" onClick={() => setAside.mutate(null)} disabled={setAside.isPending}>Bring it back</Button>}
        </div>
      ) : (
        <>
          {lead.scoreReasons?.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {lead.scoreReasons.map(r => <li key={r.key}><Badge variant="secondary">{r.points > 0 ? "+" : ""}{r.points} {r.text}</Badge></li>)}
            </ul>
          ) : <p className="text-muted-foreground">No points: little for TownGrid to fix here.</p>}
          <p className="text-xs text-muted-foreground">
            {lead.findings?.pass2 ? "Includes the Google profile check." : "Google profile points (unclaimed, owner replies, Updates, photos, recent reviews) come from the Google profile check, run for businesses scoring 40 or more (Settings → Opportunity score)."}
            {" "}Change point values in Settings → Opportunity score.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-8 max-w-xs" placeholder="Reason, e.g. no in-person service" value={reason} onChange={e => setReason(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => setAside.mutate(reason.trim() || "set aside by you")} disabled={setAside.isPending}>Set aside</Button>
          </div>
        </>
      )}
    </div>
  );
}

function Details({ lead, isAdmin }: { lead: Lead; isAdmin: boolean }) {
  const { toast } = useToast();
  const f = lead.findings ?? {};
  const w = f.website, s = f.social, o = f.ordering, open = f.stillOpen;
  const [hand, setHand] = useState({
    handChecked: lead.handChecked, facebookFollowers: lead.facebookFollowers?.toString() ?? "", instagramFollowers: lead.instagramFollowers?.toString() ?? "",
    lastPostDate: lead.lastPostDate ?? "", handCheckNotes: lead.handCheckNotes ?? "",
    email: (f.emailLookup as EmailLookup | undefined)?.hand?.email ?? "",
  });
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/business-search/leads/${lead.id}`, {
      handChecked: hand.handChecked,
      facebookFollowers: hand.facebookFollowers ? Number(hand.facebookFollowers) : null,
      instagramFollowers: hand.instagramFollowers ? Number(hand.instagramFollowers) : null,
      lastPostDate: hand.lastPostDate || null, handCheckNotes: hand.handCheckNotes || null,
      email: hand.email.trim(),
    })).json(),
    onSuccess: () => { toast({ title: "Saved" }); queryClient.invalidateQueries({ queryKey: ["/api/business-search"] }); },
    onError: e => toast({ title: "Not saved", description: errorText(e), variant: "destructive" }),
  });
  const approve = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/business-search/leads/${lead.id}/approve`)).json(),
    onSuccess: () => { toast({ title: "Added to Contacts and Pipeline" }); queryClient.invalidateQueries({ queryKey: ["/api/business-search"] }); },
    onError: e => toast({ title: "Not added", description: errorText(e), variant: "destructive" }),
  });
  const socialOnSite = s ? Object.entries(s.fromWebsite ?? {}) as [string, { url: string; page: string }][] : [];

  return (
    <div className="grid gap-4 bg-muted/40 p-4 text-sm md:grid-cols-2">
      <ScorePanel lead={lead} />
      <EmailPanel lead={lead} isAdmin={isAdmin} />
      <GoogleProfilePanel lead={lead} isAdmin={isAdmin} />
      <div className="space-y-1">
        <h4 className="font-semibold">Website</h4>
        {!w?.url ? <p>No website found{w?.source === "none" ? " (Google lists none; one web search found no match)" : ""}.</p> : (
          <ul className="space-y-0.5">
            <li>From: {w.source === "google" ? "Google's Website button" : "web search (check it's theirs)"}</li>
            {w.googleButton === "social" && <li>Google's Website button goes to Facebook/Instagram</li>}
            {w.googleButton === "ordering_site" && <li>The "website" is an ordering page ({w.ownedByOrderingCompany})</li>}
            {w.googleButton === "dead" && <li>Google's Website button is a dead link</li>}
            <li>Loads: {yesNo(w.loads)}{w.error ? ` (${w.error})` : ""}</li>
            <li>Copyright year: {w.copyrightYear ?? "not shown"}</li>
            <li>Phone-friendly: {yesNo(w.phoneFriendly)} · Contact form: {yesNo(w.contactForm)}</li>
            {w.builder && <li>Built with: {w.builder}</li>}
            {w.ownedByOrderingCompany && <li>Website owned by the ordering company: {w.ownedByOrderingCompany}</li>}
            {w.pagesRead?.length > 0 && <li className="text-muted-foreground">Pages read: {w.pagesRead.length}</li>}
          </ul>
        )}
      </div>
      <div className="space-y-1">
        <h4 className="font-semibold">Social</h4>
        {socialOnSite.length > 0 ? (
          <ul>{socialOnSite.map(([k, v]) => <li key={k}>{k}: <LinkOr url={v.url} empty="" /> <span className="text-muted-foreground">(linked on their site)</span></li>)}</ul>
        ) : <p className="text-muted-foreground">No social links on their website.</p>}
        {s?.fromSearch && Object.entries(s.fromSearch).map(([k, v]: [string, any]) => (
          <p key={k}>{k} from search: <LinkOr url={v.url} empty="" /> <Badge variant="outline">Likely match: check by hand</Badge></p>
        ))}
        {s?.notLinkedFromSite && <p>Social accounts exist but aren't linked from the website.</p>}
      </div>
      {o && (
        <div className="space-y-1">
          <h4 className="font-semibold">Ordering</h4>
          <p>On delivery apps (search): {o.appsFromSearch?.length ? o.appsFromSearch.map((a: any) => <span key={a.service} className="mr-2"><LinkOr url={a.url} empty="" /></span>) : "none found"}</p>
          <p>Sends customers to delivery apps from own site: <b>{yesNo(o.sendsToApps)}</b></p>
          <p>Takes orders on own site: <b>{yesNo(o.ownOrdering)}</b>{o.ownOrderingPlatform ? ` (${o.ownOrderingPlatform})` : ""}</p>
          {o.siteLinks?.length > 0 && <ul className="list-disc pl-5">{o.siteLinks.map((l: any) => <li key={l.service}>{l.label}: <LinkOr url={l.url} empty="" /> <span className="text-muted-foreground">on {l.page}</span></li>)}</ul>}
          {o.googleServiceOptions && <p>Google: {Object.entries(o.googleServiceOptions).map(([k, v]) => `${k.replace(/_/g, " ")} ${v ? "yes" : "no"}`).join(", ")}</p>}
          {f.jsLoaded && (o.sendsToApps === "unknown" || o.ownOrdering === "unknown") && <p className="text-muted-foreground">This site loads buttons with JavaScript, so "Unknown" means: look by hand.</p>}
        </div>
      )}
      <div className="space-y-1">
        <h4 className="font-semibold">Still open?</h4>
        <p>Google: {({ open: "open", permanently_closed: "Permanently closed", temporarily_closed: "Temporarily closed", unknown: "no status shown" } as Record<string, string>)[open?.googleStatus ?? lead.googleStatus ?? "unknown"]}</p>
        {open?.reasons?.length > 0 && <p className="font-medium text-amber-700 dark:text-amber-400">Check: {open.reasons.join("; ")}</p>}
        {open?.newestSourceDate && <p>Newest dated web source: {open.newestSourceDate}</p>}
        {open?.aiSummary && <p><Badge variant="outline">Google AI summary</Badge> <span className="text-muted-foreground">{open.aiSummary}</span></p>}
        <p>Google: {lead.rating ?? "—"} stars, {lead.reviewCount ?? 0} reviews · <LinkOr url={lead.googleUrl} empty="no listing link" /></p>
      </div>
      <div className="space-y-2 md:col-span-2">
        <h4 className="font-semibold">Your hand check (Facebook / Instagram)</h4>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2"><Checkbox checked={hand.handChecked} onCheckedChange={v => setHand({ ...hand, handChecked: v === true })} />Checked</label>
          <div><Label className="text-xs">Facebook followers</Label><Input className="h-8 w-28" inputMode="numeric" value={hand.facebookFollowers} onChange={e => setHand({ ...hand, facebookFollowers: e.target.value.replace(/\D/g, "") })} /></div>
          <div><Label className="text-xs">Instagram followers</Label><Input className="h-8 w-28" inputMode="numeric" value={hand.instagramFollowers} onChange={e => setHand({ ...hand, instagramFollowers: e.target.value.replace(/\D/g, "") })} /></div>
          <div><Label className="text-xs">Email you found</Label><Input className="h-8 w-56" type="email" placeholder="e.g. from their Facebook page" value={hand.email} onChange={e => setHand({ ...hand, email: e.target.value })} /></div>
          <div><Label className="text-xs">Last post date</Label><Input className="h-8 w-36" type="date" value={hand.lastPostDate} onChange={e => setHand({ ...hand, lastPostDate: e.target.value })} /></div>
          <div className="min-w-[200px] flex-1"><Label className="text-xs">Notes</Label><Input className="h-8" value={hand.handCheckNotes} onChange={e => setHand({ ...hand, handCheckNotes: e.target.value })} /></div>
          <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
          {lead.contactId
            ? <Badge>In Contacts and Pipeline</Badge>
            : <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending || lead.checkStatus !== "checked"} data-testid={`button-approve-${lead.id}`}>Approve: add to Contacts and Pipeline</Button>}
        </div>
      </div>
    </div>
  );
}

function Results({ id, onBack, isAdmin }: { id: string; onBack: () => void; isAdmin: boolean }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ search: SearchRow; leads: Lead[] }>({
    queryKey: ["/api/business-search", id],
    refetchInterval: q => (q.state.data?.search.status === "running" || q.state.data?.search.status === "queued" || q.state.data?.search.emailJob?.running || q.state.data?.search.pass2Job?.running) ? 4000 : false,
  });
  const [listFilter, setListFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [townFilter, setTownFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [recheckOpen, setRecheckOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [pass2Open, setPass2Open] = useState(false);
  const action = useMutation({
    mutationFn: async (what: "stop" | "resume" | "recheck") => (await apiRequest("POST", `/api/business-search/${id}/${what}`, what === "recheck" ? { confirm: true } : undefined)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/business-search"] }),
    onError: e => toast({ title: "Didn't work", description: errorText(e), variant: "destructive" }),
  });

  const leads = data?.leads ?? [];
  const towns = useMemo(() => Array.from(new Set(leads.map(l => l.town).filter(Boolean) as string[])).sort(), [leads]);
  const order = (t: string | null) => { const i = LEAD_TYPES.findIndex(x => x.value === t); return i < 0 ? 99 : i; };
  const shown = leads
    .filter(l => listFilter === "all" || l.leadList === listFilter)
    .filter(l => typeFilter === "all" || l.leadType === typeFilter)
    .filter(l => townFilter === "all" || l.town === townFilter)
    .filter(l => tierFilter === "all" || (tierFilter === "aside" ? !!l.setAsideReason : (l.tier === tierFilter && !l.setAsideReason)))
    // Best opportunities first; set-aside businesses last; then lead type and review count.
    .sort((a, b) => (a.setAsideReason ? 1 : 0) - (b.setAsideReason ? 1 : 0) || (b.score ?? -1) - (a.score ?? -1) ||
      order(a.leadType) - order(b.leadType) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
  const tierCounts = { A: 0, B: 0, C: 0, aside: 0 } as Record<string, number>;
  for (const l of leads) { if (l.setAsideReason) tierCounts.aside++; else if (l.tier) tierCounts[l.tier]++; }
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads) if (l.leadType) c[l.leadType] = (c[l.leadType] ?? 0) + 1;
    return c;
  }, [leads]);

  if (isLoading || !data) return <p className="p-6 text-muted-foreground">Loading…</p>;
  const s = data.search;
  const ordering = s.leadList === "ordering";

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="px-0"><ArrowLeft className="mr-2 h-4 w-4" />All searches</Button>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">{s.label} in {s.places.map(placeLabel).join(", ")}</h2>
            {statusBadge(s)}
            <Badge variant="outline">{leadListLabel(s.leadList)} list</Badge>
          </div>
          <p className="text-sm">
            <b>{s.businessesChecked}</b> of <b>{s.businessesFound}</b> businesses checked ·
            {" "}<b>{s.creditsUsed}</b> SerpAPI credits used{s.cachedCalls ? ` (+${s.cachedCalls} reused free)` : ""} ·
            {" "}estimate was ~{s.estimate?.likely ?? "?"}
            {s.outsideArea ? ` · ${s.outsideArea} outside the area skipped` : ""}
            {s.duplicatesRemoved ? ` · ${s.duplicatesRemoved} duplicates removed` : ""}
            {s.alreadyFound ? ` · ${s.alreadyFound} already found in earlier searches, skipped` : ""}
          </p>
          {s.errorMessage && <p className="text-sm text-amber-700 dark:text-amber-400">{s.errorMessage}</p>}
          {s.pass2Job && (
            <p className="text-sm">
              {s.pass2Job.running ? "Checking Google profiles: " : "Google profiles checked: "}
              <b>{s.pass2Job.done}</b> of {s.pass2Job.total}
              {s.pass2Job.note ? <span className="text-amber-700 dark:text-amber-400"> · {s.pass2Job.note}</span> : null}
            </p>
          )}
          {s.emailJob && (
            <p className="text-sm">
              {s.emailJob.running ? "Finding emails: " : "Email finding done: "}
              <b>{s.emailJob.done}</b> of {s.emailJob.total} looked up, <b>{s.emailJob.found}</b> found
              {s.emailJob.aiCostUsd ? ` · AI cost $${s.emailJob.aiCostUsd.toFixed(2)}` : ""}
              {s.emailJob.note ? <span className="text-amber-700 dark:text-amber-400"> · {s.emailJob.note}</span> : null}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {isAdmin && (s.status === "running" || s.status === "queued") && <Button size="sm" variant="outline" onClick={() => action.mutate("stop")}><Pause className="mr-2 h-4 w-4" />Stop</Button>}
            {isAdmin && (s.status === "stopped" || s.status === "failed") && <Button size="sm" onClick={() => action.mutate("resume")}><Play className="mr-2 h-4 w-4" />Resume</Button>}
            {isAdmin && (s.status === "done" || s.status === "stopped" || s.status === "failed") && <Button size="sm" variant="outline" onClick={() => setRecheckOpen(true)}>Check again</Button>}
            {isAdmin && s.status === "done" && !s.emailJob?.running && <Button size="sm" variant="outline" onClick={() => setFindOpen(true)} data-testid="button-find-emails">Find missing emails</Button>}
            {isAdmin && s.status === "done" && !s.pass2Job?.running && <Button size="sm" variant="outline" onClick={() => setPass2Open(true)} data-testid="button-pass2">Check Google profiles</Button>}
            <Button size="sm" variant="outline" asChild><a href={`/api/business-search/${id}/export?format=csv`}><Download className="mr-2 h-4 w-4" />CSV</a></Button>
            <Button size="sm" variant="outline" asChild><a href={`/api/business-search/${id}/export?format=xlsx`}><Download className="mr-2 h-4 w-4" />Excel</a></Button>
          </div>
          {Object.keys(typeCounts).length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {LEAD_TYPES.filter(t => typeCounts[t.value]).map(t => <Badge key={t.value} variant="secondary">{t.label}: {typeCounts[t.value]}</Badge>)}
            </div>
          )}
        </CardContent>
      </Card>

      <FindEmailsDialog searchId={id} open={findOpen} onOpenChange={setFindOpen} />
      <Pass2Dialog searchId={id} open={pass2Open} onOpenChange={setPass2Open} />

      <Dialog open={recheckOpen} onOpenChange={setRecheckOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check these {s.businessesFound} businesses again?</DialogTitle>
            <DialogDescription>Google Maps isn't searched again. Searches already made are reused for free; only new ones cost credits.</DialogDescription>
          </DialogHeader>
          <p className="text-sm">At most <b>{s.businessesFound * (ordering ? 3 : 2)}</b> credits; usually far fewer. Credits used so far: {s.creditsUsed}.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecheckOpen(false)}>Cancel</Button>
            <Button onClick={() => { setRecheckOpen(false); action.mutate("recheck"); }}>Yes, check again</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap gap-2">
        <Select value={listFilter} onValueChange={setListFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All lists</SelectItem>{LEAD_LISTS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All lead types</SelectItem>{LEAD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-44" data-testid="select-tier"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="A">A: visit or call first ({tierCounts.A})</SelectItem>
            <SelectItem value="B">B: cold email ({tierCounts.B})</SelectItem>
            <SelectItem value="C">C: later ({tierCounts.C})</SelectItem>
            <SelectItem value="aside">Set aside ({tierCounts.aside})</SelectItem>
          </SelectContent>
        </Select>
        <Select value={townFilter} onValueChange={setTownFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All towns</SelectItem>{towns.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
        <span className="self-center text-sm text-muted-foreground">{shown.length} shown · click a row for details</span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" /><TableHead>Score</TableHead><TableHead>Name</TableHead><TableHead>Town</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead>Lead type</TableHead>
              <TableHead>Website</TableHead><TableHead>Facebook</TableHead><TableHead>Instagram</TableHead>
              {ordering && <><TableHead>Delivery apps</TableHead><TableHead>Own ordering</TableHead></>}
              <TableHead>Rating</TableHead><TableHead>Reviews</TableHead><TableHead>Still open?</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(l => (
              <Fragment key={l.id}>
                <TableRow className={`cursor-pointer ${l.setAsideReason ? "opacity-60" : ""}`} onClick={() => setOpen(open === l.id ? null : l.id)} data-testid={`row-lead-${l.id}`}>
                  <TableCell>{open === l.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                  <TableCell>{l.checkStatus === "checked" ? <TierBadge lead={l} /> : "—"}</TableCell>
                  <TableCell className="font-medium">{l.name}{l.contactId && <Badge className="ml-2" variant="outline">Approved</Badge>}</TableCell>
                  <TableCell>{l.town ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{l.phone ?? "—"}</TableCell>
                  <TableCell>{l.checkStatus === "checked" ? emailCell(l) : "—"}</TableCell>
                  <TableCell>{l.checkStatus === "pending" ? <span className="text-muted-foreground">checking…</span> : l.checkStatus === "failed" ? <span className="text-destructive" title={l.checkError ?? ""}>check failed</span> : leadTypeLabel(l.leadType)}</TableCell>
                  <TableCell>{l.checkStatus === "checked" ? websiteCell(l) : "—"}</TableCell>
                  <TableCell>{l.checkStatus === "checked" ? socialCell(l, "facebook") : "—"}</TableCell>
                  <TableCell>{l.checkStatus === "checked" ? socialCell(l, "instagram") : "—"}</TableCell>
                  {ordering && <><TableCell>{l.deliveryApps || (l.checkStatus === "checked" ? "None found" : "—")}</TableCell><TableCell>{yesNo(l.ownOrdering)}</TableCell></>}
                  <TableCell>{l.rating ?? "—"}</TableCell>
                  <TableCell>{l.reviewCount ?? "—"}</TableCell>
                  <TableCell>{l.stillOpenFlag ? <Badge variant="destructive">Check</Badge> : ""}</TableCell>
                </TableRow>
                {open === l.id && (
                  <TableRow><TableCell colSpan={ordering ? 15 : 13} className="p-0"><Details lead={l} isAdmin={isAdmin} /></TableCell></TableRow>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && <TableRow><TableCell colSpan={15} className="py-8 text-center text-muted-foreground">{s.status === "running" || s.status === "queued" ? "Searching Google Maps…" : "No businesses match."}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function BusinessSearch() {
  const { user } = useAuth() as { user?: { role?: string } };
  const isAdmin = user?.role === "admin";
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("search"));
  useEffect(() => {
    const url = new URL(window.location.href);
    if (openId) url.searchParams.set("search", openId); else url.searchParams.delete("search");
    window.history.replaceState(null, "", url.toString());
  }, [openId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="Business Search" />
      <main className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {openId ? <Results id={openId} onBack={() => setOpenId(null)} isAdmin={isAdmin} /> : (
          <>
            <NewSearch onStarted={setOpenId} isAdmin={isAdmin} />
            <PastSearches onOpen={setOpenId} />
          </>
        )}
      </main>
    </div>
  );
}
