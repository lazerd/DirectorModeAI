/**
 * pricing.ts — the published prices, in one client-safe place.
 *
 * These numbers appear on the pricing page, on every upgrade button, and in the
 * billing UI. They used to be typed literally into each one, which is how the
 * app ended up advertising $49 on /pricing while the upgrade button still said
 * "$29/mo" and offered a $290/yr annual plan that no longer exists.
 *
 * Deliberately client-safe: no imports, no server-only modules, so a 'use client'
 * component can read it. src/lib/billing.ts (server-only) imports FROM here, not
 * the other way round.
 *
 * These are the ADVERTISED prices only. What a customer is actually charged is
 * set by the LemonSqueezy product behind the buy link — the app never sends a
 * price, only a `price_key` that maps to a tier. Changing a number here changes
 * what the UI claims, NOT what anyone pays. Update the LemonSqueezy product too,
 * or the page and the invoice will disagree.
 */

/**
 * FOUNDING MODE — everything is unlocked for everyone.
 *
 * ClubMode has zero paying customers. Enforcing caps against nobody costs real
 * engineering time and can only ever produce one outcome: a new director hits a
 * wall on their first afternoon and leaves. So every feature gate, every usage
 * cap and every upgrade prompt is inert while this is on, and the account state
 * reads "Founding club — everything unlocked".
 *
 * Lives here (client-safe) rather than in src/lib/billing.ts so 'use client'
 * banners and buttons can hide themselves too; billing.ts re-exports it. The
 * machinery is deliberately left standing — the limits in TIER_LIMITS are the
 * real published numbers, so turning this off is a one-line change that starts
 * enforcing the plan as advertised.
 */
export const FOUNDING_MODE = true;

/** Shown wherever the plan state is surfaced while FOUNDING_MODE is on. */
export const FOUNDING_LABEL = 'Founding club — everything unlocked';

/** ClubMode Pro, per month, list price. */
export const PRO_PRICE_USD = 49;

/** Founding-club rate: first N clubs, locked for M months. */
export const FOUNDING_PRICE_USD = 25;
export const FOUNDING_CLUB_LIMIT = 25;
export const FOUNDING_LOCK_MONTHS = 24;

/** Texts included in Pro each month, and the per-text rate beyond that. */
export const INCLUDED_TEXTS = 300;
export const TEXT_OVERAGE_CENTS = 2;

/** Notice period before an overage rate changes. */
export const RATE_CHANGE_NOTICE_DAYS = 30;

/**
 * There is no annual plan. It was removed when Pro moved to $49 — the discount
 * was doing nothing except complicating the page and creating a second SKU to
 * keep in sync. `pro_annual` still exists as a PriceKey in lemonsqueezy.ts so
 * that historical webhooks for anyone who bought one still resolve to Pro, but
 * nothing in the UI may offer it: its buy link is null, so the checkout would
 * fail.
 */
export const ANNUAL_PLAN_OFFERED = false;

/* ----------------------------- CaptainMode ----------------------------- */
/**
 * CaptainMode is billed to the CAPTAIN, not the club, and the rate depends on
 * whether their club is on ClubMode (Pro, or any club while FOUNDING_MODE is
 * on). Which rate applies is resolved server-side in resolveCaptainRate() —
 * never chosen by the client.
 *
 * These are the ONLY CaptainMode numbers. /pricing, /captainmode, /captain/start
 * and /captain/subscribe used to type their own ($12 vs $20, "3 teams" vs the 6
 * the teams route enforces); every surface now reads these.
 */
export const CAPTAIN_CLUB_PRICE_USD = 10;
export const CAPTAIN_SOLO_PRICE_USD = 20;

/**
 * Owned teams per CaptainMode subscription (co-captained teams don't count).
 * Enforced by the teams route via MAX_TEAMS_PER_CAPTAIN in lib/captain/access.
 */
export const CAPTAIN_MAX_TEAMS = 6;
