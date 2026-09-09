/**
 * One definition of what a brand-new club row looks like.
 *
 * Four places used to create clubs, each with its own idea of the defaults:
 *
 *   /api/onboarding/first-run   join code, public, accepts join requests, no timezone
 *   /courtsheet/staff           no join code, private, timezone hardcoded
 *   courtsheet/routeAuth        no join code, private, timezone hardcoded
 *   /courtconnect/club          no join code, no timezone, rest from a form
 *
 * Which page a director happened to open first therefore decided their club's
 * name, visibility, timezone and — worst — whether it had a join code at all.
 * A club created anywhere but first-run had none, and join_code is what
 * /join/<code> and the members page run on, so those directors could never
 * invite anybody and had no screen anywhere to fix it.
 *
 * This module owns the row. Callers pass what they actually know and override
 * only what they mean to; everything else is the same everywhere.
 */

/**
 * Fallback when nobody has said where the club is.
 *
 * Matches the DB column default so a row written without a timezone and a row
 * written through here agree. It is a fallback, NOT a guess to be relied on —
 * onboarding asks, and anything reading club.timezone gets a real answer for
 * clubs created after that shipped.
 */
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/** No O/0/I/1 — these get read aloud and typed in by members. */
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;

export function makeJoinCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    out += JOIN_CODE_ALPHABET[Math.floor(random() * JOIN_CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Is this a timezone this runtime actually knows?
 *
 * The value reaches us from a browser (Intl's guess) or a picker, and a bad
 * one poisons every time the club ever displays — so it is checked here rather
 * than trusted. Asking Intl is the only honest check; there is no list to
 * compare against that will not rot.
 */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * A join code no club is already using.
 *
 * There is no unique index on cc_clubs.join_code, and /api/clubs/join resolves
 * a code with .ilike().maybeSingle() — which THROWS on two matches rather than
 * picking one. A collision therefore breaks joining for both clubs at once.
 *
 * Only /start used to mint codes; now every creation path does, so the odds
 * stop being theoretical: the space is 32^6, and collision probability grows
 * with the square of the club count (~5% at ten thousand clubs).
 *
 * `isTaken` is injected rather than importing a DB client, because this runs
 * from both server routes and a browser form, with different clients.
 */
export async function uniqueJoinCode(
  isTaken: (code: string) => Promise<boolean>,
  random: () => number = Math.random,
  attempts = 12,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const code = makeJoinCode(random);
    if (!(await isTaken(code))) return code;
  }
  /*
   * Twelve misses in a billion-code space means something is badly wrong —
   * but failing club creation outright would be worse than a longer code, so
   * widen the space instead of giving up. An 8-character code is still valid
   * everywhere a 6-character one is.
   */
  return makeJoinCode(random) + makeJoinCode(random).slice(0, 2);
}

export type NewClubInput = {
  ownerId: string;
  name: string;
  slug: string;
  /** The club's wall-clock timezone. Invalid or absent falls back. */
  timezone?: string | null;
  /** Listed in the public club directory. */
  isPublic?: boolean;
  acceptJoinRequests?: boolean;
  /** Bootstrapped clubs (someone opened a staff tool) start with no sport set. */
  sports?: string[];
  /** A code checked for uniqueness by the caller. One is minted if absent. */
  joinCode?: string;
};

export type NewClubRow = {
  owner_id: string;
  name: string;
  slug: string;
  join_code: string;
  timezone: string;
  is_public: boolean;
  accept_join_requests: boolean;
  sports: string[];
  operating_hours: Record<string, unknown>;
};

/**
 * The row to insert for a new club.
 *
 * Every club gets a join code, always — that is the single most important
 * thing this function does. A club without one is a dead end for its members
 * and there is no UI to repair it.
 */
export function newClubRow(input: NewClubInput, random: () => number = Math.random): NewClubRow {
  return {
    owner_id: input.ownerId,
    name: input.name.trim(),
    slug: input.slug,
    join_code: input.joinCode ?? makeJoinCode(random),
    timezone: isValidTimezone(input.timezone) ? input.timezone : DEFAULT_TIMEZONE,
    is_public: input.isPublic ?? true,
    accept_join_requests: input.acceptJoinRequests ?? true,
    sports: input.sports ?? ['tennis'],
    operating_hours: {},
  };
}
