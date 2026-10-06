// Director Pulse — the give-to-get pay & pricing exchange.
//
// A pro shares their own pay, lesson rate, split with the club, clinic pricing
// and so on; once they have, they see everyone else's — as blinded statistics,
// never rows. Same privacy rules as the public 990 view (aggregate.ts): any
// group under MIN_GROUP_SIZE is withheld, and published figures are rounded so
// a number can't be matched back to one submission.

import { MIN_GROUP_SIZE, percentile } from './aggregate';

export const ROLES = ['Director', 'Head Pro', 'Staff Pro'] as const;
export const CLUB_TYPES = [
  'Private country club', 'Private racquet club', 'Athletic / commercial club', 'Public / municipal', 'HOA / resort',
] as const;
export const SIZE_BANDS = ['Under 300 households', '300–600', '600–1,000', '1,000+'] as const;
export const YEARS_BANDS = ['Under 5 yrs', '5–10 yrs', '10–20 yrs', '20+ yrs'] as const;
export const EMPLOYMENT = ['W-2 salaried', 'W-2 hourly', '1099 / independent'] as const;
export const CLINIC_PAY_MODELS = ['percent', 'hourly', 'included'] as const;
export const STRINGING = ['pro', 'club', 'split', 'none'] as const;
export const REGIONS = ['Northeast', 'South', 'Midwest', 'West'] as const;

const REGION_OF: Record<string, string> = {};
for (const s of 'CT ME MA NH RI VT NJ NY PA'.split(' ')) REGION_OF[s] = 'Northeast';
for (const s of 'IL IN MI OH WI IA KS MN MO NE ND SD'.split(' ')) REGION_OF[s] = 'Midwest';
for (const s of 'DE FL GA MD NC SC VA DC WV AL KY MS TN AR LA OK TX'.split(' ')) REGION_OF[s] = 'South';
for (const s of 'AZ CO ID MT NV NM UT WY AK CA HI OR WA'.split(' ')) REGION_OF[s] = 'West';

export type PulseRow = {
  role: string; club_type: string; size_band: string | null; state: string | null; region: string | null;
  years_band: string | null; employment: string | null;
  base_salary: number | null; bonus: number | null; total_income: number | null;
  private_rate: number | null; private_share_pct: number | null;
  clinic_price_hr: number | null; clinic_pay_model: string | null; clinic_pay_value: number | null;
  junior_price_hr: number | null; stringing: string | null; teaching_hours_wk: number | null;
  health_insurance: boolean | null; retirement_match: boolean | null;
};

// Each numeric field with a plausibility range. Out of range → dropped (null),
// so a typo like an extra zero can't drag a median.
const NUMERIC: Record<string, [number, number]> = {
  base_salary: [0, 1_500_000],
  bonus: [0, 1_000_000],
  total_income: [1_000, 3_000_000],
  private_rate: [20, 1_000],
  private_share_pct: [0, 100],
  clinic_price_hr: [5, 500],
  clinic_pay_value: [0, 500],
  junior_price_hr: [5, 500],
  teaching_hours_wk: [0, 80],
};

const oneOf = <T extends readonly string[]>(list: T, v: unknown): T[number] | null =>
  (list as readonly string[]).includes(String(v)) ? (String(v) as T[number]) : null;

function num(v: unknown, [lo, hi]: [number, number]): number | null {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return Math.round(n);
}

const bool = (v: unknown) => (v === true || v === 'yes' ? true : v === false || v === 'no' ? false : null);

/** Validate a submitted form into a storable row, or explain what's missing. */
export function normalizePulse(b: Record<string, unknown>): { row: PulseRow } | { error: string } {
  const role = oneOf(ROLES, b.role);
  const club_type = oneOf(CLUB_TYPES, b.club_type);
  if (!role) return { error: 'Pick your role.' };
  if (!club_type) return { error: 'Pick your club type.' };
  const state = typeof b.state === 'string' && /^[A-Za-z]{2}$/.test(b.state.trim()) ? b.state.trim().toUpperCase() : null;

  const row: PulseRow = {
    role, club_type,
    size_band: oneOf(SIZE_BANDS, b.size_band),
    state,
    region: state ? REGION_OF[state] ?? null : null,
    years_band: oneOf(YEARS_BANDS, b.years_band),
    employment: oneOf(EMPLOYMENT, b.employment),
    base_salary: num(b.base_salary, NUMERIC.base_salary),
    bonus: num(b.bonus, NUMERIC.bonus),
    total_income: num(b.total_income, NUMERIC.total_income),
    private_rate: num(b.private_rate, NUMERIC.private_rate),
    private_share_pct: num(b.private_share_pct, NUMERIC.private_share_pct),
    clinic_price_hr: num(b.clinic_price_hr, NUMERIC.clinic_price_hr),
    clinic_pay_model: oneOf(CLINIC_PAY_MODELS, b.clinic_pay_model),
    clinic_pay_value: num(b.clinic_pay_value, NUMERIC.clinic_pay_value),
    junior_price_hr: num(b.junior_price_hr, NUMERIC.junior_price_hr),
    stringing: oneOf(STRINGING, b.stringing),
    teaching_hours_wk: num(b.teaching_hours_wk, NUMERIC.teaching_hours_wk),
    health_insurance: bool(b.health_insurance),
    retirement_match: bool(b.retirement_match),
  };
  if (row.clinic_pay_model === 'included') row.clinic_pay_value = null;
  if (row.clinic_pay_model === 'percent' && row.clinic_pay_value != null && row.clinic_pay_value > 100) row.clinic_pay_value = null;

  // Give-to-get only works if people actually give: require the two numbers
  // everyone wants to see.
  if (row.total_income == null) return { error: 'Add your total annual income (a rough number is fine).' };
  if (row.private_rate == null) return { error: 'Add your private lesson rate.' };
  return { row };
}

