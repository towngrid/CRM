// One place for the app's name, web address and admin alert recipients.

export const APP_NAME = "TownGrid CRM";

const DEFAULT_ADMIN_ALERT_EMAILS = ["seann@towngrid.net"];

/**
 * Who gets admin alerts and the daily report.
 * Set the Railway variable ADMIN_ALERT_EMAILS to a comma-separated list to change it.
 */
export function getAdminAlertEmails(): string[] {
  const list = (process.env.ADMIN_ALERT_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map(email => email.trim().toLowerCase())
    .filter(email => email.includes("@"));
  return list.length > 0 ? Array.from(new Set(list)) : DEFAULT_ADMIN_ALERT_EMAILS;
}

/** The CRM's own web address, for links in alert emails. Empty when unknown. */
export function getAppUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return railway ? `https://${railway}` : "";
}

/** TownGrid's own SerpAPI key, from the Railway variable SERPAPI_KEY. Never logged or shown. */
export function getSerpApiKey(): string | undefined {
  return process.env.SERPAPI_KEY?.trim() || undefined;
}

/** The one admin account created when the users table is empty. */
export const OWNER_EMAIL = "seann@towngrid.net";

/**
 * Cold outreach (email sequences) only sends when the Railway variable
 * ENABLE_OUTREACH_SENDING is exactly "on". Missing, "off" or anything else = off.
 * Sign-in codes and admin alerts are not outreach and are not affected.
 */
export function isOutreachSendingEnabled(): boolean {
  return (process.env.ENABLE_OUTREACH_SENDING ?? "").trim().toLowerCase() === "on";
}

export const OUTREACH_OFF_MESSAGE =
  "Outreach sending is off (ENABLE_OUTREACH_SENDING is not \"on\"). Nothing was sent.";
