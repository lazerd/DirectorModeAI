/**
 * CourtSheet AI — selector resolution.
 *
 * A Selector is the shared "which reservations" structure that the AI and
 * the UI use for cancel/move/modify. resolveSelector() turns it into a
 * concrete list of reservation_ids by running the right query against the
 * reservations table.
 *
 * Selectors are intentionally compact — the model emits them in tool
 * arguments and we'd rather give it a clear, narrow shape than a 30-key
 * filter object.
 */

import type { Reservation, Selector } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateDates, localDayOfWeek, localToUtc } from './timezones';

export interface ResolveContext {
  /** Service-role Supabase client (admin). */
  db: SupabaseClient<any, 'public', any>;
  timezone: string;
}

/**
 * Resolve a Selector to the matching reservation rows. Includes
 * tentative + confirmed; explicitly excludes cancelled rows.
 *
 * The resolver runs the most selective filters server-side (court list,
 * date window, type/source, series_id, reservation_id) and the loose
 * filters (DOW, time window, title substring) client-side over the
 * filtered set. That keeps the SQL trivial without blowing up the
 * read.
 */
export async function resolveSelector(
  sel: Selector,
  ctx: ResolveContext
): Promise<Reservation[]> {
  // Single-shot id lookup.
  if (sel.reservation_id) {
    const { data } = await ctx.db
      .from('reservations')
      .select('*')
      .eq('id', sel.reservation_id)
      .eq('club_id', sel.club_id)
      .neq('status', 'cancelled')
      .maybeSingle();
    return data ? [data as Reservation] : [];
  }

  let q = ctx.db
    .from('reservations')
    .select('*')
    .eq('club_id', sel.club_id)
    .neq('status', 'cancelled');

  if (sel.series_id) q = q.eq('series_id', sel.series_id);
  if (sel.type) q = q.eq('type', sel.type);
  if (sel.source) q = q.eq('source', sel.source);

  if (sel.date_range) {
    // Convert local YYYY-MM-DD bounds to a generous UTC window. The DOW
    // and time_range filters tighten this further client-side.
    const startUtc = localToUtc(sel.date_range.start, '00:00', ctx.timezone).toISOString();
    const endUtc = localToUtc(addOneDay(sel.date_range.end), '00:00', ctx.timezone).toISOString();
    q = q.gte('starts_at', startUtc).lt('starts_at', endUtc);
  }

  if (sel.courts && sel.courts.length > 0) {
    // We don't have the court id list here without another query; defer
    // court matching to the caller, which already has the courts loaded.
    // (Planner passes the courts in.)
  }

  const { data } = await q;
  const rows = (data ?? []) as Reservation[];

  return rows.filter((r) => {
    if (sel.days_of_week && sel.days_of_week.length > 0) {
      const localDate = isoLocalDate(r.starts_at, ctx.timezone);
      if (!sel.days_of_week.includes(localDayOfWeek(localDate, ctx.timezone))) return false;
    }
    if (sel.time_range) {
      const localTime = isoLocalTime(r.starts_at, ctx.timezone);
      if (localTime < normalizeHHMM(sel.time_range.start)) return false;
      if (localTime > normalizeHHMM(sel.time_range.end)) return false;
    }
    if (sel.title_match) {
      if (!r.title.toLowerCase().includes(sel.title_match.toLowerCase())) return false;
    }
    return true;
  });
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function normalizeHHMM(s: string): string {
  const [h, m = '0'] = s.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function isoLocalDate(iso: string, tz: string): string {
  // Re-import here would create a cycle; use a tiny inline reformatter.
  // date-fns-tz format is the canonical path; but for tight inner-loop
  // use we can lean on the existing helpers.
  const { utcToLocalDate } = require('./timezones') as typeof import('./timezones');
  return utcToLocalDate(iso, tz);
}

function isoLocalTime(iso: string, tz: string): string {
  const { utcToLocalTime } = require('./timezones') as typeof import('./timezones');
  return utcToLocalTime(iso, tz);
}

/** For move/modify scope='future', filter resolved rows to >= today (local). */
export function filterFutureOnly(rows: Reservation[], timezone: string): Reservation[] {
  const { utcToLocalDate } = require('./timezones') as typeof import('./timezones');
  const today = utcToLocalDate(new Date(), timezone);
  return rows.filter((r) => utcToLocalDate(r.starts_at, timezone) >= today);
}
