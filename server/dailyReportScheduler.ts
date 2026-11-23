import { storage } from "./storage";
import { sendEmail } from "./sendgrid";

import { APP_NAME, getAdminAlertEmails } from "./appConfig";

const TIMEZONE = "America/New_York";

// Report sends at this hour (Eastern Time), 24-hour format
const REPORT_HOUR_ET = 18; // 6:00 PM ET

/**
 * Get the start and end of "today" in Eastern Time, returned as UTC Date objects.
 */
function getTodayRangeET(): { start: Date; end: Date } {
  const nowET = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  // nowET is like "03/10/2026"
  const [month, day, year] = nowET.split("/");
  const dateStr = `${year}-${month}-${day}`;

  // Convert ET midnight → UTC
  const startET = new Date(`${dateStr}T00:00:00`);
  const endET   = new Date(`${dateStr}T23:59:59`);

  // Get ET offset by comparing UTC vs ET representation
  const refDate = new Date();
  const utcHour = refDate.getUTCHours();
  const etHour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "2-digit", hour12: false }).format(refDate),
    10
  );
  const offsetHours = utcHour - (etHour === 24 ? 0 : etHour);

  const start = new Date(startET.getTime() + offsetHours * 60 * 60 * 1000);
  const end   = new Date(endET.getTime()   + offsetHours * 60 * 60 * 1000);

  return { start, end };
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(d)) + " ET";
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(new Date());
}

const STAGE_LABELS: Record<string, string> = {
  new_lead_unqualified:                  "New Lead Unqualified",
  qualified_lead:                        "Qualified Lead",
  contacted_emailed:                     "Contacted — Emailed",
  contacted_phone_spoke_decision_maker:  "Spoke w/ Decision Maker",
  contacted_phone_spoke_non_decision_maker: "Spoke w/ Non-Decision Maker",
  contacted_phone_left_message:          "Left Message",
  trial_period_started:                  "Trial Period Started",
  pending_commitment:                    "Pending Commitment",
  in_negotiation:                        "In Negotiation",
  won:                                   "Won",
  lost:                                  "Lost",
};

function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "—";
  return STAGE_LABELS[stage] ?? stage;
}

function contactDisplay(c: { firstName?: string | null; lastName?: string | null; company?: string | null; city?: string | null }): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || "Unknown";
  return name;
}

// ────────────────────────────────────────────────────────────────────────────
// HTML builders
// ────────────────────────────────────────────────────────────────────────────

