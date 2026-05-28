/**
 * CourtSheet AI — availability search.
 *
 * Set-based search for open court time. Used by the AI `query_availability`
 * tool and by other tools before they book.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Court, DayOfWeek, OperatingHours, Reservation } from './types';
import {
  enumerateDates,
  localDayOfWeek,
  localToUtc,
  timeToMinutes,
  minutesToTime,
  utcToLocalDate,
  utcToLocalTime,
} from './timezones';

export interface AvailabilityQuery {
  club_id: string;
  date_range: { start: string; end: string };
  /** Optional court filter. Numbers or names. */
  courts?: Array<number | string>;
  days_of_week?: DayOfWeek[];
  /** Optional time window to search within. */
  time_range?: { start: string; end: string };
  /** Filter by sport (matches courts.sports). */
  sport?: string;
  /** Minimum slot length in minutes (default 30). */
  min_minutes?: number;
}

export interface AvailabilitySlot {
  court_id: string;
  court_label: string;
  /** Club-local YYYY-MM-DD. */
  date: string;
  /** Club-local HH:MM. */
  start: string;
  end: string;
  /** UTC isos for callers that want them. */
  starts_at_utc: string;
  ends_at_utc: string;
  duration_minutes: number;
}

export interface AvailabilityContext {
  db: SupabaseClient<any, 'public', any>;
  club: {
    id: string;
    timezone: string;
    operating_hours: OperatingHours;
  };
  courts: Court[];
}

export async function availability(
  query: AvailabilityQuery,
  ctx: AvailabilityContext
): Promise<AvailabilitySlot[]> {
  const minMinutes = query.min_minutes ?? 30;

  const eligibleCourts = filterCourts(ctx.courts, query);
  if (eligibleCourts.length === 0) return [];

  const dates = filterDates(query, ctx.club.timezone);
  if (dates.length === 0) return [];

  // Single batched read of every reservation overlapping the search window.
  const minStartUtc = localToUtc(dates[0], '00:00', ctx.club.timezone).toISOString();
  const maxEndUtc = localToUtc(addOneDay(dates[dates.length - 1]), '00:00', ctx.club.timezone).toISOString();
  const courtIds = eligibleCourts.map((c) => c.id);

  const { data } = await ctx.db
    .from('reservations')
    .select('*')
    .eq('club_id', query.club_id)
    .neq('status', 'cancelled')
    .in('court_id', courtIds)
    .lt('starts_at', maxEndUtc)
    .gt('ends_at', minStartUtc);

  const reservations = (data ?? []) as Reservation[];

  // Group reservations by court_id + local date.
  const byCourtDate = new Map<string, Reservation[]>();
  for (const r of reservations) {
    const localDate = utcToLocalDate(r.starts_at, ctx.club.timezone);
    const key = `${r.court_id}|${localDate}`;
    const arr = byCourtDate.get(key) ?? [];
    arr.push(r);
    byCourtDate.set(key, arr);
  }

  // Walk each (court × date) and emit free gaps.
  const slots: AvailabilitySlot[] = [];
  for (const court of eligibleCourts) {
    const label = court.name ?? `Court ${court.number}`;
    for (const date of dates) {
      const windows = openWindowsForDate(date, ctx.club, query.time_range);
      const taken = (byCourtDate.get(`${court.id}|${date}`) ?? [])
        .map((r) => ({
          start: timeToMinutes(utcToLocalTime(r.starts_at, ctx.club.timezone)),
          end: timeToMinutes(utcToLocalTime(r.ends_at, ctx.club.timezone)),
        }))
        .sort((a, b) => a.start - b.start);

      for (const w of windows) {
        let cursor = w.openMin;
        for (const t of taken) {
          if (t.end <= w.openMin) continue;
          if (t.start >= w.closeMin) break;
          if (t.start > cursor) {
            const dur = Math.min(t.start, w.closeMin) - cursor;
            if (dur >= minMinutes) {
              slots.push(makeSlot(court, label, date, cursor, cursor + dur, ctx.club.timezone));
            }
          }
          cursor = Math.max(cursor, t.end);
        }
        if (cursor < w.closeMin) {
          const dur = w.closeMin - cursor;
          if (dur >= minMinutes) {
            slots.push(makeSlot(court, label, date, cursor, w.closeMin, ctx.club.timezone));
          }
        }
      }
    }
  }

  return slots;
}

function filterCourts(courts: Court[], q: AvailabilityQuery): Court[] {
  let out = courts.filter((c) => c.status === 'active');
  if (q.sport) out = out.filter((c) => c.sports.includes(q.sport!));
  if (q.courts && q.courts.length > 0) {
    out = out.filter((c) => q.courts!.some((ref) => c.number === ref || c.name === ref));
  }
  return out;
}

function filterDates(q: AvailabilityQuery, timezone: string): string[] {
  const all = enumerateDates(q.date_range.start, q.date_range.end);
  if (!q.days_of_week || q.days_of_week.length === 0) return all;
  return all.filter((d) => q.days_of_week!.includes(localDayOfWeek(d, timezone)));
}

function openWindowsForDate(
  date: string,
  club: { timezone: string; operating_hours: OperatingHours },
  timeRange?: { start: string; end: string }
): Array<{ openMin: number; closeMin: number }> {
  const dow = localDayOfWeek(date, club.timezone);
  const hours = club.operating_hours;
  const base: Array<{ openMin: number; closeMin: number }> =
    hours && Object.keys(hours).length > 0
      ? (hours[`${dow}` as keyof OperatingHours] ?? []).map((w) => ({
          openMin: timeToMinutes(w.open),
          closeMin: timeToMinutes(w.close),
        }))
      : [{ openMin: 0, closeMin: 24 * 60 }]; // 24/7

  if (!timeRange) return base;
  const lo = timeToMinutes(timeRange.start);
  const hi = timeToMinutes(timeRange.end);
  return base
    .map((w) => ({ openMin: Math.max(w.openMin, lo), closeMin: Math.min(w.closeMin, hi) }))
    .filter((w) => w.closeMin > w.openMin);
}

function makeSlot(
  court: Court,
  label: string,
  date: string,
  startMin: number,
  endMin: number,
  timezone: string
): AvailabilitySlot {
  const start = minutesToTime(startMin);
  const end = minutesToTime(endMin);
  return {
    court_id: court.id,
    court_label: label,
    date,
    start,
    end,
    starts_at_utc: localToUtc(date, start, timezone).toISOString(),
    ends_at_utc: localToUtc(date, end, timezone).toISOString(),
    duration_minutes: endMin - startMin,
  };
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
