/**
 * CalendarMode — outdoor playability by month and region.
 *
 * A year plan lives or dies on weather, but a forecast API is useless at this
 * horizon: nobody knows what October 17th next year looks like, and paying for
 * an API to tell us "October in Orinda is nice" would be spending money to
 * learn a climate normal. So this is a lookup table of climate normals —
 * deterministic, free, offline, and honest about what it is.
 *
 * `playability` is 0-1: the share of an average day that month you'd expect to
 * be comfortably playable outdoors. It folds together rain, cold, and heat, so
 * Phoenix in July scores low for the same reason Minneapolis in January does.
 *
 * Region is derived from state + latitude. This file deliberately takes lat/lng
 * as plain numbers rather than importing src/lib/geo.ts, which pulls in a
 * ~900KB ZIP-centroid table — callers resolve the ZIP and pass the result in.
 */

export type ClimateRegion =
  | 'pacific-northwest'
  | 'california-coastal'
  | 'california-inland'
  | 'southwest-desert'
  | 'mountain-west'
  | 'northern-plains'
  | 'midwest'
  | 'northeast'
  | 'mid-atlantic'
  | 'southeast'
  | 'gulf-coast'
  | 'florida'
  | 'texas'
  | 'hawaii'
  | 'alaska';

/** Jan..Dec playability, 0-1. */
const NORMALS: Record<ClimateRegion, number[]> = {
  // Wet Oct-Apr; glorious short summer.
  'pacific-northwest':  [0.25, 0.30, 0.40, 0.55, 0.75, 0.85, 0.95, 0.95, 0.80, 0.50, 0.30, 0.22],
  // The reason clubs here run year-round. Winter rain is the only real dent.
  'california-coastal': [0.65, 0.68, 0.80, 0.90, 0.95, 0.98, 0.98, 0.98, 0.97, 0.92, 0.78, 0.65],
  // Same mild winters, but July/Aug afternoons push 100°F.
  'california-inland':  [0.60, 0.65, 0.80, 0.92, 0.95, 0.90, 0.80, 0.80, 0.88, 0.92, 0.75, 0.60],
  // Winter is peak season; summer midday is unplayable.
  'southwest-desert':   [0.85, 0.92, 0.98, 0.95, 0.80, 0.55, 0.40, 0.42, 0.65, 0.92, 0.92, 0.85],
  'mountain-west':      [0.20, 0.25, 0.40, 0.60, 0.80, 0.92, 0.95, 0.95, 0.85, 0.62, 0.35, 0.20],
  'northern-plains':    [0.08, 0.12, 0.30, 0.55, 0.80, 0.92, 0.95, 0.93, 0.82, 0.55, 0.25, 0.10],
  'midwest':            [0.12, 0.18, 0.38, 0.62, 0.85, 0.92, 0.93, 0.92, 0.85, 0.65, 0.35, 0.15],
  'northeast':          [0.10, 0.15, 0.35, 0.60, 0.85, 0.93, 0.95, 0.93, 0.88, 0.70, 0.38, 0.15],
  'mid-atlantic':       [0.25, 0.30, 0.50, 0.75, 0.90, 0.92, 0.85, 0.85, 0.90, 0.82, 0.55, 0.30],
  'southeast':          [0.50, 0.58, 0.75, 0.90, 0.92, 0.82, 0.72, 0.72, 0.85, 0.92, 0.75, 0.55],
  'gulf-coast':         [0.60, 0.65, 0.80, 0.88, 0.82, 0.68, 0.58, 0.58, 0.70, 0.88, 0.82, 0.65],
  'florida':            [0.85, 0.90, 0.92, 0.92, 0.85, 0.68, 0.62, 0.62, 0.70, 0.85, 0.90, 0.88],
  'texas':              [0.62, 0.68, 0.85, 0.90, 0.85, 0.70, 0.58, 0.55, 0.72, 0.90, 0.82, 0.68],
  'hawaii':             [0.85, 0.85, 0.88, 0.90, 0.92, 0.95, 0.95, 0.95, 0.93, 0.90, 0.85, 0.82],
  'alaska':             [0.05, 0.08, 0.15, 0.35, 0.65, 0.85, 0.88, 0.82, 0.60, 0.30, 0.10, 0.05],
};

