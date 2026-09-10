/**
 * Club time, in one place.
 *
 * NEVER fall back to `undefined` for a timeZone in player-facing output: that
 * means "the runtime's own timezone", which on Vercel is UTC — a 9:30am match
 * then goes out to the whole roster as "4:30 PM".
 *
 * Lives in its own module so both the email builders and the calendar builder
 * can read it without importing each other.
 *
 * CLUB_TZ is the FALLBACK, not the answer. Every team belongs to a club, and the
 * club's own zone (cc_clubs.timezone, set at club setup) is what its players
 * read times in — an East Coast team's 9:30am match must not go out as 6:30.
 * Resolve it with resolveTeamTimeZone / resolveClubTimeZone and pass it down.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const CLUB_TZ = 'America/Los_Angeles';

/** PostgREST embed for a team's club zone: `.select('name, ' + CLUB_TZ_EMBED)`. */
export const CLUB_TZ_EMBED = 'cc_clubs(timezone)';

/**
 * A usable IANA zone, or CLUB_TZ. A blank or misspelled zone would make Intl
 * throw at render time — or, left undefined, silently format in UTC — so
 * anything that isn't a real zone falls back here, once, at the edge.
 */
export function normalizeTimeZone(tz: string | null | undefined): string {
  if (!tz || typeof tz !== 'string' || !tz.trim()) return CLUB_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
    return tz.trim();
  } catch {
    return CLUB_TZ;
  }
}

/** The zone off a row selected with CLUB_TZ_EMBED (to-one embeds may arrive as an array). */
export function clubTimeZoneOf(row: unknown): string {
  const c = (row as { cc_clubs?: unknown } | null | undefined)?.cc_clubs as
    | { timezone?: string | null }
    | { timezone?: string | null }[]
    | null
    | undefined;
  return normalizeTimeZone((Array.isArray(c) ? c[0] : c)?.timezone);
}

/**
 * The club's zone. Pass the ADMIN client: cc_clubs is RLS-scoped to club
 * owners and members, and a co-captain who is neither would read nothing back
 * and quietly get Pacific.
 */
export async function resolveClubTimeZone(
  db: SupabaseClient,
  clubId: string | null | undefined,
): Promise<string> {
  if (!clubId) return CLUB_TZ;
  const { data } = await db.from('cc_clubs').select('timezone').eq('id', clubId).maybeSingle();
  return normalizeTimeZone((data as { timezone?: string | null } | null)?.timezone);
}

/** A team's zone, via captain_teams.club_id → cc_clubs.timezone. Admin client — see above. */
export async function resolveTeamTimeZone(
  db: SupabaseClient,
  teamId: string | null | undefined,
): Promise<string> {
  if (!teamId) return CLUB_TZ;
  const { data } = await db.from('captain_teams').select(CLUB_TZ_EMBED).eq('id', teamId).maybeSingle();
  return clubTimeZoneOf(data);
}

/** Minutes `tz` is ahead of UTC at the instant `ms`. */
function offsetMinutes(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * A wall-clock "YYYY-MM-DDTHH:MM" (what <input type="datetime-local"> gives)
 * read as time AT THE CLUB, as a UTC ISO instant. The captain typed 9:30 because
 * the match is at 9:30 at the club — not wherever their browser happens to be.
 * Returns null for anything unparseable.
 */
export function zonedWallTimeToIso(local: string, tz?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec((local || '').trim());
  if (!m) return null;
  const zone = normalizeTimeZone(tz);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Two passes so a time next to a DST change lands on the right side of it.
  let ms = guess - offsetMinutes(guess, zone) * 60_000;
  ms = guess - offsetMinutes(ms, zone) * 60_000;
  return new Date(ms).toISOString();
}

/** The inverse, for pre-filling a datetime-local input with a stored instant. */
export function isoToZonedWallTime(iso: string, tz?: string | null): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimeZone(tz),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}
