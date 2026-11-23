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
