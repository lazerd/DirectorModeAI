import { calendarClient } from './googleCalendar';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/*
 * A director's whole calendar day (Darrin 11/27/26: "look at my Google Calendar and charge my
 * lessons from today", his most common text). Reads the calendar they already connected for
 * Open Lesson Time (lesson_coaches.google_calendar_id, shared with the service account).
 * Titles carry the billing detail ("Team warmup $20 each with ...", "dont charge", "paid Zelle").
 */
export interface DayEvent { start: string; end: string; title: string; notes: string }

/** Test seam: CALENDAR_FIXTURE_JSON = { "YYYY-MM-DD": DayEvent[] } replaces Google (local evals). */
function fixture(date: string): DayEvent[] | null {
  const raw = process.env.CALENDAR_FIXTURE_JSON;
  if (!raw) return null;
  try { return (JSON.parse(raw) as Record<string, DayEvent[]>)[date] ?? []; } catch { return null; }
}

export async function readDayEvents(userId: string, date: string): Promise<{ ok: true; events: DayEvent[] } | { ok: false; error: string }> {
  const fx = fixture(date);
  if (fx) return { ok: true, events: fx };
  const { data } = await getSupabaseAdmin().from('lesson_coaches').select('calendar_kind, google_calendar_id').eq('profile_id', userId).maybeSingle();
  const calId = (data as { calendar_kind: string; google_calendar_id: string | null } | null)?.google_calendar_id;
  if (!calId || (data as any)?.calendar_kind !== 'google') return { ok: false, error: 'Your Google Calendar is not connected to ClubMode yet (Lessons > Open Lesson Time > connect calendar).' };
  // The day in Pacific time, generously bounded; Google expands recurring events.
  const from = new Date(`${date}T00:00:00-08:00`), to = new Date(from.getTime() + 86400000);
  try {
    const res = await calendarClient().events.list({ calendarId: calId, timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 100, timeZone: 'America/Los_Angeles' });
    const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
    const events = (res.data.items ?? [])
      .filter((e) => e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({ start: fmt(e.start!.dateTime!), end: fmt(e.end!.dateTime!), title: e.summary ?? '(no title)', notes: (e.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) }));
    return { ok: true, events };
  } catch (e) {
    return { ok: false, error: `Could not read your Google Calendar: ${(e as Error).message.slice(0, 160)}` };
  }
}
