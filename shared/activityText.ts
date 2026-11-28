// Readable Recent Activity lines (Step 5). Some activities store raw data (the email-sending
// records are saved as JSON so outreach can be audited); this turns each one into a sentence,
// e.g. "Email 2 sent to Dog Tales Pet Spa".
import { stageLabel } from "./dealStages";

export interface ActivityLike { type: string; description: string; contactId?: string | null }

const EMAIL_STATES: Record<string, (n: string, who: string) => string> = {
  scheduled: (n, who) => `Email ${n} scheduled for ${who}`,
  attempted: (n, who) => `Email ${n} to ${who}: sending started`,
  sent: (n, who) => `Email ${n} sent to ${who}`,
  failed: (n, who) => `Email ${n} to ${who} failed`,
  uncertain: (n, who) => `Email ${n} to ${who}: not sure it was sent, needs a look`,
};

/** `contactName` gives the business or person name for a contact id, when known. */
export function activityText(a: ActivityLike, contactName: (id: string | null | undefined) => string | null): string {
  const who = contactName(a.contactId) ?? null;
  if (a.type === "recipient_outreach_evidence") {
    try {
      const e = JSON.parse(a.description);
      const name = contactName(e.contactId) ?? e.recipient ?? "a contact";
      const line = EMAIL_STATES[e.state];
      return line ? line(String(e.sequenceNumber ?? "?"), name) : `Email ${e.sequenceNumber ?? ""} to ${name}: ${e.state}`.trim();
    } catch {
      return "Email activity";
    }
  }
  // Older lines named contacts by first and last name, which approved businesses don't have.
  if (a.type === "contact_added" && /null|undefined/.test(a.description)) {
    return `New contact ${who ?? "added"}${who ? " added" : ""}`;
  }
  if (a.type === "deal_stage_changed") {
    return a.description.replace(/moved to ([a-z0-9_]+)$/i, (_m, stage) => `moved to ${stageLabel(stage)}`);
  }
  // Anything else that is raw data rather than a sentence.
  if (/^\s*[{[]/.test(a.description)) return who ? `Update for ${who}` : "Update";
  return a.description;
}

/** The name to show for a contact: the business, else the person. */
export function contactDisplayName(c: { company?: string | null; firstName?: string | null; lastName?: string | null }): string | null {
  const person = [c.firstName, c.lastName].filter(v => v && v !== "null").join(" ").trim();
  return c.company?.trim() || person || null;
}
