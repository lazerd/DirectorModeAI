/**
 * CourtConnect — the words and times, in one place.
 *
 * Pure functions only, so the board, the emails, the club site and the
 * director page all say "Tue 9:00am doubles · needs 1 · 3.0–3.5" the same way.
 *
 * Every time is formatted in the CLUB's zone. Vercel runs UTC, and a 9am game
 * rendered without a zone goes out to the whole club as 4pm.
 */
import { normalizeTimeZone } from '@/lib/captain/clubTime';
import { TENNIS_SCALE, levelRange, type LevelScale } from '@/lib/levels';

export const FORMATS = ['doubles', 'singles', 'mixed', 'hitting'] as const;
export type GameFormat = (typeof FORMATS)[number];

export const FORMAT_LABEL: Record<GameFormat, string> = {
  doubles: 'doubles',
  singles: 'singles',
  mixed: 'mixed doubles',
  hitting: 'hitting session',
};

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
};

/** "Tue Sep 22 · 9:00am doubles" */
export function gameTitle(g: Pick<GameSummary, 'starts_at' | 'format'>, tz: string): string {
  const f = isFormat(g.format) ? FORMAT_LABEL[g.format] : g.format;
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
