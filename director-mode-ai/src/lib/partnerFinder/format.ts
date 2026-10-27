/**
 * CourtConnect — the words and times, in one place.
 *
 * Pure functions only, so the board, the emails, the club site and the
 * director page all say "Tue 9:00am doubles · needs 1 · 3.0–3.5" the same way.
 *
 * Every time is formatted in the CLUB's zone. Vercel runs UTC, and a 9am game
 * rendered without a zone goes out to the whole club as 4pm.
 */
import { isoToZonedWallTime, normalizeTimeZone } from '@/lib/captain/clubTime';
import { TENNIS_SCALE, levelRange, type LevelScale } from '@/lib/levels';

export const FORMATS = ['doubles', 'singles', 'mixed', 'hitting'] as const;
export type GameFormat = (typeof FORMATS)[number];

export const FORMAT_LABEL: Record<GameFormat, string> = {
  doubles: 'doubles',
  singles: 'singles',
  mixed: 'mixed doubles',
  hitting: 'hitting session',
};

/** Who a game is for. null = anyone. Matches cc_vault_players.gender. */
export const GENDERS = ['male', 'female'] as const;
export type GameGender = (typeof GENDERS)[number];

export function isGender(v: unknown): v is GameGender {
  return typeof v === 'string' && (GENDERS as readonly string[]).includes(v);
}

/**
 * "doubles", "men's doubles", "women's hitting session". Mixed is already
 * about gender, so it never takes a prefix. A game posted to a pickleball
 * list says so — "pickleball doubles" — because a bare "doubles" reads as
 * tennis. Tennis (or no sport) adds nothing.
 */
export function gameKind(format: string, gender?: string | null, sport?: string | null): string {
  const base = isFormat(format) ? FORMAT_LABEL[format] : format;
  const f = sport && sport !== 'tennis' ? `${sport} ${base}` : base;
  if (format === 'mixed' || !isGender(gender)) return f;
  return `${gender === 'male' ? "men's" : "women's"} ${f}`;
}

export const DURATIONS = [60, 90, 120] as const;

/** Most spots a post may ask for. */
export const MAX_SPOTS = 3;
/** Posts one member may make at one club in 24 hours. */
export const DAILY_POST_LIMIT = 3;
/** Most people one post emails. */
export const MAX_RECIPIENTS = 50;

export type GameStatus = 'open' | 'full' | 'cancelled' | 'expired';

export function isFormat(v: unknown): v is GameFormat {
  return typeof v === 'string' && (FORMATS as readonly string[]).includes(v);
}

/** "Mary Beth Jones" → "Mary J." — first name and last initial, never more. */
export function shortName(full: string | null | undefined): string {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A member';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** "Mary Beth Jones" → "Mary". */
export function firstName(full: string | null | undefined): string {
  return (full || '').trim().split(/\s+/)[0] || 'there';
}

/**
 * "3.0–3.5", "3.5+", "up to 3.0" — or the tier names the range covers at a club
 * that plays by name ("Intermediate to Advanced"). "" means any level.
 *
 * The scale comes from the club (see lib/levels.ts); without one this is the
 * NTRP wording every club had before tiers existed.
 */
export function ratingLabel(
  min: number | string | null,
  max: number | string | null,
  scale: LevelScale = TENNIS_SCALE,
): string {
  return levelRange(scale, min, max);
}

/** "needs 1 player" / "needs 2 players". */
export function needsLabel(n: number): string {
  return `needs ${n} ${n === 1 ? 'player' : 'players'}`;
}

function parts(iso: string, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: normalizeTimeZone(tz) }).formatToParts(new Date(iso));
}

