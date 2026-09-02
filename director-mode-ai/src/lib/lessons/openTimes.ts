/**
 * Server side of Open Lesson Time: syncing an instructor's Google Calendar into
 * bookable windows. The arithmetic lives in ./openMath, which the booking page
 * runs in the browser too — this file is the half that talks to Google and the
 * database, and must never be imported from a client component.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { listOpenWindows, OPEN_LESSON_TITLE } from './googleCalendar';
import { fetchIcsWindows } from './icsCalendar';
import {
  DEFAULT_DURATIONS,
  OPEN_WINDOW_DAYS,
  reconcileWindows,
  type WindowRow,
} from './openMath';

export * from './openMath';

const ms = (isoStr: string) => new Date(isoStr).getTime();
const MIN = 60_000;

export type CoachRow = {
  id: string;
  club_id: string | null;
  /** 'google' = live two-way. 'ics' = a published feed we can only read. */
  calendar_kind: 'google' | 'ics' | string;
  ics_url: string | null;
  slug: string | null;
  display_name: string | null;
  email: string | null;
  google_calendar_id: string | null;
  open_keyword: string;
  open_page_enabled: boolean;
  open_page_note: string | null;
  open_rate_note: string | null;
  open_durations: number[] | null;
  booking_lead_hours: number;
  timezone: string;
};

export type SyncResult = {
  windows: number;
  hours: number;
  added: number;
  updated: number;
  removed: number;
  synced_at: string;
};

/** Pull one instructor's calendar into lesson_open_windows. */
export async function syncOpenWindows(db: SupabaseClient, coach: CoachRow): Promise<SyncResult> {
  const isIcs = coach.calendar_kind === 'ics';
  if (isIcs ? !coach.ics_url : !coach.google_calendar_id) {
    throw new Error('No calendar connected yet.');
  }

  const from = new Date();
  const to = new Date(from.getTime() + OPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const title = coach.open_keyword || OPEN_LESSON_TITLE;

  /**
   * Two ways in, one shape out. A published feed and a shared Google calendar
   * produce the same windows, so everything downstream — the slicing, the
   * booking guard, the club page — is identical for both.
   */
  const events = isIcs
    ? await fetchIcsWindows(coach.ics_url as string, title, from.toISOString(), to.toISOString())
    : await listOpenWindows(
        coach.google_calendar_id as string,
        title,
        from.toISOString(),
        to.toISOString(),
      );

  const { data: existingRows } = await db
    .from('lesson_open_windows')
    .select('id, google_event_id, start_time, end_time, location')
    .eq('coach_id', coach.id)
    .gte('start_time', from.toISOString())
    .lte('start_time', to.toISOString());

  const existing = (existingRows as WindowRow[]) || [];
  const plan = reconcileWindows(events, existing);
  const known = new Set(existing.map((w) => w.google_event_id));

  let added = 0;
  let updated = 0;
  if (plan.upserts.length) {
    const { error } = await db.from('lesson_open_windows').upsert(
      plan.upserts.map((u) => ({
        coach_id: coach.id,
        club_id: coach.club_id,
        // Column predates the ICS path; for a published feed it holds the feed
        // URL, which is the equivalent "where this window came from".
        google_calendar_id: coach.google_calendar_id || coach.ics_url,
        synced_at: new Date().toISOString(),
        ...u,
      })),
      { onConflict: 'coach_id,google_event_id' },
    );
    if (error) throw new Error(error.message);
    for (const u of plan.upserts) (known.has(u.google_event_id) ? updated++ : added++);
  }

  if (plan.deleteIds.length) {
    await db.from('lesson_open_windows').delete().in('id', plan.deleteIds);
  }

  const synced_at = new Date().toISOString();
  await db.from('lesson_coaches').update({ open_synced_at: synced_at }).eq('id', coach.id);

  return {
    windows: events.length,
    hours: Math.round((events.reduce((n, e) => n + (ms(e.end) - ms(e.start)), 0) / 3_600_000) * 10) / 10,
    added,
    updated,
    removed: plan.deleteIds.length,
    synced_at,
  };
}

/** The earliest a client may book, given the instructor's notice period. */
export function earliestBookable(coach: Pick<CoachRow, 'booking_lead_hours'>, now = new Date()): string {
  const lead = Number.isFinite(coach.booking_lead_hours) ? coach.booking_lead_hours : 3;
  return new Date(now.getTime() + lead * 60 * MIN).toISOString();
}

export function durationsFor(coach: Pick<CoachRow, 'open_durations'>): number[] {
  const d = (coach.open_durations || []).filter((n) => Number.isFinite(n) && n > 0);
  return d.length ? [...d].sort((a, b) => a - b) : DEFAULT_DURATIONS;
}
