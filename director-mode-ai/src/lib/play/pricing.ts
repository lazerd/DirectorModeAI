/**
 * Racquets IRL pricing, in one place the server (passes.ts, the 402 paywall) and the
 * marketing pages both read, so the landing page can never promise a different price.
 *
 *   joining any game ........ free, always
 *   your FIRST hosted game .. free (per device, no account)
 *   Host Pass ............... $25/yr, unlimited games
 *   Club Pass ............... $100/yr, every member can host
 */
export const PASS_PRICES = { host: 25, club: 100 } as const;

/** The one-line pricing promise shown next to "Create a game". */
export const PRICING_LINE = `Your first game is free. After that, a Host Pass is $${PASS_PRICES.host} a year. Joining is always free.`;