/** "9:00am" in the club's zone. */
export function clockLabel(iso: string, tz: string): string {
  const p = parts(iso, tz, { hour: 'numeric', minute: '2-digit', hour12: true });
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('hour')}:${v('minute')}${v('dayPeriod').toLowerCase()}`;
}

/** "Tue Sep 22". */
export function shortDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: normalizeTimeZone(tz),
  })
    .format(new Date(iso))
    .replace(',', '');
}

/** "Tuesday, September 22". */
export function longDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: normalizeTimeZone(tz),
  }).format(new Date(iso));
}

/** "2026-09-22" — the club-local calendar date of an instant. */
export function clubDate(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: normalizeTimeZone(tz),
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function durationLabel(min: number): string {
  if (min % 60 === 0) return `${min / 60} ${min === 60 ? 'hour' : 'hours'}`;
  if (min === 90) return '1½ hours';
  return `${min} minutes`;
}

export type GameSummary = {
  starts_at: string;
  format: string;
  spots_needed: number;
  rating_min: number | string | null;
  rating_max: number | string | null;
  gender?: string | null;
  sport?: string | null;
};

/** "Tue Sep 22 · 9:00am doubles" (or "men's doubles") */
export function gameTitle(g: Pick<GameSummary, 'starts_at' | 'format' | 'gender' | 'sport'>, tz: string): string {
  const f = gameKind(g.format, g.gender, g.sport);
  return `${shortDay(g.starts_at, tz)} · ${clockLabel(g.starts_at, tz)} ${f}`;
}

/**
 * The non-identifying one-liner: "Tue Sep 22 · 9:00am doubles · needs 1 · 3.0–3.5".
 * Safe for a signed-out visitor — no names, no note, no court.
 */
export function publicLine(g: GameSummary, spotsLeft: number, tz: string, scale: LevelScale = TENNIS_SCALE): string {
  const r = ratingLabel(g.rating_min, g.rating_max, scale);
  return [gameTitle(g, tz), `needs ${spotsLeft}`, r].filter(Boolean).join(' · ');
}

/* ------------------------------------------------------------ editing a game */

/** Most players a format can ask for besides the host. Singles is one opponent. */
export function maxSpotsFor(format: string): number {
  return format === 'singles' ? 1 : MAX_SPOTS;
}

/** The parts of a posted game its host (or the club) may change. */
export type GameEdit = {
  starts_at: string;
  duration_min: number;
  court: string | null;
  note: string | null;
  spots_needed: number;
};

export type GameChange = {
  field: 'when' | 'duration' | 'court' | 'note' | 'spots';
  label: string;
  from: string;
  to: string;
};

/**
 * What an edit changes, in the words the players read: "Tue Sep 22, 1:00pm →
 * Wed Sep 23, 10:00am". Nothing in the list means nothing changed. Players are
 * counted in court terms (spots_needed is everyone BESIDES the host, so 3 is a
 * four-person court), the same way the director's table shows it.
 */
export function gameChanges(before: GameEdit, after: GameEdit, tz: string): GameChange[] {
  const when = (iso: string) => `${shortDay(iso, tz)}, ${clockLabel(iso, tz)}`;
  const court = (c: string | null) => (c && c.trim()) || 'To be decided';
  const note = (n: string | null) => (n && n.trim()) || '(none)';
  const players = (n: number) => `${n + 1} in all`;
  const out: GameChange[] = [];
  if (new Date(before.starts_at).getTime() !== new Date(after.starts_at).getTime()) {
    out.push({ field: 'when', label: 'When', from: when(before.starts_at), to: when(after.starts_at) });
  }
  if (before.duration_min !== after.duration_min) {
    out.push({ field: 'duration', label: 'How long', from: durationLabel(before.duration_min), to: durationLabel(after.duration_min) });
  }
  if (court(before.court) !== court(after.court)) {
    out.push({ field: 'court', label: 'Court', from: court(before.court), to: court(after.court) });
  }
  if (note(before.note) !== note(after.note)) {
    out.push({ field: 'note', label: 'Note', from: note(before.note), to: note(after.note) });
  }
  if (before.spots_needed !== after.spots_needed) {
    out.push({ field: 'spots', label: 'Players', from: players(before.spots_needed), to: players(after.spots_needed) });
  }
  return out;
}

/**
 * Only a new time or a new court is worth an email to the people who are in:
 * those are the two that send somebody to the wrong place. A reworded note or
 * one more spot shows on the game page and is not news.
 */
export function changeTellsPlayers(changes: GameChange[]): boolean {
  return changes.some((c) => c.field === 'when' || c.field === 'court');
}

/** The edit form's current values, in the club's own wall-clock time. */
export function editFormValues(g: GameEdit, tz: string) {
  const wall = isoToZonedWallTime(g.starts_at, tz);
  return {
    date: wall.slice(0, 10),
    time: wall.slice(11, 16),
    duration: g.duration_min,
    court: g.court ?? '',
    note: g.note ?? '',
    spots: g.spots_needed,
  };
}