// ---------- aggregation ----------

type Unit = 'usd' | 'rate' | 'pct' | 'hours';

export const METRICS: { key: keyof PulseRow; label: string; unit: Unit; where?: (r: PulseRow) => boolean }[] = [
  { key: 'total_income', label: 'Total annual income', unit: 'usd' },
  { key: 'base_salary', label: 'Base salary', unit: 'usd' },
  { key: 'bonus', label: 'Bonus', unit: 'usd' },
  { key: 'private_rate', label: 'Private lesson rate (60 min)', unit: 'rate' },
  { key: 'private_share_pct', label: 'Pro keeps of the private fee', unit: 'pct' },
  { key: 'clinic_price_hr', label: 'Adult clinic, per player/hour', unit: 'rate' },
  { key: 'clinic_pay_value', label: 'Clinic pay (percent model)', unit: 'pct', where: (r) => r.clinic_pay_model === 'percent' },
  { key: 'clinic_pay_value', label: 'Clinic pay (hourly model)', unit: 'rate', where: (r) => r.clinic_pay_model === 'hourly' },
  { key: 'junior_price_hr', label: 'Junior program, per player/hour', unit: 'rate' },
  { key: 'teaching_hours_wk', label: 'Teaching hours / week', unit: 'hours' },
];

// Salaries round to $1k; prices to $5; percents and hours to whole numbers.
function roundFor(unit: Unit, n: number) {
  if (unit === 'usd') return Math.round(n / 1000) * 1000;
  if (unit === 'rate') return Math.round(n / 5) * 5;
  return Math.round(n);
}

export type Stat = { n: number; median: number; p25: number; p75: number };
export type MetricResult = {
  key: string; label: string; unit: Unit;
  stat: Stat | null;         // null = locked (fewer than MIN_GROUP_SIZE)
  have: number;              // how many answers exist (shown as "3 of 5 to unlock")
  mine: number | null;
  myPercentile: number | null;
};

export function statOf(values: number[], unit: Unit, minN = MIN_GROUP_SIZE): Stat | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < minN) return null;
  return {
    n: v.length,
    median: roundFor(unit, percentile(v, 50)),
    p25: roundFor(unit, percentile(v, 25)),
    p75: roundFor(unit, percentile(v, 75)),
  };
}

/** Share of group below the caller's value, 0–100, rounded to 5 so it can't pin a rank. */
function percentileOf(values: number[], mine: number) {
  const below = values.filter((x) => x < mine).length;
  const equal = values.filter((x) => x === mine).length;
  return Math.round(((below + equal / 2) / values.length) * 20) * 5;
}

export type MixResult = { label: string; n: number; shares: { value: string; pct: number }[] | null };

function mix(rows: PulseRow[], label: string, pick: (r: PulseRow) => string | null, minN = MIN_GROUP_SIZE): MixResult {
  const vals = rows.map(pick).filter((x): x is string => !!x);
  if (vals.length < minN) return { label, n: vals.length, shares: null };
  const counts = new Map<string, number>();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  return {
    label, n: vals.length,
    shares: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, c]) => ({ value, pct: Math.round((c / vals.length) * 100) })),
  };
}

export type Breakdown = {
  by: 'role' | 'region' | 'club_type';
  metric: string;
  unit: Unit;
  cells: { group: string; stat: Stat | null }[];
};

export type PulseResults = {
  contributors: number;
  metrics: MetricResult[];
  mixes: MixResult[];
  breakdowns: Breakdown[];
};

export function pulseResults(rows: PulseRow[], me: PulseRow | null, minN = MIN_GROUP_SIZE): PulseResults {
  const metrics: MetricResult[] = METRICS.map((m) => {
    const pool = m.where ? rows.filter(m.where) : rows;
    const values = pool.map((r) => r[m.key] as number | null).filter((x): x is number => x != null);
    const stat = statOf(values, m.unit, minN);
    const mineRaw = me && (!m.where || m.where(me)) ? (me[m.key] as number | null) : null;
    return {
      key: String(m.key), label: m.label, unit: m.unit, stat, have: values.length,
      mine: mineRaw,
      myPercentile: stat && mineRaw != null ? percentileOf(values, mineRaw) : null,
    };
  });

  const mixes = [
    mix(rows, 'Who keeps stringing revenue', (r) => r.stringing, minN),
    mix(rows, 'How clinics are paid', (r) => r.clinic_pay_model, minN),
    mix(rows, 'Employment type', (r) => r.employment, minN),
    mix(rows, 'Health insurance provided', (r) => (r.health_insurance == null ? null : r.health_insurance ? 'Yes' : 'No'), minN),
    mix(rows, 'Retirement match', (r) => (r.retirement_match == null ? null : r.retirement_match ? 'Yes' : 'No'), minN),
  ];

  const groupsFor = { role: ROLES, region: REGIONS, club_type: CLUB_TYPES } as const;
  const breakdowns: Breakdown[] = [];
  for (const by of ['role', 'region', 'club_type'] as const) {
    for (const [metric, unit] of [['total_income', 'usd'], ['private_rate', 'rate']] as const) {
      const cells = groupsFor[by].map((group) => ({
        group,
        stat: statOf(
          rows.filter((r) => r[by] === group).map((r) => r[metric]).filter((x): x is number => x != null),
          unit, minN,
        ),
      }));
      breakdowns.push({ by, metric, unit, cells: cells.filter((c) => c.stat) });
    }
  }

  return { contributors: rows.length, metrics, mixes, breakdowns: breakdowns.filter((b) => b.cells.length > 0) };
}
