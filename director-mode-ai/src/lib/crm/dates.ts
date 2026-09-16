/**
 * Dates for the CRM, in the reps' time zone.
 *
 * Vercel runs in UTC, where "today" flips at 5 PM Pacific. Darrin and Kevin are
 * both in California, so a next step due 2026-09-21 must go red on the morning
 * of the 21st in Walnut Creek — not at 5 PM on the 20th, and not a day late.
 * Nothing here reads the clock itself: `now` is passed in, so the tests pin it.
 *
 * Once a date is a YYYY-MM-DD string the arithmetic is pure calendar maths done
 * at UTC noon, which no DST shift can move across a day boundary.
 */

/** The reps are in California. One constant, not a string in six files. */
export const CRM_TZ = 'America/Los_Angeles';

export type ISODate = string; // YYYY-MM-DD

/** The calendar date at `now`, where the reps are. en-CA formats as YYYY-MM-DD. */
export function crmToday(now: Date = new Date(), timeZone = CRM_TZ): ISODate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function utcNoon(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Whole days from `a` to `b`; positive when `b` is later. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((utcNoon(b).getTime() - utcNoon(a).getTime()) / 86_400_000);
}

/** Is a next step past its date? Today is not overdue — you still have today. */
export function isOverdue(due: ISODate | null | undefined, today: ISODate): boolean {
  return !!due && due < today;
}

export function isISODate(v: unknown): v is ISODate {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(utcNoon(v).getTime());
}

/**
 * "today", "yesterday", "6 days ago", "3 weeks ago" — how old a thing is, in
 * the words a rep would use out loud. Anything older than a year says so
 * rather than counting weeks into the hundreds.
 */
export function ageLabel(timestamp: string | null | undefined, today: ISODate): string | null {
  if (!timestamp) return null;
  const then = crmToday(new Date(timestamp));
  if (Number.isNaN(new Date(timestamp).getTime())) return null;
  const days = daysBetween(then, today);
  if (days < 0) return 'scheduled';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 21) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return 'over a year ago';
}

/** "Sep 21" / "Sep 21, 2027" — a due date on a card, in the reps' zone. */
export function shortDate(iso: ISODate | null | undefined, today: ISODate): string | null {
  if (!isISODate(iso)) return null;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', // utcNoon is already the right calendar day
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(utcNoon(iso));
}
