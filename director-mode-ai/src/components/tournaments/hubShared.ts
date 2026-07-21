/**
 * Shared helpers for tournament HUB pages — a hub is any set of tournament
 * events that share a `hub_slug`, surfaced as one page with per-division
 * Standings / Enter / Draw links + printable QR posters. Used by both the
 * season-end hub and the generic /tournaments/hub/[slug] hub.
 */

export type HubEvent = {
  id: string;
  name: string;
  slug: string | null;
  match_format: string | null;
  public_status: string | null;
  event_date?: string | null;
};

export const HUB_FORMAT_LABELS: Record<string, string> = {
  'rr-singles': 'Round Robin',
  'rr-doubles': 'Round Robin — Doubles',
  'compass-singles': 'Compass Draw',
  'compass-doubles': 'Compass Draw — Doubles',
  'single-elim-singles': 'Single Elimination',
  'single-elim-doubles': 'Single Elimination — Doubles',
  'fmlc-singles': 'First-Match Consolation',
  'ffic-singles': 'Full Feed-In',
  'quads': 'Quads',
};

/** Sort youngest → oldest → open for junior brackets; otherwise stable by name. */
export function hubSortKey(name: string): number {
  if (/10U/i.test(name)) return name.toLowerCase().includes('silver') ? 12 : 11;
  if (/12U/i.test(name)) return 20;
  if (/14U/i.test(name)) return 25;
  if (/16U/i.test(name)) return 28;
  if (/18U/i.test(name)) return 29;
  if (/13\s*&|13&O|13 ?& ?Over/i.test(name)) return 30;
  if (/open/i.test(name)) return 40;
  return 50;
}

/** "JTT 10U Season-End — Gold · Sleepy Hollow" → { title: "10U — Gold", venue: "Sleepy Hollow" } */
export function hubParseName(name: string): { title: string; venue: string | null } {
  const parts = name.split('·').map((s) => s.trim());
  const venue = parts.length > 1 ? parts[parts.length - 1] : null;
  let title = parts[0]
    .replace(/^JTT\s+/i, '')
    .replace(/\s*Season-End\s*(Tournament)?/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (title.endsWith('—')) title = title.slice(0, -1).trim();
  return { title: title || parts[0], venue };
}