function buildEmailHtml(
  sentRows: SentRow[],
  replyRows: ReplyRow[],
  analyticsRows: AnalyticsRow[],
  dateLabel?: string
): string {
  const date = dateLabel ?? todayLabel();
  const totalSent     = sentRows.length;
  const totalReplies  = replyRows.length;
  const totalOpens    = analyticsRows.filter(r => r.openedAt).length;
  const totalClicks   = analyticsRows.filter(r => r.clickedAt).length;

  const thStyle = `padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e5e7eb;background:#f9fafb;white-space:nowrap;`;
  const tdStyle = `padding:9px 12px;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;vertical-align:top;`;
  const tdMutedStyle = `padding:9px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;vertical-align:top;`;

  // Sent table rows
  const sentTableRows = sentRows.length === 0
    ? `<tr><td colspan="6" style="${tdMutedStyle}text-align:center;font-style:italic;">No emails sent today</td></tr>`
    : sentRows.map((r, i) => `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};">
        <td style="${tdStyle}font-weight:500;">${escHtml(r.recipientName)}</td>
        <td style="${tdMutedStyle}">${escHtml(r.businessName)}</td>
        <td style="${tdMutedStyle}">${escHtml(r.location)}</td>
        <td style="${tdStyle}">${escHtml(r.salespersonName)}</td>
        <td style="${tdStyle}"><span style="background:#dbeafe;color:#1d4ed8;padding:2px 7px;border-radius:4px;font-size:11px;white-space:nowrap;">Seq #${r.sequenceNumber} &middot; ${escHtml(r.track)}</span></td>
        <td style="${tdStyle}"><span style="background:#f3f4f6;color:#374151;padding:2px 7px;border-radius:4px;font-size:11px;white-space:nowrap;">${escHtml(r.dealStage)}</span></td>
      </tr>`).join("");

  // Analytics table rows — opens and clicks today
  const analyticsTableRows = analyticsRows.length === 0
    ? `<tr><td colspan="6" style="${tdMutedStyle}text-align:center;font-style:italic;">No opens or clicks recorded today</td></tr>`
    : analyticsRows.map((r, i) => `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};">
        <td style="${tdStyle}font-weight:500;">${escHtml(r.recipientName)}</td>
        <td style="${tdMutedStyle}">${escHtml(r.businessName)}</td>
        <td style="${tdMutedStyle}">${escHtml(r.location)}</td>
        <td style="${tdStyle}">${escHtml(r.salespersonName)}</td>
        <td style="${tdStyle}text-align:center;">
          ${r.openedAt
            ? `<span style="background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:4px;font-size:11px;white-space:nowrap;">&#128065; ${formatDate(r.openedAt)}</span>`
            : `<span style="color:#d1d5db;font-size:12px;">—</span>`}
        </td>
        <td style="${tdStyle}text-align:center;">
          ${r.clickedAt
            ? `<span style="background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:4px;font-size:11px;white-space:nowrap;">&#128279; ${formatDate(r.clickedAt)}</span>`
            : `<span style="color:#d1d5db;font-size:12px;">—</span>`}
        </td>
      </tr>`).join("");

  // Reply table rows — shows the business contact who replied + the from email for clarity
  const replyTableRows = replyRows.length === 0
    ? `<tr><td colspan="5" style="${tdMutedStyle}text-align:center;font-style:italic;">No replies received today</td></tr>`
    : replyRows.map((r, i) => `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};">
        <td style="${tdStyle}font-weight:500;">${escHtml(r.recipientName)}<br><span style="font-size:11px;color:#9ca3af;font-weight:400;">${escHtml(r.fromEmail)}</span></td>
        <td style="${tdMutedStyle}">${escHtml(r.businessName)}</td>
        <td style="${tdMutedStyle}">${escHtml(r.location)}</td>
        <td style="${tdStyle}">${escHtml(r.salespersonName)}</td>
        <td style="${tdStyle}"><span style="background:#f3f4f6;color:#374151;padding:2px 7px;border-radius:4px;font-size:11px;white-space:nowrap;">${escHtml(r.dealStage)}</span></td>
      </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{margin:0;padding:0;}table{border-collapse:collapse;}@media only screen and (max-width:600px){.outer-td{padding:8px 6px!important;}.inner-table{width:100%!important;}.header-td{padding:16px 16px!important;}.card-td{padding:14px 16px!important;border-right:none!important;}}</style>
