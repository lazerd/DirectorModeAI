/**
 * QR Check-In — findings, not a dashboard.
 *
 * A handful of sentences a director can act on or take to a board meeting:
 * "Courts 1–4 were full 92% of prime time last week; Courts 7–8 sat empty 60%
 * of it." Each finding has a sample-size floor so nothing fires on three
 * check-ins, and a weight so the strongest leads.
 *
 * Pure. Instants in, club-local reasoning via the zone passed in.
 */

import { formatInTimeZone } from 'date-fns-tz';
import { localToUtc } from '@/lib/courtsheet/timezones';

const MIN = 60_000;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type InsightSession = {
  spaceId: string;
  kind: string; // court | pool | room | other
  startedAt: number;
  endedAt: number;
  playType: string;
  playerCount: number;
  guestCount: number;
  endReason: string | null;
};

export type InsightWait = {
  joinedAt: number;
  offeredAt: number | null;
  status: string;
};

export type Finding = { key: string; headline: string; detail: string; weight: number };

const pct = (x: number) => `${Math.round(x * 100)}%`;

function hourLabel(h: number): string {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour} ${suffix}`;
}

/** "Courts 1–4", "Courts 2, 5 and 7", "Court 3", or plain names. */
export function courtsLabel(names: string[]): string {
  const nums = names.map((n) => /(\d+)\s*$/.exec(n)?.[1]).map((n) => (n ? parseInt(n, 10) : NaN));
  if (names.length === 1) return names[0];
  if (nums.every((n) => !Number.isNaN(n))) {
    const sorted = [...nums].sort((a, b) => a - b);
    const consecutive = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
    if (consecutive) return `Courts ${sorted[0]}–${sorted[sorted.length - 1]}`;
    return `Courts ${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function localDates(now: number, tz: string, days: number): string[] {
  const out: string[] = [];
  for (let i = days; i >= 1; i -= 1) {
    // Noon-anchored so a DST day never lands on the wrong date.
    const noonToday = localToUtc(formatInTimeZone(now, tz, 'yyyy-MM-dd'), '12:00', tz).getTime();
    out.push(formatInTimeZone(noonToday - i * 24 * 3600_000, tz, 'yyyy-MM-dd'));
  }
  return out;
}

export function findings(opts: {
  now: number;
  timezone: string;
  primeStart: string;
  primeEnd: string;
  courts: { id: string; name: string }[];
  sessions: InsightSession[];
  waits: InsightWait[];
}): Finding[] {
  const { now, timezone: tz } = opts;
  const out: Finding[] = [];
  const courtSessions = opts.sessions.filter((s) => s.kind === 'court');

  /* 1. prime-time use by court, last 7 full days */
  const dates = localDates(now, tz, 7);
  const windows = dates.map((d) => [localToUtc(d, opts.primeStart, tz).getTime(), localToUtc(d, opts.primeEnd, tz).getTime()] as const);
  const windowTotal = windows.reduce((n, [a, b]) => n + Math.max(0, b - a), 0);
  const weekStart = windows[0]?.[0] ?? now;
  const weekSessions = courtSessions.filter((s) => s.endedAt > weekStart);
  if (windowTotal > 0 && weekSessions.length >= 10 && opts.courts.length >= 2) {
    const util = opts.courts.map((c) => {
      let used = 0;
      for (const s of weekSessions.filter((x) => x.spaceId === c.id)) {
        for (const [a, b] of windows) used += Math.max(0, Math.min(b, s.endedAt) - Math.max(a, s.startedAt));
      }
      return { name: c.name, u: Math.min(1, used / windowTotal) };
    });
    const busy = util.filter((x) => x.u >= 0.7);
    const quiet = util.filter((x) => x.u <= 0.4);
    const avg = (xs: { u: number }[]) => xs.reduce((n, x) => n + x.u, 0) / xs.length;
    const prime = `${hourLabel(parseInt(opts.primeStart, 10))}–${hourLabel(parseInt(opts.primeEnd, 10))}`;
    let headline: string | null = null;
    if (busy.length && quiet.length) {
      headline = `${courtsLabel(busy.map((x) => x.name))} ${busy.length === 1 ? 'was' : 'were'} full ${pct(avg(busy))} of prime time last week; ${courtsLabel(quiet.map((x) => x.name))} sat empty ${pct(1 - avg(quiet))} of it.`;
    } else if (busy.length === util.length) {
      headline = `Every court was in use ${pct(avg(util))} of prime time last week.`;
    } else if (busy.length) {
      headline = `${courtsLabel(busy.map((x) => x.name))} ${busy.length === 1 ? 'was' : 'were'} full ${pct(avg(busy))} of prime time last week.`;
    } else if (quiet.length) {
      headline = `${courtsLabel(quiet.map((x) => x.name))} sat empty ${pct(1 - avg(quiet))} of prime time last week.`;
    }
    if (headline) {
      out.push({
        key: 'prime',
        headline,
        detail: `Prime time is ${prime}. From ${weekSessions.length} walk-on check-ins over the last 7 days — the usage numbers a resurfacing or scheduling case needs.`,
        weight: 100,
      });
    }
  }

  /* 2. the worst time to be waiting, last 30 days */
  const monthAgo = now - 30 * 24 * 3600_000;
  const served = opts.waits.filter((w) => w.offeredAt !== null && w.joinedAt >= monthAgo);
  if (served.length >= 5) {
    const buckets = new Map<string, { dow: number; hour: number; mins: number[] }>();
    for (const w of served) {
      const dow = parseInt(formatInTimeZone(w.joinedAt, tz, 'i'), 10) % 7; // ISO 1=Mon..7=Sun -> 0=Sun
      const hour = parseInt(formatInTimeZone(w.joinedAt, tz, 'H'), 10);
      const key = `${dow}-${hour}`;
      const b = buckets.get(key) ?? { dow, hour, mins: [] };
      b.mins.push((w.offeredAt! - w.joinedAt) / MIN);
      buckets.set(key, b);
    }
    const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
    const worst = [...buckets.values()].filter((b) => b.mins.length >= 3).sort((a, b) => mean(b.mins) - mean(a.mins))[0];
    const overall = mean(served.map((w) => (w.offeredAt! - w.joinedAt) / MIN));
    if (worst && mean(worst.mins) >= 5) {
      out.push({
        key: 'wait',
        headline: `Average wait on ${DAY_NAMES[worst.dow]} ${hourLabel(worst.hour)}: ${Math.round(mean(worst.mins))} min.`,
        detail: `${worst.mins.length} groups waited in that hour over the last 30 days. Across all times the average wait was ${Math.round(overall)} min.`,
        weight: mean(worst.mins) >= 10 ? 90 : 50,
      });
    }
  }

  /* 3. offers nobody came for */
  const offered = opts.waits.filter((w) => w.offeredAt !== null && w.joinedAt >= monthAgo);
  const missed = offered.filter((w) => w.status === 'missed');
  if (offered.length >= 8 && missed.length >= 3 && missed.length / offered.length >= 0.2) {
    out.push({
      key: 'missed',
      headline: `${missed.length} of ${offered.length} court offers went unclaimed this month.`,
      detail: 'Those courts sat held for someone who did not come. A longer claim window, or asking for an email on the wait list, gets more of them played.',
      weight: 60,
    });
  }

  /* 4. time limits actually enforced, last 7 days */
  const bumped = courtSessions.filter((s) => s.endedAt > now - 7 * 24 * 3600_000 && (s.endReason === 'limit' || s.endReason === 'bumped'));
  if (bumped.length >= 3) {
    out.push({
      key: 'limits',
      headline: `Time limits kicked in ${bumped.length} times last week.`,
      detail: 'Each one is a group asked to come off so a waiting group could play — demand the courts could not absorb.',
      weight: 55,
    });
  }

  /* 5. pool guests, the latest month with visits */
  const visits = opts.sessions.filter((s) => s.kind !== 'court');
  if (visits.length) {
    const thisMonth = formatInTimeZone(now, tz, 'yyyy-MM');
    const byMonth = new Map<string, InsightSession[]>();
    for (const v of visits) {
      const m = formatInTimeZone(v.startedAt, tz, 'yyyy-MM');
      byMonth.set(m, [...(byMonth.get(m) ?? []), v]);
    }
    const months = [...byMonth.keys()].sort();
    const complete = months.filter((m) => m < thisMonth);
    const month = complete.length ? complete[complete.length - 1] : thisMonth;
    const rows = byMonth.get(month) ?? [];
    const guests = rows.reduce((n, r) => n + r.guestCount, 0);
    if (rows.length >= 5 && guests > 0) {
      const monthName = formatInTimeZone(localToUtc(`${month}-15`, '12:00', tz), tz, 'MMMM');
      const byDay = new Map<string, number>();
      for (const r of rows) {
        const d = formatInTimeZone(r.startedAt, tz, 'yyyy-MM-dd');
        byDay.set(d, (byDay.get(d) ?? 0) + r.guestCount);
      }
      const [peakDay, peakGuests] = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
      out.push({
        key: 'guests',
        headline: `Pool: ${guests} guest visit${guests === 1 ? '' : 's'} in ${monthName}${month === thisMonth ? ' so far' : ''}.`,
        detail: `From ${rows.length} member check-ins. Busiest day ${formatInTimeZone(localToUtc(peakDay, '12:00', tz), tz, 'EEE MMM d')} with ${peakGuests} guests. The export has every name for guest-fee billing.`,
        weight: 80,
      });
    }
  }

  /* 6. when play starts */
  const recent = courtSessions.filter((s) => s.startedAt >= monthAgo);
  if (recent.length >= 20) {
    const byHour = new Map<number, number>();
    for (const s of recent) {
      const h = parseInt(formatInTimeZone(s.startedAt, tz, 'H'), 10);
      byHour.set(h, (byHour.get(h) ?? 0) + 1);
    }
    const [hour, n] = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push({
      key: 'peak',
      headline: `The rush is ${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}: ${pct(n / recent.length)} of walk-on play starts then.`,
      detail: `From ${recent.length} court check-ins over the last 30 days.`,
      weight: 40,
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}
