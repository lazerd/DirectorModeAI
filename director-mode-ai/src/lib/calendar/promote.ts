/**
 * CalendarMode — turning an intention into a real event.
 *
 * A calendar item is a plan; an `events` row is a thing that runs, with a draw,
 * courts, rounds and matches hanging off it. Promotion is the deliberate moment
 * the director converts one into the other, which is why it is a button and not
 * a side effect of scheduling: format, fees and draw shape are decisions nobody
 * should be forced to make eleven months out.
 *
 * Pure by design — the caller supplies the event code, slug and user id, and
 * performs the insert. That keeps randomness and I/O out of the engine so this
 * stays testable.
 */

import { TOURNAMENT_FORMATS, MIXER_FORMATS } from '@/lib/eventCategory';
import { catalogEntry } from './catalog';
import { addDays } from './dates';
import type { ISODate, PlanItem } from './types';

/** A calendar item ready to become an event, plus what the caller must supply. */
export interface PromoteInput {
  item: PlanItem;
  userId: string;
  clubId: string | null;
  eventCode: string;
  slug: string;
  /** Fallback when the item carries no time. */
  defaultStartTime?: string;
}

export interface PromoteResult {
  ok: boolean;
  error?: string;
  /** Insert payload for the `events` table. */
  event?: Record<string, unknown>;
  /** Which of the three modes this lands in, for the redirect after promote. */
  mode?: 'mixer' | 'tournament';
}

/**
 * Resolve the format an item should be created with.
 *
 * The catalog's `formatHint` is advisory: a director may have edited the item,
 * and the taxonomy in eventCategory.ts changes more often than the catalog
 * does. Anything unrecognised falls back to a plain doubles mixer rather than
 * failing — a promoted event with the wrong format is a two-click fix, a
 * promote button that errors is a dead end.
 */
export function resolveFormat(item: PlanItem): { format: string; mode: 'mixer' | 'tournament' } {
  const hint = item.catalog_key
    ? catalogEntry(item.catalog_key)?.formatHint ?? null
    : null;
  const candidate = (hintOf(item) ?? hint ?? '').trim();

  if (candidate && TOURNAMENT_FORMATS.has(candidate)) return { format: candidate, mode: 'tournament' };
  if (candidate && MIXER_FORMATS.has(candidate)) return { format: candidate, mode: 'mixer' };
  return { format: 'doubles', mode: 'mixer' };
}

/** An item may carry its own override; fall back to the catalog otherwise. */
function hintOf(item: PlanItem): string | null {
  const anyItem = item as PlanItem & { format_hint?: string | null };
  return anyItem.format_hint ?? null;
}

/** Build the `events` insert payload for a scheduled calendar item. */
export function buildEventPayload(input: PromoteInput): PromoteResult {
  const { item, userId, clubId, eventCode, slug } = input;

  if (!item.target_date) {
    return { ok: false, error: 'This event has no date yet — schedule it before promoting.' };
  }

  const { format, mode } = resolveFormat(item);
  const startTime = input.defaultStartTime ?? '09:00';
  const duration = item.duration_minutes ?? 180;
  const endDate = item.target_end_date ?? item.target_date;
  const courts = Math.max(1, item.courts_needed ?? 6);

  const event: Record<string, unknown> = {
    user_id: userId,
    club_id: clubId,
    event_code: eventCode,
    name: item.title,
    event_date: item.target_date,
    end_date: endDate,
    start_time: startTime,
    daily_start_time: startTime,
    daily_end_time: addMinutes(startTime, duration),
    duration_minutes: duration,
    num_courts: courts,
    match_format: format,
    scoring_format: 'fixed_games',
    slug,
    public_registration: false,
    public_status: 'draft',
    max_players: item.expected_attendance ?? null,
    default_match_length_minutes: 60,
    player_rest_minutes: 30,
    match_buffer_minutes: 10,
  };

  return { ok: true, event, mode };
}