</head><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;"><tr><td align="center" class="outer-td" style="padding:16px 12px;"><table width="780" cellpadding="0" cellspacing="0" border="0" class="inner-table" style="max-width:780px;width:100%;">

        <!-- HEADER -->
        <tr>
          <td class="header-td" style="background:#1e3a5f;border-radius:8px 8px 0 0;padding:20px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="56" valign="middle">
                  <div style="background:#3b82f6;border-radius:6px;padding:7px 12px;display:inline-block;">
                    <span style="color:white;font-size:16px;font-weight:700;letter-spacing:1px;font-family:Arial,sans-serif;">ESY</span>
                  </div>
                </td>
                <td valign="middle" style="padding-left:14px;">
                  <p style="margin:0;color:#93c5fd;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-family:Arial,sans-serif;">${APP_NAME}</p>
                  <p style="margin:2px 0 0;color:#ffffff;font-size:20px;font-weight:700;font-family:Arial,sans-serif;">Daily Activity Report</p>
                </td>
              </tr>
            </table>
            <p style="margin:10px 0 0;color:#bfdbfe;font-size:13px;font-family:Arial,sans-serif;">${escHtml(date)}</p>
          </td>
        </tr>

        <!-- SUMMARY CARDS -->
        <tr>
          <td style="background:#ffffff;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="25%" class="card-td" style="padding:16px 20px;border-right:1px solid #e5e7eb;">
                  <p style="margin:0;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">Emails Sent</p>
                  <p style="margin:4px 0 0;color:#1d4ed8;font-size:32px;font-weight:700;line-height:1;font-family:Arial,sans-serif;">${totalSent}</p>
                </td>
                <td width="25%" class="card-td" style="padding:16px 20px;border-right:1px solid #e5e7eb;">
                  <p style="margin:0;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">Replies Received</p>
                  <p style="margin:4px 0 0;color:#16a34a;font-size:32px;font-weight:700;line-height:1;font-family:Arial,sans-serif;">${totalReplies}</p>
                </td>
                <td width="25%" class="card-td" style="padding:16px 20px;border-right:1px solid #e5e7eb;">
                  <p style="margin:0;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">Emails Opened</p>
                  <p style="margin:4px 0 0;color:#7c3aed;font-size:32px;font-weight:700;line-height:1;font-family:Arial,sans-serif;">${totalOpens}</p>
                </td>
                <td width="25%" class="card-td" style="padding:16px 20px;">
                  <p style="margin:0;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">Links Clicked</p>
                  <p style="margin:4px 0 0;color:#b45309;font-size:32px;font-weight:700;line-height:1;font-family:Arial,sans-serif;">${totalClicks}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SENT SECTION -->
        <tr><td style="padding-top:20px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:6px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:#eff6ff;padding:13px 16px;border-bottom:1px solid #e5e7eb;">
                <span style="font-size:14px;font-weight:700;color:#1e40af;font-family:Arial,sans-serif;">Emails Sent &mdash; ${totalSent}</span>
              </td>
            </tr>
            <tr>
              <td>
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                  <thead>
                    <tr>
                      <th style="${thStyle}">Recipient</th>
                      <th style="${thStyle}">Business</th>
                      <th style="${thStyle}">City</th>
                      <th style="${thStyle}">Salesperson</th>
                      <th style="${thStyle}">Sequence</th>
                      <th style="${thStyle}">Deal Stage</th>
                    </tr>
                  </thead>
                  <tbody>${sentTableRows}</tbody>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- REPLIES SECTION -->
        <tr><td style="padding-top:16px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:6px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:#f0fdf4;padding:13px 16px;border-bottom:1px solid #e5e7eb;">
                <span style="font-size:14px;font-weight:700;color:#15803d;font-family:Arial,sans-serif;">Replies Received &mdash; ${totalReplies}</span>
              </td>
            </tr>
            <tr>
              <td>
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                  <thead>
                    <tr>
                      <th style="${thStyle}">Contact (replied from)</th>
                      <th style="${thStyle}">Business</th>
                      <th style="${thStyle}">City</th>
                      <th style="${thStyle}">Salesperson</th>
                      <th style="${thStyle}">Deal Stage</th>
                    </tr>
                  </thead>
                  <tbody>${replyTableRows}</tbody>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- ANALYTICS SECTION -->
        <tr><td style="padding-top:16px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:6px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:#faf5ff;padding:13px 16px;border-bottom:1px solid #e5e7eb;">
                <span style="font-size:14px;font-weight:700;color:#6d28d9;font-family:Arial,sans-serif;">Email Opens &amp; Clicks Today &mdash; ${analyticsRows.length} emails</span>
                <span style="margin-left:12px;font-size:11px;color:#8b5cf6;font-family:Arial,sans-serif;">${totalOpens} opened &middot; ${totalClicks} clicked</span>
              </td>
            </tr>
            <tr>
              <td>
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                  <thead>
                    <tr>
                      <th style="${thStyle}">Recipient</th>
                      <th style="${thStyle}">Business</th>
                      <th style="${thStyle}">City</th>
                      <th style="${thStyle}">Salesperson</th>
                      <th style="${thStyle}text-align:center;">&#128065; Opened</th>
                      <th style="${thStyle}text-align:center;">&#128279; Clicked</th>
                    </tr>
                  </thead>
                  <tbody>${analyticsTableRows}</tbody>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:18px 0 8px;text-align:center;">
            <p style="margin:0;color:#9ca3af;font-size:11px;font-family:Arial,sans-serif;">Automatically generated by ${APP_NAME} &middot; Sent daily at 6:00 PM ET</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

