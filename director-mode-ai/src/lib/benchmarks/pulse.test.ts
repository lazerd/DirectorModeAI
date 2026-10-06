import { describe, it, expect } from 'vitest';
import { normalizePulse, pulseResults, statOf, type PulseRow } from './pulse';

const base = {
  role: 'Director', club_type: 'Private country club', state: 'ca',
  total_income: '185,000', private_rate: '$140', private_share_pct: '70%',
};

const ok = (over: Record<string, unknown> = {}) => {
  const r = normalizePulse({ ...base, ...over });
  if ('error' in r) throw new Error(r.error);
  return r.row;
};

describe('normalizePulse', () => {
  it('parses money/percent strings and derives region from state', () => {
    const r = ok();
    expect(r.total_income).toBe(185_000);
    expect(r.private_rate).toBe(140);
    expect(r.private_share_pct).toBe(70);
    expect(r.state).toBe('CA');
    expect(r.region).toBe('West');
  });

  it('requires role, club type, income and private rate', () => {
    expect(normalizePulse({ ...base, role: 'CEO' })).toHaveProperty('error');
    expect(normalizePulse({ ...base, club_type: '' })).toHaveProperty('error');
    expect(normalizePulse({ ...base, total_income: '' })).toHaveProperty('error');
    expect(normalizePulse({ ...base, private_rate: '' })).toHaveProperty('error');
  });

  it('drops implausible numbers instead of storing them', () => {
    const r = ok({ private_share_pct: 700, teaching_hours_wk: 200, bonus: -5 });
    expect(r.private_share_pct).toBeNull();
    expect(r.teaching_hours_wk).toBeNull();
    expect(r.bonus).toBeNull();
  });

  it('clears clinic pay value when clinics are included in salary', () => {
    expect(ok({ clinic_pay_model: 'included', clinic_pay_value: 40 }).clinic_pay_value).toBeNull();
  });
});

const rows = (n: number, over: Partial<PulseRow> = {}): PulseRow[] =>
  Array.from({ length: n }, (_, i) => ({
    ...ok(), total_income: 100_000 + i * 20_000, private_rate: 100 + i * 10, ...over,
  }));

describe('pulseResults', () => {
  it('shows results from the very first submission', () => {
    const res = pulseResults(rows(1), null);
    const income = res.metrics.find((m) => m.key === 'total_income')!;
    expect(income.stat).not.toBeNull();
    expect(income.stat!.n).toBe(1);
    expect(res.breakdowns.length).toBeGreaterThan(0);
  });

  it('rounds published figures', () => {
    const s = statOf([101_234, 120_000, 140_000, 160_000, 180_000], 'usd')!;
    expect(s.median).toBe(140_000);
    expect(s.p25 % 1000).toBe(0);
    expect(statOf([101, 112, 133, 144, 155], 'rate')!.median % 5).toBe(0);
  });

  it('places the caller in a percentile rounded to 5', () => {
    const all = rows(10);
    const me = all[9];
    const income = pulseResults(all, me).metrics.find((m) => m.key === 'total_income')!;
    expect(income.mine).toBe(me.total_income);
    expect(income.myPercentile! % 5).toBe(0);
    expect(income.myPercentile).toBeGreaterThanOrEqual(90);
  });

  it('breaks down only the groups that have answers', () => {
    const all = [...rows(5, { role: 'Director' }), ...rows(2, { role: 'Head Pro' })];
    const byRole = pulseResults(all, null).breakdowns.find((b) => b.by === 'role' && b.metric === 'total_income')!;
    expect(byRole.cells.map((c) => c.group)).toEqual(['Director', 'Head Pro']);
  });
});