const REGION_LABELS: Record<ClimateRegion, string> = {
  'pacific-northwest': 'the Pacific Northwest',
  'california-coastal': 'coastal California',
  'california-inland': 'inland California',
  'southwest-desert': 'the desert Southwest',
  'mountain-west': 'the Mountain West',
  'northern-plains': 'the northern Plains',
  midwest: 'the Midwest',
  northeast: 'the Northeast',
  'mid-atlantic': 'the Mid-Atlantic',
  southeast: 'the Southeast',
  'gulf-coast': 'the Gulf Coast',
  florida: 'Florida',
  texas: 'Texas',
  hawaii: 'Hawaii',
  alaska: 'Alaska',
};

const BY_STATE: Record<string, ClimateRegion> = {
  WA: 'pacific-northwest', OR: 'pacific-northwest',
  ID: 'mountain-west', MT: 'mountain-west', WY: 'mountain-west',
  UT: 'mountain-west', CO: 'mountain-west', NV: 'mountain-west',
  AZ: 'southwest-desert', NM: 'southwest-desert',
  ND: 'northern-plains', SD: 'northern-plains', MN: 'northern-plains', NE: 'northern-plains',
  IA: 'midwest', WI: 'midwest', MI: 'midwest', IL: 'midwest', IN: 'midwest',
  OH: 'midwest', MO: 'midwest', KS: 'midwest',
  ME: 'northeast', NH: 'northeast', VT: 'northeast', MA: 'northeast',
  RI: 'northeast', CT: 'northeast', NY: 'northeast', PA: 'northeast', NJ: 'northeast',
  DE: 'mid-atlantic', MD: 'mid-atlantic', DC: 'mid-atlantic', VA: 'mid-atlantic',
  WV: 'mid-atlantic', KY: 'mid-atlantic',
  NC: 'southeast', SC: 'southeast', GA: 'southeast', TN: 'southeast', AR: 'southeast',
  AL: 'gulf-coast', MS: 'gulf-coast', LA: 'gulf-coast',
  FL: 'florida',
  TX: 'texas',
  OK: 'texas',
  HI: 'hawaii',
  AK: 'alaska',
  CA: 'california-coastal', // refined by longitude below
};

/**
 * Best-guess region for a club. State is the primary signal; lat/lng refines
 * the two places a state border genuinely spans climates (California's coast
 * vs. Central Valley, and the Texas/Gulf line).
 */
export function regionFor(
  state: string | null | undefined,
  loc?: { lat: number; lng: number } | null,
): ClimateRegion | null {
  const st = (state || '').trim().toUpperCase().slice(0, 2);
  let region = BY_STATE[st] ?? null;

  if (region === 'california-coastal' && loc) {
    // Roughly the Coast Ranges. East of about -121.5 is Central Valley and
    // beyond; south of 35 and inland is high desert.
    if (loc.lng > -121.0) region = 'california-inland';
    if (loc.lng > -117.5 && loc.lat < 35.5) region = 'southwest-desert';
  }

  // Fall back to latitude bands when the state is unknown but we have a fix.
  if (!region && loc) {
    if (loc.lat >= 44) region = 'northern-plains';
    else if (loc.lat >= 40) region = 'northeast';
    else if (loc.lat >= 36) region = 'mid-atlantic';
    else if (loc.lat >= 30) region = 'southeast';
    else region = 'gulf-coast';
  }

  return region;
}

/** Outdoor playability, 0-1, for a month (1-12) in a region. */
export function playability(region: ClimateRegion | null, month: number): number {
  if (!region) return 1; // No location on file — don't penalise anything.
  const row = NORMALS[region];
  if (!row) return 1;
  return row[Math.min(12, Math.max(1, month)) - 1] ?? 1;
}

export function regionLabel(region: ClimateRegion): string {
  return REGION_LABELS[region] ?? region;
}

/** The months a region is comfortably outdoor-viable (playability ≥ 0.7). */
export function outdoorMonths(region: ClimateRegion | null): number[] {
  if (!region) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  return NORMALS[region].map((v, i) => (v >= 0.7 ? i + 1 : 0)).filter(Boolean);
}
