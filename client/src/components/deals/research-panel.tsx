// Research tab on a deal (docs/PRE-VISIT-RESEARCH.md): the pre-visit fields plus the hand
// checklist, saved on the contact. Filled in from Business Search; Seann edits the rest.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useDealPlans } from "@/hooks/useDealPlans";
import { EMPTY_RESEARCH, type Research } from "@shared/research";
import type { Contact } from "@shared/schema";
import { Printer, RefreshCw } from "lucide-react";

export type BriefData = {
  contact: Contact;
  research: Research;
  lead: any | null;
  emails: { email: string; kind: string; url: string | null; label: string }[];
};

function errorText(error: unknown): string {
  const raw = String((error as Error)?.message ?? error).replace(/^\d{3}:\s*/, "");
  try { return JSON.parse(raw).message ?? raw; } catch { return raw; }
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Pick<T extends string>({ value, onChange, options, testId }: { value: T; onChange: (v: T) => void; options: readonly T[]; testId?: string }) {
  return (
    <Select value={value || "__blank"} onValueChange={v => onChange((v === "__blank" ? "" : v) as T)}>
      <SelectTrigger className="h-8" data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__blank">Not set</SelectItem>
        {options.filter(Boolean).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export default function ResearchPanel({ contactId, dealId }: { contactId: string; dealId: string }) {
  const { toast } = useToast();
  const { choices } = useDealPlans();
  const { data } = useQuery<BriefData>({ queryKey: [`/api/contacts/${contactId}/brief`] });
  const [r, setR] = useState<Research>(EMPTY_RESEARCH);
  const [email, setEmail] = useState("");
  const [formUrl, setFormUrl] = useState("");
  useEffect(() => {
    if (!data) return;
    setR(data.research);
    setEmail(data.contact.email ?? "");
    setFormUrl(data.contact.contactRequestFormUrl ?? "");
  }, [data]);
  const set = (patch: Partial<Research>) => setR(prev => ({ ...prev, ...patch }));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contactId}/brief`] });
    queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
    queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
  };
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/contacts/${contactId}`, {
      research: r, email: email.trim() || null, contactRequestFormUrl: formUrl.trim() || null,
    })).json(),
    onSuccess: () => { toast({ title: "Research saved" }); refresh(); },
    onError: e => toast({ title: "Not saved", description: errorText(e), variant: "destructive" }),
  });
  const fill = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/contacts/${contactId}/research/fill`)).json(),
    onSuccess: () => { toast({ title: "Filled in from Business Search", description: "Only empty fields were filled; nothing you typed was changed." }); refresh(); },
    onError: e => toast({ title: "Nothing filled", description: errorText(e), variant: "destructive" }),
  });

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-research">Save research</Button>
        {data.lead && <Button size="sm" variant="outline" onClick={() => fill.mutate()} disabled={fill.isPending}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Fill empty fields from Business Search</Button>}
        <Button size="sm" variant="outline" asChild><a href={`/deal/${dealId}/brief`} target="_blank" rel="noreferrer"><Printer className="mr-1.5 h-3.5 w-3.5" />Pre-visit brief</a></Button>
        {r.filledFromSearchAt && <span className="text-xs text-muted-foreground">Filled from Business Search {new Date(r.filledFromSearchAt).toLocaleDateString()}</span>}
      </div>

      <section className="space-y-3">
        <h4 className="font-semibold">Is it a fit?</h4>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Business identity" hint="Name, address and phone match the Google listing?"><Pick value={r.identity} onChange={v => set({ identity: v })} options={["Matched", "Uncertain", "Conflicting"] as const} /></Field>
          <Field label="Still open?"><Pick value={r.stillOpen} onChange={v => set({ stillOpen: v })} options={["Open", "Closed", "Unknown"] as const} /></Field>
          <Field label="Serves customers in person?" hint="Storefront, or visits customers (Google profiles need it)"><Pick value={r.inPerson} onChange={v => set({ inPerson: v })} options={["Yes", "No", "Unknown"] as const} /></Field>
        </div>
        <Field label="Still-open notes"><Input className="h-8" value={r.stillOpenNote} onChange={e => set({ stillOpenNote: e.target.value })} /></Field>
      </section>

      <section className="space-y-3">
        <h4 className="font-semibold">Owner and how to reach them</h4>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Owner first name"><Input className="h-8" value={r.ownerFirstName} onChange={e => set({ ownerFirstName: e.target.value })} /></Field>
          <Field label="Role"><Input className="h-8" placeholder="e.g. owner, chef-owner" value={r.ownerRole} onChange={e => set({ ownerRole: e.target.value })} /></Field>
          <Field label="Name status" hint="Cold emails use the first name only when Supported"><Pick value={r.ownerStatus} onChange={v => set({ ownerStatus: (v || "Not confirmed") as Research["ownerStatus"] })} options={["Supported", "Suggested", "Not confirmed"] as const} /></Field>
          <Field label="Where the name was found"><Input className="h-8" placeholder="link or quote" value={r.ownerSource} onChange={e => set({ ownerSource: e.target.value })} /></Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Public email" hint="Only an email the business shows publicly; never guessed"><Input className="h-8" type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
          <Field label="Where the email was found"><Input className="h-8" value={r.emailSource} onChange={e => set({ emailSource: e.target.value })} /></Field>
        </div>
        {data.emails.length > 1 && <p className="text-xs text-muted-foreground">Other emails found: {data.emails.slice(1).map(e => `${e.email} (${e.label})`).join(", ")}</p>}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Contact form URL" hint="Never submitted from the CRM"><Input className="h-8" value={formUrl} onChange={e => setFormUrl(e.target.value)} /></Field>
          <Field label="Contact form"><Pick value={r.contactFormStatus} onChange={v => set({ contactFormStatus: v })} options={["Found", "Not found", "Unverified"] as const} /></Field>
          <Field label="Form kind"><Pick value={r.contactFormKind} onChange={v => set({ contactFormKind: v })} options={["General", "Booking"] as const} /></Field>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="font-semibold">What they have now</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Booking / ordering platform"><Input className="h-8" value={r.orderingPlatform} onChange={e => set({ orderingPlatform: e.target.value })} /></Field>
          <Field label="Platform link"><Input className="h-8" value={r.orderingUrl} onChange={e => set({ orderingUrl: e.target.value })} /></Field>
          <Field label="Delivery apps"><Input className="h-8" value={r.deliveryApps} onChange={e => set({ deliveryApps: e.target.value })} /></Field>
          <Field label="Delivery buttons on their own website"><Input className="h-8" value={r.deliveryButtons} onChange={e => set({ deliveryButtons: e.target.value })} /></Field>
        </div>
        <Field label="Google profile"><Textarea rows={2} value={r.googleProfile} onChange={e => set({ googleProfile: e.target.value })} /></Field>
      </section>

      <section className="space-y-3">
        <h4 className="font-semibold">Your hand check (Facebook, Instagram, Google)</h4>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Facebook followers"><Input className="h-8" inputMode="numeric" value={r.facebookFollowers} onChange={e => set({ facebookFollowers: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Instagram followers"><Input className="h-8" inputMode="numeric" value={r.instagramFollowers} onChange={e => set({ instagramFollowers: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Last post date"><Input className="h-8" type="date" value={r.lastPostDate} onChange={e => set({ lastPostDate: e.target.value })} /></Field>
          <Field label="Checked">
            <label className="flex h-8 items-center gap-2"><Checkbox checked={r.handChecked} onCheckedChange={v => set({ handChecked: v === true })} /> Done</label>
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2"><Checkbox checked={r.coverPhotoBad} onCheckedChange={v => set({ coverPhotoBad: v === true })} /> Google cover photo looks bad</label>
          <Field label="Anything Google got wrong (hours, phone, photos…)"><Input className="h-8" value={r.googleWrong} onChange={e => set({ googleWrong: e.target.value })} /></Field>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="font-semibold">The pitch</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Best-fit TownGrid plan">
            <Input className="h-8" list="research-plans" value={r.bestPlan} onChange={e => set({ bestPlan: e.target.value })} />
            <datalist id="research-plans">{choices().map(p => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Next step"><Pick value={r.nextStep} onChange={v => set({ nextStep: v })} options={["Visit", "Cold email", "Call", "Skip"] as const} /></Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="One thing to show the owner"><Input className="h-8" value={r.oneThing} onChange={e => set({ oneThing: e.target.value })} /></Field>
          <Field label="Source for it"><Input className="h-8" value={r.oneThingSource} onChange={e => set({ oneThingSource: e.target.value })} /></Field>
        </div>
        <Field label="Likely objection and your answer"><Textarea rows={2} value={r.objection} onChange={e => set({ objection: e.target.value })} /></Field>
        <Field label="Notes"><Textarea rows={3} value={r.notes} onChange={e => set({ notes: e.target.value })} /></Field>
      </section>

      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save research</Button>
    </div>
  );
}
