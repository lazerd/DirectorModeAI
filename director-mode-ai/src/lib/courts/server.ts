/**
 * Loading what a booking page needs, and turning club-local times into instants.
 *
 * The conversion is the whole reason this file exists separately from the pure
 * availability maths. Reservations are stored as TIMESTAMPTZ, the club thinks
 * in its own wall clock, and Vercel runs UTC — so every boundary between those
 * three has to be explicit or a 9am court is booked at 2am.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { localToUtc } from '@/lib/courtsheet/timezones';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import type { BusyBlock, Court, OperatingWindow } from './availability';
import { toMinutes, type RateCard } from './pricing';

export type BookingClub = {
  id: string;
  slug: string;
  name: string;
  email: string | null;
  phone: string | null;
  timezone: string;
  owner_id: string;
  is_public: boolean;
  operating_hours: Record<string, OperatingWindow[]> | null;
};

/** Today, and the current minute, in the CLUB's timezone — never the server's. */
export function clubNow(timeZone: string): { ymd: string; minute: number } {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return { ymd, minute: toMinutes(hhmm) };
}

/** Postgres DOW (0=Sun) for a date, read in club time. */
export function clubDayOfWeek(ymd: string, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(
    new Date(`${ymd}T12:00:00Z`),
  );
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

export async function getBookingClub(slug: string): Promise<BookingClub | null> {
  const { data } = await getSupabaseAdmin()
    .from('cc_clubs')
    .select('id, slug, name, email, phone, timezone, owner_id, is_public, operating_hours')
    .eq('slug', (slug || '').trim().toLowerCase())
    .maybeSingle();
  if (!data) return null;
  const club = data as unknown as BookingClub;
  club.timezone = club.timezone || CLUB_TZ;
  return club;
}

export async function getRateCards(clubId: string): Promise<RateCard[]> {
  const { data } = await getSupabaseAdmin()
    .from('court_rate_cards')
    .select('*')
    .eq('club_id', clubId)
    .eq('active', true)
    .order('display_order');
  return (data as RateCard[] | null) ?? [];
}

export async function getCourts(clubId: string): Promise<Court[]> {
  const { data } = await getSupabaseAdmin()
    .from('courts')
    .select('id, name, number, status')
    .eq('club_id', clubId)
    .order('display_order')
    .order('number');
  return (data as Court[] | null) ?? [];
}

/**
 * Everything already claiming court time on one club-local day.
 *
 * Queried over an instant range that covers the whole local day, then converted
 * BACK to club-local minutes, because that is the only frame the availability
 * maths works in. A reservation that starts before midnight or runs past it is
 * clamped to the day rather than dropped — it still blocks the courts it
 * overlaps.
 */
export async function getBusyBlocks(
  clubId: string,
  ymd: string,
  timeZone: string,
): Promise<BusyBlock[]> {
  const dayStart = localToUtc(ymd, '00:00', timeZone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const { data } = await getSupabaseAdmin()
    .from('reservations')
    .select('court_id, starts_at, ends_at')
    .eq('club_id', clubId)
    .neq('status', 'cancelled')
    .lt('starts_at', dayEnd.toISOString())
    .gt('ends_at', dayStart.toISOString());

  const rows = (data as { court_id: string; starts_at: string; ends_at: string }[] | null) ?? [];

  return rows.map((r) => {
    const startMs = Date.parse(r.starts_at);
    const endMs = Date.parse(r.ends_at);
    const toLocalMinute = (ms: number) =>
      Math.round((ms - dayStart.getTime()) / 60000);
    return {
      court_id: r.court_id,
      // Clamp to the day: an overnight block still blocks this morning.
      startMinute: Math.max(0, toLocalMinute(startMs)),
      endMinute: Math.min(1440, toLocalMinute(endMs)),
    };
  });
}

/**
 * Is this person a member of this club?
 *
 * Member rates are NOT self-declared. A "I'm a member" checkbox on a public
 * form, at a club where members play free, is a free-courts checkbox — so the
 * only way to get member pricing is to be signed in as one.
 */
export async function memberAudience(
  clubId: string,
  userId: string | null,
): Promise<'member' | 'public'> {
  if (!userId) return 'public';
  const db = getSupabaseAdmin();

  const { data: owned } = await db
    .from('cc_clubs')
    .select('id')
    .eq('id', clubId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (owned) return 'member';

  const { data: membership } = await db
    .from('cc_club_members')
    .select('role')
    .eq('club_id', clubId)
    .eq('user_id', userId)
    .maybeSingle();
  return membership ? 'member' : 'public';
}

/** Club-local date + 'HH:MM' → the instant to store. */
export function toInstant(ymd: string, hhmm: string, timeZone: string): Date {
  return localToUtc(ymd, hhmm, timeZone);
}
