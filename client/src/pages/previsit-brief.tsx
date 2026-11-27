// Printable Pre-visit brief (LEAD-FINDER-SPEC Step 4, PRE-VISIT-RESEARCH.md): one page with what
// they have now, the lead type and why, which plan fits, the one thing to show, and room for notes.
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { Contact, Deal } from "@shared/schema";
import { leadTypeLabel, leadListLabel } from "@shared/leadTypes";
import { industryLabel } from "@shared/industries";
import { greetingName } from "@shared/research";
import type { BriefData } from "@/components/deals/research-panel";
import { Home, PhoneCall, Printer } from "lucide-react";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div className="grid grid-cols-[150px_1fr] gap-2 py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className="break-words">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-0.5">
      <h2 className="mb-1 border-b border-gray-300 pb-0.5 text-[11pt] font-semibold uppercase tracking-wide text-gray-700">{title}</h2>
      {children}
    </section>
  );
}

const host = (url: string | null | undefined) => {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, "") + new URL(url).pathname.replace(/\/$/, ""); } catch { return url; }
};

export default function PreVisitBrief() {
  const { id: dealId } = useParams<{ id: string }>();
  const { data: ws } = useQuery<{ deal: Deal; contact: Contact | null }>({
    queryKey: ["/api/deal-workspace", dealId],
    queryFn: () => fetch(`/api/deal-workspace/${dealId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!dealId,
  });
  const contactId = ws?.contact?.id;
  const { data } = useQuery<BriefData>({ queryKey: [`/api/contacts/${contactId}/brief`], enabled: !!contactId });

  if (!ws) return <p className="p-8 text-gray-500">Loading…</p>;
  if (!ws.contact) return <p className="p-8">This deal has no contact, so there is no brief to print.</p>;
  if (!data) return <p className="p-8 text-gray-500">Loading…</p>;

  const c = data.contact;
  const r = data.research;
  const lead = data.lead;
  const f = lead?.findings ?? {};
  const w = f.website ?? {};
  const o = f.ordering ?? null;
  const name = c.company || [c.firstName, c.lastName].filter(Boolean).join(" ") || ws.deal.title;
  const address = [c.address, c.city, c.state, c.zipCode].filter(Boolean).join(", ");
  const websiteIssues = [
    w.loads === "no" ? "doesn't load" : null,
    w.copyrightYear && w.copyrightYear <= new Date().getFullYear() - 3 ? `© ${w.copyrightYear}` : null,
    w.loads === "yes" && w.phoneFriendly === "no" ? "not phone-friendly" : null,
    w.contactForm === "no" ? "no contact form" : null,
    w.ownedByOrderingCompany ? `run by ${w.ownedByOrderingCompany}` : null,
  ].filter(Boolean).join(", ");
  const websiteText = c.websiteUrl
    ? `${host(c.websiteUrl)}${websiteIssues ? ` (${websiteIssues})` : ""}`
    : "No Website found";
  const reasons: { points: number; text: string }[] = Array.isArray(lead?.scoreReasons) ? lead.scoreReasons : [];
  const email = c.email;
  const emailSource = r.emailSource || data.emails.find(e => e.email === email)?.label || "";

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`@page { size: letter; margin: 0.45in; } @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-white px-4 py-2">
        <Button size="sm" onClick={() => window.print()} data-testid="button-print-brief"><Printer className="mr-1.5 h-4 w-4" />Print</Button>
        <Button size="sm" variant="outline" asChild><a href={`/deal/${dealId}`}><Home className="mr-1.5 h-4 w-4" />Site Visit / Log Call on the deal</a></Button>
        <Button size="sm" variant="outline" asChild><a href={`/deal/${dealId}`}><PhoneCall className="mr-1.5 h-4 w-4" />Back to the deal</a></Button>
        <span className="text-xs text-gray-500">Fits one letter page. Edit the fields in the deal's Research tab.</span>
      </div>

      <article className="mx-auto my-4 max-w-[8.5in] bg-white p-8 text-[10pt] leading-snug text-gray-900 shadow print:my-0 print:max-w-none print:p-0 print:shadow-none" data-testid="previsit-brief">
        <header className="mb-3 flex items-start justify-between gap-4 border-b-2 border-gray-800 pb-2">
          <div>
            <p className="text-[9pt] uppercase tracking-wide text-gray-500">TownGrid · Pre-visit brief</p>
            <h1 className="text-[17pt] font-bold leading-tight">{name}</h1>
            <p>{address || "Address not on file"}{c.phone ? ` · ${c.phone}` : ""}</p>
            <p className="text-gray-600">
              {industryLabel(c.industryGroup, c.industryType)}
              {c.leadList ? ` · ${leadListLabel(c.leadList)} list` : ""}
              {c.leadType ? ` · ${leadTypeLabel(c.leadType)}` : ""}
            </p>
          </div>
          <div className="text-right">
            {lead?.score != null && <p className="text-[20pt] font-bold leading-none">{lead.score}<span className="ml-1 rounded bg-gray-800 px-1.5 py-0.5 align-middle text-[10pt] text-white">{lead.tier}</span></p>}
            <p className="mt-1 text-[9pt] text-gray-500">Printed {new Date().toLocaleDateString()}</p>
            {r.nextStep && <p className="text-[9pt] font-semibold">Next step: {r.nextStep}</p>}
          </div>
        </header>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Section title="Who to ask for">
            <Row label="Owner">{r.ownerFirstName ? `${r.ownerFirstName}${r.ownerRole ? ` (${r.ownerRole})` : ""} · ${r.ownerStatus}` : "Not confirmed"}</Row>
            <Row label="Email greeting">{`Hi ${greetingName(r, name)},`}</Row>
            <Row label="Email">{email ? `${email}${emailSource ? ` (${emailSource})` : ""}` : "None found"}</Row>
            <Row label="Contact form">{c.contactRequestFormUrl ? host(c.contactRequestFormUrl) : r.contactFormStatus || "—"}</Row>
            <Row label="Still open?">{[r.stillOpen, r.stillOpenNote].filter(Boolean).join(" · ") || "—"}</Row>
            <Row label="In person?">{r.inPerson || "—"}</Row>
          </Section>

          <Section title="What they have now">
            <Row label="Website">{websiteText}</Row>
            <Row label="Google">{r.googleProfile || (lead?.rating != null ? `${lead.rating} stars, ${lead.reviewCount ?? 0} reviews` : "—")}</Row>
            <Row label="Facebook">{c.facebookUrl ? host(c.facebookUrl) : "No Facebook found"}{r.facebookFollowers ? ` · ${r.facebookFollowers} followers` : ""}</Row>
            <Row label="Instagram">{c.instagramHandle ? host(c.instagramHandle) : "No Instagram found"}{r.instagramFollowers ? ` · ${r.instagramFollowers} followers` : ""}</Row>
            <Row label="Last social post">{r.lastPostDate}</Row>
            {(c.leadList === "ordering" || o) && <>
              <Row label="Ordering">{r.orderingPlatform || (o?.ownOrdering === "no" ? "No ordering on own site" : "—")}</Row>
              <Row label="Delivery apps">{r.deliveryApps || "None found"}</Row>
              <Row label="Delivery buttons">{r.deliveryButtons}</Row>
            </>}
            <Row label="Google issues">{[r.coverPhotoBad ? "cover photo looks bad" : null, r.googleWrong].filter(Boolean).join("; ")}</Row>
          </Section>

          <Section title="Why this lead">
            {reasons.length ? (
              <ul className="list-disc pl-4">
                {reasons.slice(0, 9).map((x, i) => <li key={i}>+{x.points} {x.text}</li>)}
              </ul>
            ) : <p className="text-gray-500">{c.leadType ? leadTypeLabel(c.leadType) : "Not scored"}</p>}
          </Section>

          <Section title="The pitch">
            <Row label="Best-fit plan">{r.bestPlan || ws.deal.plan || "—"}</Row>
            <Row label="Show the owner">{r.oneThing ? `${r.oneThing}${r.oneThingSource ? ` (${r.oneThingSource})` : ""}` : "—"}</Row>
            <Row label="Likely objection">{r.objection || "—"}</Row>
          </Section>
        </div>

        <Section title="Notes">
          {r.notes && <p className="mb-1 whitespace-pre-line">{r.notes}</p>}
          <div className="space-y-5 pt-2">
            {[0, 1, 2, 3, 4].map(i => <div key={i} className="border-b border-gray-300" />)}
          </div>
        </Section>
      </article>
    </div>
  );
}
