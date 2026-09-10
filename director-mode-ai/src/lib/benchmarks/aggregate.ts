// Public (logged-out) view of the 990 comp dataset: aggregates only.
//
// The raw rows name real directors next to their pay. It's public record, but
// the people reading ClubMode are those same directors, so logged-out visitors
// get medians and ranges — never a name, and never a group small enough to
// point at one person. Any group under MIN_GROUP_SIZE is dropped, not shown as
// "n=1". Signed-in users still get the full named table.

export const MIN_GROUP_SIZE = 5;
// The p90 of a small group is effectively its top earner, so only show it once
// the group is big enough to blur that.
const MIN_FOR_P90 = 10;

export type BenchmarkRow = {
  club: string; ein: string; state: string; region: string; dept: string;
  title: string; name: string; reported: number; other: number; total: number;
  revenue: number; pct: number | null; year: string; url: string; recent: boolean;
  zip?: string | null; lat?: number | null; lng?: number | null;
};

export type CompSummary = {
  n: number;
  median: number;
  p25: number;
  p75: number;
  p90: number | null;
  medPct: number | null;
};

export type CrossTab = {
  cols: readonly string[];
  rows: { label: string; cells: (CompSummary | null)[] }[];
  // Groups that had people but fewer than MIN_GROUP_SIZE — counted, not shown.
  hidden: number;
};

export const DEPT_KEYS = ['Tennis/Racquets', 'Golf', 'GM'] as const;
export const REGION_KEYS = ['Northeast', 'South', 'Midwest', 'West'] as const;
export const SIZE_BANDS = ['Under $5M', '$5–10M', '$10–20M', '$20M+'] as const;
export const CLUB_TYPES = ['Racquet club', 'Golf & country club', 'Other private club'] as const;

export function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

// Public figures are rounded so a published number can't be matched back to
// one filing's exact dollar amount.
const round1k = (n: number) => Math.round(n / 1000) * 1000;

/** Comp summary for a group, or null when the group is too small to publish. */
export function summarize(
  rows: Pick<BenchmarkRow, 'total' | 'pct'>[],
  minN = MIN_GROUP_SIZE,
): CompSummary | null {
  const totals = rows.map((r) => r.total).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (totals.length < minN) return null;
  const pcts = rows
    .map((r) => r.pct)
    .filter((x): x is number => x != null && Number.isFinite(x))
    .sort((a, b) => a - b);
  return {
    n: totals.length,
    median: round1k(percentile(totals, 50)),
    p25: round1k(percentile(totals, 25)),
    p75: round1k(percentile(totals, 75)),
    p90: totals.length >= MIN_FOR_P90 ? round1k(percentile(totals, 90)) : null,
    medPct: pcts.length >= minN ? pcts[Math.floor(pcts.length / 2)] : null,
  };
}

/** Club size by annual revenue (990 Part I). Unknown revenue → no band. */
export function clubSizeBand(revenue: number | null | undefined): string | null {
  if (!revenue || !(revenue > 0)) return null;
  if (revenue < 5_000_000) return SIZE_BANDS[0];
  if (revenue < 10_000_000) return SIZE_BANDS[1];
  if (revenue < 20_000_000) return SIZE_BANDS[2];
  return SIZE_BANDS[3];
}

/** Rough club type from the legal name — racquet words win over "country". */
export function clubType(club: string): string {
  if (/TENNIS|RACQUET|RACKET|SQUASH|PADDLE|PICKLEBALL/i.test(club)) return CLUB_TYPES[0];
  if (/GOLF|COUNTRY|\bC\.?C\.?\b|LINKS/i.test(club)) return CLUB_TYPES[1];
  return CLUB_TYPES[2];
}

/** Rows × departments grid of summaries; sub-threshold cells become null. */
export function crossTab<R extends Pick<BenchmarkRow, 'dept' | 'total' | 'pct'>>(
  rows: R[],
  rowOf: (r: R) => string | null,
  rowOrder: readonly string[],
  colOrder: readonly string[] = DEPT_KEYS,
): CrossTab {
  let hidden = 0;
  const out = rowOrder
    .map((label) => {
      const inRow = rows.filter((r) => rowOf(r) === label);
      const cells = colOrder.map((dept) => {
        const group = inRow.filter((r) => r.dept === dept);
        const s = summarize(group);
        if (!s && group.length > 0) hidden++;
        return s;
      });
      return { label, cells };
    })
    .filter((r) => r.cells.some(Boolean));
  return { cols: colOrder, rows: out, hidden };
}

export type PublicSnapshot = {
  people: number;
  clubs: number;
  overall: CompSummary | null;
  byRole: { dept: string; summary: CompSummary | null }[];
  byRegion: CrossTab;
  bySize: CrossTab;
  byType: CrossTab;
};

/**
 * Everything the logged-out /benchmarks page renders. Uses the latest filing
 * per club (the page's default "most recent" view). Contains no names, EINs,
 * club names or filing links — only counts and comp statistics.
 */
export function publicSnapshot(rows: BenchmarkRow[]): PublicSnapshot {
  const recent = rows.filter((r) => r.recent);
  return {
    people: recent.length,
    clubs: new Set(recent.map((r) => r.ein)).size,
    overall: summarize(recent),
    byRole: DEPT_KEYS.map((dept) => ({ dept, summary: summarize(recent.filter((r) => r.dept === dept)) })),
    byRegion: crossTab(recent, (r) => r.region, REGION_KEYS),
    bySize: crossTab(recent, (r) => clubSizeBand(r.revenue), SIZE_BANDS),
    byType: crossTab(recent, (r) => clubType(r.club), CLUB_TYPES),
  };
}
