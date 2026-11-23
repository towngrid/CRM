import type { Contact, User, EmailSequence } from "@shared/schema";
import { APP_NAME, getAppUrl } from "./appConfig";

// Brevo (formerly Sendinblue) email service
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

// Verified sender on Brevo
const DEFAULT_FROM_EMAIL = "hello@towngrid.net";
const DEFAULT_FROM_NAME = "TownGrid";

if (BREVO_API_KEY) {
  console.log(`[Brevo] API key loaded. Length: ${BREVO_API_KEY.length}`);
  // Diagnostic: verify key works on startup
  if (process.env.NODE_ENV === "production") (async () => {
    try {
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": BREVO_API_KEY }
      });
      const body = await res.json() as any;
      if (res.ok) {
        console.log(`[Brevo] Account check OK — plan: ${body.plan?.[0]?.type || "unknown"}, email: ${body.email}`);
      } else {
        console.error(`[Brevo] Account check HTTP ${res.status}:`, JSON.stringify(body));
      }
    } catch (e: any) {
      console.error("[Brevo] Diagnostic fetch error:", e.message);
    }
  })();
} else {
  console.error("[Brevo] WARNING: No BREVO_API_KEY found in environment.");
}

/**
 * Replace template variables in email content
 * Supported variables:
 * - [Contact_Greeting] - Full greeting: Hi Jane, or Hi Example Salon team,
 * - [Contact_First_Name] - Contact's first name (business-name fallback outside greetings)
 * - [Sales_Person] - Salesperson's first name
 * - [Business_Name] - Contact's company/business name
 * - [City] - Contact's city
 * - [Sales_Person_Email] - Salesperson's work email (or regular email)
 */
export function replaceTemplateVariables(
  content: string,
  contact: Contact,
  salesperson: User
): string {
  const salespersonName = `${salesperson.firstName || ''} ${salesperson.lastName || ''}`.trim() || salesperson.email || 'Sales Team';
  const businessName = contact.company || 'your business';
  const city = contact.city || '';
  const salespersonEmail = salesperson.workEmail || salesperson.email || '';

  const contactFirstName =
    (contact.useBusinessNameForEmail === "Yes" || !contact.firstName)
      ? (contact.company || businessName)
      : contact.firstName;
  const personalName = contact.firstName?.trim();
  const companyName = contact.company?.trim();
  const greetingName = personalName && contact.useBusinessNameForEmail !== "Yes"
    ? personalName
    : companyName ? `${companyName} team` : "there";
  const greeting = `Hi ${greetingName},`;

  // Existing saved templates already begin with Hi [Contact_First_Name].
  // Adapt that opening at render time, without rewriting stored templates or
  // changing first-name tokens used in the rest of the message.
  const greetingContent = content.replace(
    /^((?:\s|<[^>]*>)*Hi(?:\s|&nbsp;)+(?:<(?:span|strong|b|em|i)\b[^>]*>\s*)*)\[Contact_First_Name\]/i,
    (_match, opening: string) => `${opening}${greetingName}`,
  );
  // Subjects such as "[Contact_First_Name], are you listed..." use the same
  // personal/team selection, without adding the body's "Hi" greeting.
  const personalizedContent = greetingContent.replace(
    /^(\s*)\[Contact_First_Name\](?=\s*,)/,
    (_match, whitespace: string) => `${whitespace}${greetingName === "there" ? "Hello" : greetingName}`,
  );

  console.log(`[replaceTemplateVariables] contact: ${contact.firstName} ${contact.lastName}, company: "${contact.company}", businessName: "${businessName}", city: "${city}", useBusinessName: ${contact.useBusinessNameForEmail}`);

  return personalizedContent
    .replace(/\[Contact_Greeting\]/g, () => greeting)
    .replace(/\[Contact_First_Name\]/g, contactFirstName)
    .replace(/\[Sales_Person\]/g, salespersonName)
    .replace(/\[Business_Name\]/g, businessName)
    .replace(/\[City\]/g, city)
    .replace(/\[Sales_Person_Email\]/g, salespersonEmail);
}

/**
 * Send email via Brevo
 */
export async function sendEmail({
  to,
  subject,
  body,
  fromEmail = DEFAULT_FROM_EMAIL,
  fromName = DEFAULT_FROM_NAME,
  replyTo
}: {
  to: string;
  subject: string;
  body: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!BREVO_API_KEY) {
    console.error("[Brevo] API key not configured");
    return { success: false, error: "Email service not configured" };
  }

  if (!to) {
    return { success: false, error: "Recipient email is required" };
  }

  const payload: any = {
    sender: { name: fromName, email: DEFAULT_FROM_EMAIL },
    to: [{ email: to }],
    subject,
    htmlContent: (body.trimStart().startsWith("<!DOCTYPE") || body.trimStart().startsWith("<html"))
      ? body
      : body.replace(/\n/g, "<br>"),
  };

  if (replyTo) {
    payload.replyTo = { email: replyTo };
  }

  try {
    const res = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 201 || res.status === 200) {
      const responseBody = await res.json() as any;
      const messageId: string | undefined = responseBody.messageId;
      console.log(`[Brevo] Email sent successfully to ${to}. MessageId: ${messageId}`);
      return { success: true, messageId };
    } else {
      const errBody = await res.json().catch(() => ({})) as any;
      console.error(`[Brevo] Send failed — HTTP ${res.status}. Body:`, JSON.stringify(errBody));
      const errorMessage = errBody?.message || errBody?.errors?.[0]?.message || `HTTP ${res.status}`;
      return { success: false, error: errorMessage };
    }
  } catch (error: any) {
    console.error("[Brevo] Network error:", error.message);
    return { success: false, error: error.message || "Network error" };
  }
}

/**
 * Send sequence email to a contact
 */
export async function sendSequenceEmail({
  contact,
  salesperson,
  sequence,
  customSubject,
  customBody,
}: {
  contact: Contact;
  salesperson: User;
  sequence: EmailSequence;
  customSubject?: string | null;
  customBody?: string | null;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!contact.email) {
    return { success: false, error: "Contact has no email address" };
  }

  // Use per-contact custom email if provided (custom track), otherwise use sequence template
  const rawSubject = customSubject || sequence.subject;
  const rawBody = customBody || sequence.body;
  const subject = replaceTemplateVariables(rawSubject, contact, salesperson);
  const body = replaceTemplateVariables(rawBody, contact, salesperson);

  // Reply-To: salesperson's inbound parse address (so replies route to their inbox)
  const replyToEmail = salesperson.replyToEmail || salesperson.workEmail || salesperson.email || undefined;

  return await sendEmail({
    to: contact.email,
    subject,
    body,
    replyTo: replyToEmail,
  });
}

/**
 * Send a notification email to a salesperson when a lead replies
 */
export async function sendReplyNotificationEmail({
  salesperson,
  contactName,
}: {
  salesperson: User;
  contactName: string;
}): Promise<void> {
  const notifyEmail = salesperson.workEmail || salesperson.email;
  if (!notifyEmail) return;

  const subject = `You have a reply in ${APP_NAME}. Check the Inbox`;
  const body = `Please check your ${APP_NAME} Inbox and reply to the lead.\n\n${getAppUrl()}`;

  try {
    await sendEmail({
      to: notifyEmail,
      subject,
      body,
    });
    console.log(`[Brevo] Reply notification sent to ${notifyEmail} for contact ${contactName}`);
  } catch (error) {
    console.error("[Brevo] Failed to send reply notification email:", error);
  }
}
