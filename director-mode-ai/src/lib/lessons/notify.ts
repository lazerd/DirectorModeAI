/**
 * Shared server pieces for LessonMode's notification routes
 * (/api/lessons/client-request-notify, booking-notify, cancel-notify).
 *
 * Those routes used to take the recipient address, names and times straight
 * from the request body, with no session, and drop them unescaped into a
 * LessonMode email — anyone could send our branded HTML to any inbox (QA
 * 2026-10-27 #1). Now every route signs the caller in, loads the coach, client
 * and slot by id, and builds the email from those rows. Nothing a browser sends
 * decides who gets mail.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { esc } from '@/lib/escapeHtml';

export { esc };

/** The signed-in user's id, or null. */
export async function sessionUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export type LessonCoach = {
  id: string;
  profile_id: string | null;
  display_name: string | null;
  email: string | null;
  timezone: string;
  club_id: string | null;
};

/** A coach row, with their login's email standing in when the coach row has none. */
export async function loadCoach(db: SupabaseClient, coachId: string): Promise<LessonCoach | null> {
  const { data } = await db
    .from('lesson_coaches')
    .select('id, profile_id, display_name, email, timezone, club_id')
    .eq('id', coachId)
    .maybeSingle();
  if (!data) return null;
  let email: string | null = (data as any).email || null;
  if (!email && (data as any).profile_id) {
    const { data: p } = await db.from('profiles').select('email').eq('id', (data as any).profile_id).maybeSingle();
    email = (p as any)?.email || null;
  }
  return {
    id: (data as any).id,
    profile_id: (data as any).profile_id ?? null,
    display_name: (data as any).display_name ?? null,
    email,
    timezone: (data as any).timezone || 'America/Los_Angeles',
    club_id: (data as any).club_id ?? null,
  };
}

/** The signed-in user's lesson_clients row. */
export async function loadMyClient(db: SupabaseClient, userId: string) {
  const { data } = await db.from('lesson_clients').select('id, name, email').eq('profile_id', userId).maybeSingle();
  return (data as { id: string; name: string | null; email: string | null } | null) ?? null;
}

/** Is this client linked to this coach (pending or approved)? */
export async function isLinked(db: SupabaseClient, clientId: string, coachId: string, status?: string): Promise<boolean> {
  let q = db.from('lesson_client_coaches').select('client_id').eq('client_id', clientId).eq('coach_id', coachId);
  if (status) q = q.eq('status', status);
  const { data } = await q.limit(1);
  return !!data?.length;
}

function wall(iso: string, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const v = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return { y: v('year'), mo: v('month'), d: v('day'), h: v('hour'), mi: v('minute') };
}

/** "9:00 AM" — with a plain space; newer ICU puts U+202F before AM/PM. */
const clock = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(/ /g, ' ');

/**
 * A slot's date and time in the coach's zone, formatted the way the browser
 * used to send them ("10/27/2026", "9:00 AM - 10:00 AM"), plus floating
 * calendar stamps ("20261027T090000") for the add-to-calendar links.
 */
export function slotWhen(startIso: string, endIso: string, tz: string) {
  const s = wall(startIso, tz);
  const e = wall(endIso, tz);
  return {
    date: `${s.mo}/${s.d}/${s.y}`,
    time: `${clock(startIso, tz)} - ${clock(endIso, tz)}`,
    startStamp: `${s.y}${s.mo}${s.d}T${s.h}${s.mi}00`,
    endStamp: `${e.y}${e.mo}${e.d}T${e.h}${e.mi}00`,
  };
}
