import { describe, it, expect } from 'vitest';
import { usHolidays, easterSunday, slamWindows, travelDrag, holidayIndex } from './holidays';
import { dayOfWeek } from './dates';

describe('usHolidays', () => {
  it('places the fixed holidays', () => {
    const h = usHolidays(2027);
    expect(h.find((x) => x.key === 'independence')?.date).toBe('2027-07-04');
    expect(h.find((x) => x.key === 'christmas')?.date).toBe('2027-12-25');
    expect(h.find((x) => x.key === 'new-years-day')?.date).toBe('2027-01-01');
  });

  it('computes the floating holidays', () => {
    const h = usHolidays(2027);
    const memorial = h.find((x) => x.key === 'memorial')!;
    const labor = h.find((x) => x.key === 'labor')!;
    const thanksgiving = h.find((x) => x.key === 'thanksgiving')!;

    expect(memorial.date).toBe('2027-05-31');   // last Monday of May
    expect(labor.date).toBe('2027-09-06');      // first Monday of September
    expect(thanksgiving.date).toBe('2027-11-25'); // fourth Thursday of November

    expect(dayOfWeek(memorial.date)).toBe(1);
    expect(dayOfWeek(labor.date)).toBe(1);
    expect(dayOfWeek(thanksgiving.date)).toBe(4);
  });

  it('returns holidays in date order', () => {
    const dates = usHolidays(2027).map((h) => h.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('marks travel-heavy holidays more heavily than themed ones', () => {
    const h = holidayIndex(2027);
    const thanksgiving = h.get('2027-11-25')!;
    const valentines = h.get('2027-02-14')!;
    expect(thanksgiving.travelWeight).toBeGreaterThan(valentines.travelWeight);
  });
});

describe('easterSunday', () => {
  // Known values — the computus is easy to get subtly wrong.
  it('matches published dates', () => {
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2030)).toBe('2030-04-21');
  });

  it('always lands on a Sunday', () => {
    for (let y = 2026; y <= 2040; y++) expect(dayOfWeek(easterSunday(y))).toBe(0);
  });
});

describe('slamWindows', () => {
  it('returns all four in calendar order', () => {
    const w = slamWindows(2027);
    expect(w.map((x) => x.key)).toEqual(['australian', 'roland-garros', 'wimbledon', 'us-open']);
    for (let i = 1; i < w.length; i++) expect(w[i].start > w[i - 1].start).toBe(true);
  });

  it('puts each slam in its traditional month', () => {
    const w = slamWindows(2027);
    expect(w[0].start.slice(5, 7)).toBe('01');
    expect(w[1].start.slice(5, 7)).toBe('05');
    expect(['06', '07']).toContain(w[2].start.slice(5, 7));
    expect(['08', '09']).toContain(w[3].start.slice(5, 7));
  });

  it('never starts Wimbledon before June 24', () => {
    for (let y = 2026; y <= 2040; y++) {
      const wim = slamWindows(y).find((x) => x.key === 'wimbledon')!;
      expect(wim.start >= `${y}-06-24`).toBe(true);
      expect(dayOfWeek(wim.start)).toBe(1); // always a Monday
    }
  });
});

describe('travelDrag', () => {
  const h = usHolidays(2027);

  it('is highest on the holiday itself and decays outward', () => {
    const onDay = travelDrag('2027-11-25', h).drag;
    const twoOut = travelDrag('2027-11-27', h).drag;
    const wayOut = travelDrag('2027-11-05', h).drag;
    expect(onDay).toBeGreaterThan(twoOut);
    expect(twoOut).toBeGreaterThan(0);
    expect(wayOut).toBe(0);
  });

  it('names the holiday responsible', () => {
    expect(travelDrag('2027-11-26', h).cause?.key).toBe('thanksgiving');
  });

  it('reports no drag on an ordinary weekend', () => {
    const { drag, cause } = travelDrag('2027-10-16', h);
    expect(drag).toBe(0);
    expect(cause).toBeNull();
  });
});
