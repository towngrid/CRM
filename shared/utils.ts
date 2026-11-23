/**
 * Normalize phone number by removing all non-digit characters and country codes
 * Examples:
 * - "(555) 123-4567" -> "5551234567"
 * - "+1-555-123-4567" -> "5551234567"
 * - "+1 (555) 123-4567" -> "5551234567"
 */
export function normalizePhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');
  
  // Remove country code +1 if present (11 digits starting with 1)
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return digitsOnly.substring(1);
  }
  
  return digitsOnly || null;
}

/**
 * Normalize name for comparison (trim and lowercase)
 */
export function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.trim().toLowerCase() || null;
}

/**
 * Normalize email for comparison (trim and lowercase)
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.trim().toLowerCase() || null;
}

/**
 * Upfront and monthly commission for a plan. TownGrid has no commission rules yet
 * (no salespeople), so every plan pays 0 until Seann sets the rules.
 */
export function getCommissionAmounts(_planName: string | null | undefined): { upfront: number; monthly: number } {
  return { upfront: 0, monthly: 0 };
}

/**
 * Calculate total upfront commission from a plan name (for backwards-compat display).
 */
export function calculateCommission(planName: string | null | undefined): number {
  return getCommissionAmounts(planName).upfront;
}

/**
 * Parse a full US address string into its street, city, state, and zip components.
 *
 * Handles formats like:
 *   "123 Main St, Houston, TX 77001, USA"
 *   "123 Main Street, Houston, TX 77001"
 *   "123 Main St Ste 200, Portland, OR 97201"
 *   "123 Main St, Houston, TX" (no ZIP)
 *
 * If the string cannot be parsed, the original value goes into `street`
 * and city/state/zip are null.
 */
export function parseAddressString(fullAddress: string | null | undefined): {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  if (!fullAddress?.trim()) return { street: null, city: null, state: null, zip: null };

  const cleaned = fullAddress
    .replace(/,?\s*(USA|United States)\s*$/i, "")
    .trim();

  // "STREET, CITY, ST 00000" — most common Google Maps format
  const m1 = cleaned.match(/^(.+?),\s*(.+?),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)\s*$/);
  if (m1) {
    return {
      street: m1[1].trim() || null,
      city:   m1[2].trim() || null,
      state:  m1[3].toUpperCase(),
      zip:    m1[4].trim(),
    };
  }

  // "STREET, CITY ST 00000" — state + zip without comma between them
  const m2 = cleaned.match(/^(.+?),\s*(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (m2) {
    return {
      street: m2[1].trim() || null,
      city:   m2[2].trim() || null,
      state:  m2[3].toUpperCase(),
      zip:    m2[4].trim(),
    };
  }

  // "STREET, CITY, ST" — no ZIP
  const m3 = cleaned.match(/^(.+?),\s*(.+?),\s*([A-Za-z]{2})\s*$/);
  if (m3) {
    return {
      street: m3[1].trim() || null,
      city:   m3[2].trim() || null,
      state:  m3[3].toUpperCase(),
      zip:    null,
    };
  }

  // Couldn't split — keep full string as street; try to salvage state + zip
  const zipMatch   = cleaned.match(/\b(\d{5}(?:-\d{4})?)\b/);
  const stateMatch = cleaned.match(/\b([A-Z]{2})\b/);
  return {
    street: cleaned || null,
    city:   null,
    state:  stateMatch ? stateMatch[1] : null,
    zip:    zipMatch   ? zipMatch[1]   : null,
  };
}