function escHtml(str: string | null | undefined): string {
  return (str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ────────────────────────────────────────────────────────────────────────────
// Row types
// ────────────────────────────────────────────────────────────────────────────

interface SentRow {
  recipientName: string;
  businessName: string;
  location: string;
  salespersonName: string;
  sequenceNumber: number;
  track: string;
  dealStage: string;
}

interface ReplyRow {
  recipientName: string;
  businessName: string;
  location: string;
  salespersonName: string;
  dealStage: string;
  fromEmail: string;
}

interface AnalyticsRow {
  recipientName: string;
  businessName: string;
  location: string;
  salespersonName: string;
  sequenceNumber: number;
  openedAt: Date | null;
  clickedAt: Date | null;
}

const TRACK_LABELS: Record<string, string> = {
  salon_no_software: "Salon - No Software",
  salon_uses_competitor: "Salon - Uses Competitor",
  salon_custom: "Salon - General",
  mobile_no_software: "Mobile - No Software",
  mobile_uses_competitor: "Mobile - Uses Competitor",
  mobile_custom: "Mobile - General",
  // Legacy fallbacks
  no_software: "No Software",
  uses_competitor: "Uses Competitor",
  custom: "General",
};

// ────────────────────────────────────────────────────────────────────────────
// Main report function
// ────────────────────────────────────────────────────────────────────────────

export async function sendDailyReport(options?: { overrideStart?: Date; overrideEnd?: Date; label?: string; overrideRecipients?: string[] }): Promise<void> {
  console.log("[DailyReport] Building daily activity report...");

  const { start, end } = options?.overrideStart
    ? { start: options.overrideStart, end: options.overrideEnd ?? new Date() }
    : getTodayRangeET();

  try {
    // Fetch all data in parallel
    const [allLogs, allMessages, allContacts, allDeals, allUsers] = await Promise.all([
      storage.getEmailSequenceLogs(null),
      storage.getInboxMessages(null),
      storage.getContacts(null),
      storage.getDeals(null),
      storage.getAllUsers(),
    ]);

    // Index for fast lookup
    const contactMap = new Map(allContacts.map(c => [c.id, c]));
    const dealsByContact = new Map<string, (typeof allDeals)[0]>();
    for (const deal of allDeals) {
      if (!deal.contactId) continue;
      // Keep the most recent active deal for the contact
      const existing = dealsByContact.get(deal.contactId);
      if (!existing || new Date(deal.createdAt ?? 0) > new Date(existing.createdAt ?? 0)) {
        dealsByContact.set(deal.contactId, deal);
      }
    }

    // User map — keyed by userId
    const userMap = new Map<string, { firstName?: string | null; lastName?: string | null; email?: string | null }>();
    for (const u of allUsers) userMap.set(u.id, u);

    // Helper: get salesperson display name
    const getSalesperson = (userId: string) => {
      const u = userMap.get(userId);
      if (!u) return "Unknown";
      return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Unknown";
    };

    // Helper: location string
    const locationStr = (c: { city?: string | null; address?: string | null }) => {
      // Extract state from address if city is separate
      const city = c.city ?? "";
      return city || "—";
    };

    // ── Emails Sent today ──────────────────────────────────────────────────
    const sentLogs = allLogs.filter(l => {
      if (l.status !== "sent" || !l.sentAt) return false;
      const t = new Date(l.sentAt);
      return t >= start && t <= end;
    });

    const sentRows: SentRow[] = sentLogs.map(l => {
      const contact = contactMap.get(l.contactId);
      const deal = contact ? dealsByContact.get(contact.id) : undefined;
      return {
        recipientName: contact ? contactDisplay(contact) : "Unknown",
        businessName: contact?.company || "—",
        location: contact ? locationStr(contact) : "—",
        salespersonName: getSalesperson(l.userId),
        sequenceNumber: l.sequenceNumber,
        track: TRACK_LABELS[l.sequenceTrack] ?? l.sequenceTrack,
        dealStage: stageLabel(deal?.stage),
      };
    });

    // ── Replies today ──────────────────────────────────────────────────────
    const todayMessages = allMessages.filter(m => {
      const t = new Date(m.receivedAt ?? m.createdAt ?? 0);
      return t >= start && t <= end;
    });

    const replyRows: ReplyRow[] = todayMessages.map(m => {
      const contact = m.contactId ? contactMap.get(m.contactId) : undefined;
      const deal = contact ? dealsByContact.get(contact.id) : undefined;
      // Extract just the email address from "Name <email>" format
      const rawFrom = m.from ?? "";
      const fromEmailMatch = rawFrom.match(/<([^>]+)>/) ;
      const fromEmail = fromEmailMatch ? fromEmailMatch[1] : rawFrom;
      return {
        recipientName: contact ? contactDisplay(contact) : rawFrom.split("<")[0].trim() || rawFrom,
        businessName: contact?.company || "—",
        location: contact ? locationStr(contact) : "—",
        salespersonName: getSalesperson(m.userId),
        dealStage: stageLabel(deal?.stage),
        fromEmail,
      };
    });

    // ── Sync Brevo analytics for recent sent emails ──────────────────────────
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const recentCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const logsToSync = allLogs.filter(l =>
      l.status === "sent" &&
      l.brevoMessageId &&
      l.sentAt && new Date(l.sentAt) >= recentCutoff &&
      (!l.openedAt || !l.clickedAt)
    ).slice(0, 50);

    if (BREVO_API_KEY && logsToSync.length > 0) {
      console.log(`[DailyReport] Syncing analytics for ${logsToSync.length} emails from Brevo...`);
      const BATCH = 10;
      for (let i = 0; i < logsToSync.length; i += BATCH) {
        const batch = logsToSync.slice(i, i + BATCH);
        await Promise.all(batch.map(async (log) => {
          try {
            const mid = encodeURIComponent(log.brevoMessageId!);
            const [openRes, clickRes] = await Promise.all([
              fetch(`https://api.brevo.com/v3/smtp/statistics/events?messageId=${mid}&event=opened&limit=5`, {
                headers: { "api-key": BREVO_API_KEY }
              }),
              fetch(`https://api.brevo.com/v3/smtp/statistics/events?messageId=${mid}&event=clicks&limit=5`, {
                headers: { "api-key": BREVO_API_KEY }
              }),
            ]);
            const [openData, clickData] = await Promise.all([
              openRes.ok ? openRes.json() as any : { events: [] },
              clickRes.ok ? clickRes.json() as any : { events: [] },
            ]);
            const openEvents: any[] = openData?.events ?? [];
            const clickEvents: any[] = clickData?.events ?? [];
            const updates: Record<string, unknown> = {};
            if (openEvents.length > 0 && !log.openedAt) {
              log.openedAt = new Date(openEvents[0].date) as any;
              updates.openedAt = log.openedAt;
            }
            if (clickEvents.length > 0 && !log.clickedAt) {
              log.clickedAt = new Date(clickEvents[0].date) as any;
              updates.clickedAt = log.clickedAt;
            }
            if (Object.keys(updates).length > 0) {
              await storage.updateEmailSequenceLog(log.id, updates as any, null);
            }
          } catch (syncErr) {
            console.warn("[DailyReport] Analytics sync error for log", log.id, syncErr);
          }
        }));
      }
      console.log("[DailyReport] Analytics sync complete.");
    }

    // ── Opens & Clicks today ───────────────────────────────────────────────
    const analyticsLogs = allLogs.filter(l => {
      const opened = l.openedAt && new Date(l.openedAt) >= start && new Date(l.openedAt) <= end;
      const clicked = l.clickedAt && new Date(l.clickedAt) >= start && new Date(l.clickedAt) <= end;
      return opened || clicked;
    });

    const analyticsRows: AnalyticsRow[] = analyticsLogs.map(l => {
      const contact = contactMap.get(l.contactId);
      return {
        recipientName: contact ? contactDisplay(contact) : "Unknown",
        businessName: contact?.company || "—",
        location: contact ? locationStr(contact) : "—",
        salespersonName: getSalesperson(l.userId),
        sequenceNumber: l.sequenceNumber,
        openedAt: l.openedAt ? new Date(l.openedAt) : null,
        clickedAt: l.clickedAt ? new Date(l.clickedAt) : null,
      };
    });

    if (sentRows.length === 0 && replyRows.length === 0 && analyticsRows.length === 0) {
      console.log("[DailyReport] No activity today — sending report anyway.");
    }

    const reportLabel = options?.label ?? todayLabel();
    const totalOpens = analyticsRows.filter(r => r.openedAt).length;
    const totalClicks = analyticsRows.filter(r => r.clickedAt).length;
    const subject = `${APP_NAME} Daily Report — ${reportLabel} · ${sentRows.length} sent, ${replyRows.length} repl${replyRows.length === 1 ? "y" : "ies"}, ${totalOpens} open${totalOpens === 1 ? "" : "s"}`;
    const html = buildEmailHtml(sentRows, replyRows, analyticsRows, reportLabel);

    // Send to all recipients
    const recipients = options?.overrideRecipients ?? getAdminAlertEmails();
    const results = await Promise.allSettled(
      recipients.map(to => sendEmail({ to, subject, body: html }))
    );

    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.success) {
        console.log(`[DailyReport] Sent to ${recipients[i]}`);
      } else {
        const err = r.status === "rejected" ? r.reason : (r.value as any).error;
        console.error(`[DailyReport] Failed to send to ${recipients[i]}:`, err);
      }
    });

    console.log("[DailyReport] Done.");
  } catch (err) {
    console.error("[DailyReport] Error generating report:", err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Scheduler — fires once per day at REPORT_HOUR_ET (Eastern Time)
// ────────────────────────────────────────────────────────────────────────────

export function startDailyReportScheduler(): void {
  console.log(`[DailyReport] Scheduler started — report sends daily at ${REPORT_HOUR_ET}:00 ET`);

  function scheduleNext() {
    const now = new Date();

    // Compute next fire time: today at REPORT_HOUR_ET ET (or tomorrow if already past)
    const etNowStr = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).format(now);

    // etNowStr like "03/10/2026, 18:05:32"
    const [datePart, timePart] = etNowStr.split(", ");
    const [month, day, year] = datePart.split("/");
    const [currentHour] = timePart.split(":").map(Number);

    let targetDateStr = `${year}-${month}-${day}`;
    if (currentHour >= REPORT_HOUR_ET) {
      // Already past today's send time — schedule for tomorrow
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowET = new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE,
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(tomorrow);
      const [tm, td, ty] = tomorrowET.split("/");
      targetDateStr = `${ty}-${tm}-${td}`;
    }

    // Build the target UTC time by finding the ET→UTC offset
    const targetNaive = new Date(`${targetDateStr}T${String(REPORT_HOUR_ET).padStart(2, "0")}:00:00`);
    const utcH = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE, hour: "2-digit", hour12: false,
      }).format(targetNaive),
      10
    );
    const offsetH = targetNaive.getUTCHours() - (utcH === 24 ? 0 : utcH);
    const targetUTC = new Date(targetNaive.getTime() + offsetH * 60 * 60 * 1000);

    const msUntilFire = targetUTC.getTime() - now.getTime();
    console.log(`[DailyReport] Next report in ${Math.round(msUntilFire / 60000)} minutes (at ${formatDate(targetUTC)})`);

    setTimeout(async () => {
      await sendDailyReport();
      scheduleNext(); // schedule the next day's report
    }, msUntilFire);
  }

  scheduleNext();
}