/**
 * The tentative court hold written when an item is scheduled.
 *
 * Status is 'tentative' and type is 'hold' so the block reads as provisional on
 * the sheet, but it still participates in the EXCLUDE-USING-gist constraint
 * from courtsheet_005 — which is the entire point. A calendar that says
 * "Member-Guest, all ten courts, September 12th" while the sheet happily sells
 * those courts to a member is worse than no calendar at all.
 */
export interface HoldSpec {
  club_id: string;
  court_id: string;
  starts_at: string; // ISO timestamptz
  ends_at: string;
  type: 'hold';
  source: 'calendar';
  source_id: string;
  title: string;
  status: 'tentative';
  color: string | null;
  meta: Record<string, unknown>;
  created_by: string;
}

const DEPARTMENT_COLORS: Record<string, string> = {
  tennis: '#eab308',
  pickleball: '#22d3ee',
  swim: '#38bdf8',
  fitness: '#a78bfa',
  social: '#fb923c',
  other: '#94a3b8',
};

export function departmentColor(department: string): string {
  return DEPARTMENT_COLORS[department] ?? DEPARTMENT_COLORS.other;
}

/**
 * Build one hold per court per day the item spans.
 *
 * Times are composed as club-local wall-clock strings with an explicit offset
 * supplied by the caller (resolved from cc_clubs.timezone), rather than being
 * derived here — the engine has no business knowing about DST.
 */
export function buildHolds(params: {
  item: PlanItem;
  clubId: string;
  courtIds: string[];
  createdBy: string;
  /** 'HH:MM' club-local. */
  startTime: string;
  /** Offset string like '-07:00' for the club's timezone on that date. */
  utcOffset: string;
}): HoldSpec[] {
  const { item, clubId, courtIds, createdBy, startTime, utcOffset } = params;
  if (!item.target_date || courtIds.length === 0) return [];

  const duration = item.duration_minutes ?? 180;
  const endTime = addMinutes(startTime, duration);
  const spansMidnight = endTime <= startTime;

  const days: ISODate[] = [];
  let cursor = item.target_date;
  const last = item.target_end_date ?? item.target_date;
  while (cursor <= last && days.length < 30) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }

  const holds: HoldSpec[] = [];
  for (const day of days) {
    for (const court_id of courtIds) {
      holds.push({
        club_id: clubId,
        court_id,
        starts_at: `${day}T${startTime}:00${utcOffset}`,
        ends_at: `${spansMidnight ? addDays(day, 1) : day}T${endTime}:00${utcOffset}`,
        type: 'hold',
        source: 'calendar',
        source_id: item.id,
        title: item.title,
        status: 'tentative',
        color: departmentColor(item.department),
        meta: { calendar_item_id: item.id, department: item.department, provisional: true },
        created_by: createdBy,
      });
    }
  }
  return holds;
}

/** 'HH:MM' + minutes → 'HH:MM', wrapping past midnight. */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Convert a catalog entry into a fresh plan item payload.
 * Used by "add to plan" in the ideas browser and by the AI year builder, so
 * both paths produce identically-shaped rows.
 */
export function itemFromCatalog(key: string, planId: string, clubId: string): Record<string, unknown> | null {
  const c = catalogEntry(key);
  if (!c) return null;
  return {
    plan_id: planId,
    club_id: clubId,
    title: c.title,
    catalog_key: c.key,
    description: c.description,
    department: c.department,
    audience: c.audience,
    format_hint: c.formatHint,
    status: 'idea',
    anchor_rule: c.anchor,
    duration_minutes: c.durationMinutes,
    courts_needed: c.courtsNeeded,
    staff_needed: c.staffNeeded,
    expected_attendance: c.typicalAttendance,
    entry_fee_cents: c.typicalFeeCents,
    expected_revenue_cents: c.typicalFeeCents * c.typicalAttendance,
  };
}
