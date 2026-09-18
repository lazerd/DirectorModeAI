/**
 * Shared request hardening for the public PTL routes.
 *
 * Same recipe the existing public signup endpoints use (see
 * src/app/api/leagues/register/route.ts): a per-IP token bucket held in
 * module memory, and text clamped before it reaches the database.
 *
 * The in-memory limiter is per serverless instance, not global, so it is a
 * speed bump rather than a wall — which is the right ambition here. It stops a
 * script hammering enrolment from one machine; it is not trying to stop a
 * botnet, and the UNIQUE index on (season_id, lower(email)) is what actually
 * guarantees one enrolment per person.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export function checkRateLimit(key: string, max = 20): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

export function clampText(v: unknown, max = 120): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

export function clampNumber(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/**
 * Turn a PTL_* error raised by one of the draft functions into something a
 * captain can act on. Postgres wraps our RAISE message, so the code has to be
 * pulled back out of the text.
 */
const MESSAGES: Record<string, { status: number; message: string }> = {
  PTL_DRAFT_NOT_FOUND: { status: 404, message: 'That draft no longer exists.' },
  PTL_DRAFT_NOT_LIVE: { status: 409, message: 'The draft is paused or has not started yet.' },
  PTL_DRAFT_COMPLETE: { status: 409, message: 'The draft is already finished.' },
  PTL_NOT_YOUR_TURN: { status: 409, message: "It's not your pick yet." },
  PTL_ENTRY_ALREADY_DRAFTED: { status: 409, message: 'Someone just took that player — pick again.' },
  PTL_ENTRY_NOT_AVAILABLE: { status: 400, message: 'That player is not in the pool.' },
  PTL_TEAM_NOT_IN_SEASON: { status: 403, message: 'That team is not in this draft.' },
  PTL_NOT_ENOUGH_TEAMS: { status: 409, message: 'The season needs at least two teams.' },
  PTL_DRAFT_SLOTS_INCOMPLETE: { status: 409, message: 'Every team needs a draft slot before the draft can run.' },
  PTL_NOTHING_TO_DRAFT: { status: 409, message: 'Every roster is already full.' },
  PTL_POOL_EMPTY: { status: 409, message: 'No players left in the pool.' },
};

export function draftError(err: unknown): { status: number; message: string; code: string } {
  const text = (err as { message?: string })?.message || '';
  const code = /PTL_[A-Z_]+/.exec(text)?.[0] || '';
  const known = MESSAGES[code];
  if (known) return { ...known, code };
  console.error('[ptl] unmapped draft error:', text);
  return { status: 500, message: 'Something went wrong with that pick.', code: 'PTL_UNKNOWN' };
}
