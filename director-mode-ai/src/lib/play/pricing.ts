/**
 * Racquets IRL pricing for the marketing pages. Must match PASS_PRICES in passes.ts (the 402
 * paywall); a test checks they agree.
 *
 *   joining any game ........ free, always
 *   your FIRST hosted game .. free (per device, no account)
 *   Host Pass ............... $25/yr, unlimited games
 *   Club Pass ............... $100/yr, every member can host
 */
export const PASS_PRICES = { host: 25, club: 100 } as const;

/**
 * Free at launch (Darrin, 11/25/26: "turn the charge off, leave it free for now").
 * While true, nobody is asked for a Host Pass: hosting, run-backs and joining are all
 * free, and the group-email quota isn't enforced. Flip to false to bring the
 * $25/yr Host Pass back; the paywall code is untouched.
 */
export const FREE_AT_LAUNCH = true;

/** The one-line pricing promise shown next to "Create a game". */
export const PRICING_LINE = FREE_AT_LAUNCH
  ? 'Free at launch. Hosting and joining are free.'
  : `Your first game is free. After that, a Host Pass is $${PASS_PRICES.host} a year. Joining is always free.`;
