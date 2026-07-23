import { describe, it, expect } from 'vitest';
import { CATALOG, CATALOG_GROUPS, catalogEntry, filterCatalog } from './catalog';
import { resolveAnchor } from './anchors';
import { itemFromCatalog, resolveFormat, buildEventPayload, buildHolds, addMinutes } from './promote';
import { TOURNAMENT_FORMATS, MIXER_FORMATS } from '@/lib/eventCategory';
import { DEPARTMENTS, AUDIENCES, type PlanItem } from './types';

describe('catalog integrity', () => {
  it('has a substantial library', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(60);
  });

  it('has unique keys', () => {
    const keys = CATALOG.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses only known departments and audiences', () => {
    for (const c of CATALOG) {
      expect(DEPARTMENTS).toContain(c.department);
      for (const a of c.audience) expect(AUDIENCES).toContain(a);
    }
  });

  it('always has an audience', () => {
    for (const c of CATALOG) expect(c.audience.length).toBeGreaterThan(0);
  });

  // A format hint that isn't in the taxonomy would silently downgrade every
  // promote to a plain doubles mixer.
  it('only uses format hints the app actually understands', () => {
    for (const c of CATALOG) {
      if (!c.formatHint) continue;
      const known = TOURNAMENT_FORMATS.has(c.formatHint) || MIXER_FORMATS.has(c.formatHint);
      expect(known, `${c.key} has unknown format "${c.formatHint}"`).toBe(true);
    }
  });

  it('has anchor rules that resolve', () => {
    for (const c of CATALOG) {
      if (!c.anchor) continue;
      expect(resolveAnchor(c.anchor, 2027), `${c.key}: "${c.anchor}"`).not.toBeNull();
    }
  });

  it('has months in range', () => {
    for (const c of CATALOG) {
      for (const m of c.idealMonths) expect(m >= 1 && m <= 12, `${c.key}: month ${m}`).toBe(true);
    }
  });

  it('has an anchor consistent with its ideal months', () => {
    for (const c of CATALOG) {
      if (!c.anchor || c.idealMonths.length === 0) continue;
      const a = resolveAnchor(c.anchor, 2027)!;
      const anchorMonth = Number(a.date.slice(5, 7));
      expect(c.idealMonths, `${c.key} anchors to month ${anchorMonth}`).toContain(anchorMonth);
    }
  });

  it('has sane logistics', () => {
    for (const c of CATALOG) {
      expect(c.durationMinutes).toBeGreaterThanOrEqual(0);
      expect(c.courtsNeeded).toBeGreaterThanOrEqual(0);
      expect(c.staffNeeded).toBeGreaterThan(0);
      expect(c.typicalAttendance).toBeGreaterThan(0);
      expect(c.typicalFeeCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('has real prose everywhere', () => {
    for (const c of CATALOG) {
      expect(c.title.length, c.key).toBeGreaterThan(3);
      expect(c.tagline.length, c.key).toBeGreaterThan(8);
      expect(c.description.length, c.key).toBeGreaterThan(40);
    }
  });

  it('covers every department and the whole calendar year', () => {
    const depts = new Set(CATALOG.map((c) => c.department));
    expect(depts.has('tennis')).toBe(true);
    expect(depts.has('swim')).toBe(true);
    expect(depts.has('social')).toBe(true);
    expect(depts.has('pickleball')).toBe(true);

    for (let m = 1; m <= 12; m++) {
      const forMonth = CATALOG.filter((c) => c.idealMonths.length === 0 || c.idealMonths.includes(m));
      expect(forMonth.length, `month ${m} has no ideas`).toBeGreaterThan(0);
    }
  });

  it('includes the events a director would name unprompted', () => {
    for (const key of [
      'calcutta', 'stars-and-stripes-rr', 'parent-child-doubles',
      'wimbledon-mixer', 'australian-open-mixer', 'roland-garros-mixer', 'us-open-mixer',
      'member-guest', 'club-championships', 'turkey-shoot',
    ]) {
      expect(catalogEntry(key), key).not.toBeNull();
    }
  });

  it('lists every entry in exactly one group', () => {
    const grouped = CATALOG_GROUPS.flatMap((g) => g.keys);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(CATALOG.map((c) => c.key)));
  });

  it('flags the legal risk on the Calcutta', () => {
    const c = catalogEntry('calcutta')!;
    expect(c.tips.join(' ').toLowerCase()).toContain('law');
  });
});

describe('filterCatalog', () => {
  it('filters by department', () => {
    const swim = filterCatalog({ department: 'swim' });
    expect(swim.length).toBeGreaterThan(0);
    expect(swim.every((c) => c.department === 'swim')).toBe(true);
  });

  it('filters by audience, counting "all" as a match', () => {
    const junior = filterCatalog({ audience: 'junior' });
    expect(junior.every((c) => c.audience.includes('junior') || c.audience.includes('all'))).toBe(true);
  });

  it('includes month-agnostic entries when filtering by month', () => {
    const july = filterCatalog({ month: 7 });
    expect(july.some((c) => c.idealMonths.length === 0)).toBe(true);
    expect(july.every((c) => c.idealMonths.length === 0 || c.idealMonths.includes(7))).toBe(true);
  });

  it('searches free text', () => {
    expect(filterCatalog({ q: 'strawberries' }).map((c) => c.key)).toContain('wimbledon-mixer');
    expect(filterCatalog({ q: 'zzzznope' })).toHaveLength(0);
  });

  it('returns everything with no filter', () => {
    expect(filterCatalog()).toHaveLength(CATALOG.length);
  });
});

describe('promote', () => {
  function planItem(over: Partial<PlanItem> = {}): PlanItem {
    return {
      id: 'i1', title: 'Stars & Stripes RR', catalog_key: 'stars-and-stripes-rr',
      department: 'tennis', audience: ['family'], anchor_rule: null,
      target_date: '2027-07-03', target_end_date: null, duration_minutes: 240,
      courts_needed: 8, staff_needed: 4, expected_attendance: 72,
      expected_revenue_cents: 288000, effort: 'heavy', outdoor: true,
      idealMonths: [7], status: 'scheduled', ...over,
    };
  }

  it('builds a valid events payload', () => {
    const r = buildEventPayload({
      item: planItem(), userId: 'u1', clubId: 'c1', eventCode: 'ABC123', slug: 'stars-stripes-2027',
    });
    expect(r.ok).toBe(true);
    expect(r.event!.name).toBe('Stars & Stripes RR');
    expect(r.event!.event_date).toBe('2027-07-03');
    expect(r.event!.event_code).toBe('ABC123');
    expect(r.event!.num_courts).toBe(8);
    expect(r.event!.public_status).toBe('draft');
  });

  it('refuses to promote an undated item', () => {
    const r = buildEventPayload({
      item: planItem({ target_date: null }), userId: 'u1', clubId: 'c1', eventCode: 'X', slug: 'y',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('no date');
  });

  it('routes tournament formats to tournament mode and mixers to mixer mode', () => {
    expect(resolveFormat(planItem({ catalog_key: 'club-championships' })).mode).toBe('tournament');
    expect(resolveFormat(planItem({ catalog_key: 'wimbledon-mixer' })).mode).toBe('mixer');
  });

  it('falls back to a doubles mixer for an unknown hint rather than failing', () => {
    const r = resolveFormat(planItem({ catalog_key: null }));
    expect(r.format).toBe('doubles');
    expect(r.mode).toBe('mixer');
  });

  it('derives a plan item from a catalog key', () => {
    const raw = itemFromCatalog('calcutta', 'plan1', 'club1') as any;
    expect(raw.title).toBe('Calcutta Tournament & Auction');
    expect(raw.catalog_key).toBe('calcutta');
    expect(raw.status).toBe('idea');
    expect(raw.expected_revenue_cents).toBe(7500 * 48);
  });

  it('returns null for an unknown catalog key', () => {
    expect(itemFromCatalog('not-a-thing', 'p', 'c')).toBeNull();
  });

  describe('court holds', () => {
    it('writes one tentative hold per court per day', () => {
      const holds = buildHolds({
        item: planItem({ target_date: '2027-07-03', target_end_date: '2027-07-04' }),
        clubId: 'club1', courtIds: ['a', 'b', 'c'], createdBy: 'u1',
        startTime: '09:00', utcOffset: '-07:00',
      });
      expect(holds).toHaveLength(6);
      expect(holds.every((h) => h.status === 'tentative' && h.type === 'hold')).toBe(true);
      expect(holds.every((h) => h.source === 'calendar')).toBe(true);
    });

    it('computes start and end from the duration', () => {
      const [h] = buildHolds({
        item: planItem({ duration_minutes: 240 }), clubId: 'c', courtIds: ['a'],
        createdBy: 'u', startTime: '09:00', utcOffset: '-07:00',
      });
      expect(h.starts_at).toBe('2027-07-03T09:00:00-07:00');
      expect(h.ends_at).toBe('2027-07-03T13:00:00-07:00');
    });

    it('links back to the calendar item', () => {
      const [h] = buildHolds({
        item: planItem(), clubId: 'c', courtIds: ['a'], createdBy: 'u',
        startTime: '09:00', utcOffset: '-07:00',
      });
      expect(h.source_id).toBe('i1');
      expect(h.meta.calendar_item_id).toBe('i1');
    });

    it('produces nothing without a date or courts', () => {
      expect(buildHolds({ item: planItem({ target_date: null }), clubId: 'c', courtIds: ['a'], createdBy: 'u', startTime: '09:00', utcOffset: '-07:00' })).toHaveLength(0);
      expect(buildHolds({ item: planItem(), clubId: 'c', courtIds: [], createdBy: 'u', startTime: '09:00', utcOffset: '-07:00' })).toHaveLength(0);
    });

    it('rolls an evening event past midnight onto the next day', () => {
      const [h] = buildHolds({
        item: planItem({ duration_minutes: 240 }), clubId: 'c', courtIds: ['a'],
        createdBy: 'u', startTime: '21:00', utcOffset: '-07:00',
      });
      expect(h.starts_at).toBe('2027-07-03T21:00:00-07:00');
      expect(h.ends_at).toBe('2027-07-04T01:00:00-07:00');
    });
  });

  it('adds minutes with wrapping', () => {
    expect(addMinutes('09:00', 180)).toBe('12:00');
    expect(addMinutes('23:30', 60)).toBe('00:30');
    expect(addMinutes('09:05', 55)).toBe('10:00');
  });
});
