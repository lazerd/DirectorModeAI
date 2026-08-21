/**
 * Club time, in one place.
 *
 * NEVER fall back to `undefined` for a timeZone in player-facing output: that
 * means "the runtime's own timezone", which on Vercel is UTC — a 9:30am match
 * then goes out to the whole roster as "4:30 PM".
 *
 * Lives in its own module so both the email builders and the calendar builder
 * can read it without importing each other.
 */
export const CLUB_TZ = 'America/Los_Angeles';
