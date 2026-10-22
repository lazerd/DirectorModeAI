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
 * ClubMode is free (Darrin, 2026-10-21). There are no plans, tiers, trials or
 * day passes: every feature is open to every club, and a club pays only for
 * what it sends (usage pricing below) and for Ask Claude. The plan_tier /
 * subscription columns and the LemonSqueezy Pro products are legacy; nothing
 * reads them to decide what a club may do.
 */
export const PLATFORM_LABEL = 'Free · pay only for what you send';

/* --------------------------- Usage pricing ----------------------------- */
/**
 * ClubMode is free; clubs pay only for what they send (Darrin, 2026-10-21).
 * Every email and every text is billed, with no free allowance. Sign-in and
 * password emails are not ClubMode sends (Supabase auth) and never appear here.
 */
export const EMAIL_PRICE_CENTS = 2;
export const TEXT_PRICE_CENTS = 3;

/**
 * On (Darrin, 2026-10-21): a club without a card on file has its emails held
 * and its texts refused until it adds one, and the nightly usage report bills
 * emails and texts alongside Ask Claude. Off = record-only, nothing blocked or
 * invoiced.
 */
export const METERING_ENFORCED = true;

/** Notice period before an overage rate changes. */
export const RATE_CHANGE_NOTICE_DAYS = 30;

/* --------------------------- Custom club site -------------------------- */
/**
 * SITE SERVICE — Pro, plus a club website we build and keep updated.
 *
 * A SERVICE tier, and the only one. Pro is software: the club does its own
 * edits and the marginal cost of another customer is nothing. This tier
 * includes human work, so it is priced against a floor rather than against
 * effort — a Claude Code subscription plus California's $800 minimum franchise
 * tax is roughly $3,200 a year of fixed cost before anyone is paid. At $25 that
 * takes eleven clubs to clear; at $75 it takes four. That is the whole reason
 * for the number, and it is why it must not be discounted for being easy to
 * deliver: near-zero cost of delivery is the margin, not a discount owed.
 *
 * What the club is actually buying is a site that costs $2,000-5,000 built
 * anywhere else, plus never thinking about skip dates again.
 *
 * DELIBERATELY NOT SELF-SERVE. There is no LemonSqueezy variant and there must
 * not be a buy button: the tier contains a commitment of someone's time, so it
 * is agreed in a conversation. See the note at the top of this file — a price
 * here with no product behind it is how the page and the invoice disagree.
 *
 * The cap is real and is not advertised. Four batches a year at ten clubs is
 * forty sittings, which is fine; at forty clubs it is a job. By then the
 * in-app assistant should be doing the edits and this becomes a legacy line.
 */
export const SITE_SERVICE_PRICE_USD = 75;
/** What it lists at once founding pricing ends. */
export const SITE_SERVICE_LIST_USD = 99;
/** Months of commitment, in place of a setup fee for the initial build. */
export const SITE_SERVICE_MIN_MONTHS = 12;
/** Not published. The point at which this stops being offered to new clubs. */
export const SITE_SERVICE_CLUB_LIMIT = 10;

/* ----------------------------- CaptainMode ----------------------------- */
/**
 * CaptainMode is free like the rest of ClubMode; a captain's emails and texts
 * are metered to their club's card (or their own, with no club).
 */
/**
 * Owned teams per CaptainMode subscription (co-captained teams don't count).
 * Enforced by the teams route via MAX_TEAMS_PER_CAPTAIN in lib/captain/access.
 */
export const CAPTAIN_MAX_TEAMS = 6;

/* ------------------------------ Ask Claude ----------------------------- */
/**
 * The in-app assistant is METERED, and says so on every answer.
 *
 * Darrin, 2026-10-09 / 2026-10-21: AI is never free. Every request is billed
 * on the club's usage charge, and the director watches a live meter the whole
 * time. The meter is the selling point, not a disclaimer:
 * a typical request costs pennies, and seeing that is what makes people use it.

 */
/** Included Ask Claude usage per club per month, in dollars. Nothing is free: billed from the first request. */
export const AI_INCLUDED_USD = 0;
/** A notice goes out each time a club's overage crosses another multiple of this. */
export const AI_NOTICE_STEP_USD = 10;
/**
 * What a club pays per dollar of model cost. 1.5 = cost + 50%. Tuned so a busy
 * director's ~200 requests a month lands around $15 — see lib/assistant/meter.
 */
export const AI_MARKUP = 1.5;
/**
 * Hard stop for the month, in dollars billed. Protects both sides from a
 * runaway loop or a surprise bill; the director is told plainly when it hits.
 */
export const AI_MONTHLY_CAP_USD = 100;
