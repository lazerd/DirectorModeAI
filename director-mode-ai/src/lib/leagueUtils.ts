/**
 * Small helpers shared across the league feature:
 *  - slug generation from a league name
 *  - secure token generation for magic links
 *  - category key ↔ label mapping
 *  - flight-assignment algorithm (16s first, then 8s, then waitlist)
 */

import { randomBytes } from 'crypto';

export type CategoryKey = 'men_singles' | 'men_doubles' | 'women_singles' | 'women_doubles';

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  men_singles: "Men's Singles",
  men_doubles: "Men's Doubles",
  women_singles: "Women's Singles",
  women_doubles: "Women's Doubles",
};

export const CATEGORY_ORDER: CategoryKey[] = [
  'men_singles',
  'women_singles',
  'men_doubles',
  'women_doubles',
];

export function isDoubles(key: CategoryKey): boolean {
  return key === 'men_doubles' || key === 'women_doubles';
}

/**
 * Slugify a league name into a URL-safe identifier.
 * "Lamorinda Summer 2026" → "lamorinda-summer-2026"
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Generate a URL-safe random token for magic links. 32 hex chars =
 * 128 bits of entropy, plenty for confirmation / dispute links.
 */
export function generateToken(): string {
  return randomBytes(16).toString('hex');
}

export type FlightAssignment = {
  flights: Array<{ name: string; size: 8 | 16; entryIds: string[] }>;
  waitlistEntryIds: string[];
  cancelled: boolean;
};

/**
 * Given an already-seeded (sorted) list of entry ids for a single category,
 * compute which flights get created and which entries waitlist.
 *
 *   - Under 8 entries → cancelled (all waitlisted until refunded)
 *   - Fill 16-player flights first (A, B, C…)
 *   - If 8+ leftover, one 8-player flight gets the next 8
 *   - Anything after that goes to waitlist
 *
 * Matches the rule locked in during design:
 *   8     → [8]
 *   10    → [8] + 2 waitlist
 *   16    → [16]
 *   17    → [16] + 1 waitlist
 *   24    → [16, 8]
 *   25    → [16, 8] + 1 waitlist
 *   32    → [16, 16]
 *   40    → [16, 16, 8]
 *   48    → [16, 16, 16]
 */
export function assignEntriesToFlights(
  seededEntryIds: string[]
): FlightAssignment {
  const n = seededEntryIds.length;

  if (n < 8) {
    return { flights: [], waitlistEntryIds: [...seededEntryIds], cancelled: true };
  }

  const flights: Array<{ name: string; size: 8 | 16; entryIds: string[] }> = [];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let cursor = 0;
  let flightIndex = 0;

  // Fill as many 16-player flights as possible.
  while (n - cursor >= 16) {
    flights.push({
      name: letters[flightIndex],
      size: 16,
      entryIds: seededEntryIds.slice(cursor, cursor + 16),
    });
    cursor += 16;
    flightIndex += 1;
  }

  const remainder = n - cursor;

  // If 8+ leftover, one more flight (8-player).
  if (remainder >= 8) {
    flights.push({
      name: letters[flightIndex],
      size: 8,
      entryIds: seededEntryIds.slice(cursor, cursor + 8),
    });
    cursor += 8;
    flightIndex += 1;
  }

  // Anything left over waitlists.
  const waitlistEntryIds = seededEntryIds.slice(cursor);

  return { flights, waitlistEntryIds, cancelled: false };
}

/**
 * Format a payment rail (Venmo, Zelle, Stripe) for human display on the
 * public signup page.
 */
export function formatMoney(cents: number): string {
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(2)}`;
}
