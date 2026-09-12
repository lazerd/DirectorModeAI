/**
 * What an hour of court time costs.
 *
 * A club's answer to that is never one number. Lafayette's is "free to members,
 * $24 to the public"; the club down the road charges more after 4pm and on
 * weekends. So a rate card is (audience × slice of the week × price per hour),
 * and a price is computed by walking the booking across whichever cards cover
 * it.
 *
 * THE CASE THAT MATTERS: a booking that straddles a boundary. A 3:30–5:30 court
 * on a club with off-peak until 4pm and peak after is 30 minutes at one rate
 * and 90 at the other. Charging the whole thing at either rate is wrong in a
 * way a member notices and complains about, so this prices PER SEGMENT and
 * hands back the breakdown for the receipt.
 *
 * Pure. No I/O, no clock — the caller supplies the day and the times, in club
 * local terms, because the club's timezone is the only one that matters and the
 * server's is never it.
 */

export type RateCard = {
  id: string;
  label: string;
  applies_to: 'member' | 'public';
  /** Postgres DOW: 0=Sun..6=Sat. Empty means every day. */
  days_of_week: number[] | null;
  /** Club-local HH:MM(:SS). */
  time_start: string;
  time_end: string;
  /** Per hour. */
  price_cents: number;
  advance_days: number;
  min_minutes: number | null;
  max_minutes: number | null;
  active?: boolean;
  note?: string | null;
};

export type PriceSegment = {
  rate_card_id: string;
  label: string;
  minutes: number;
  price_cents_per_hour: number;
  cents: number;
};

export type PriceResult =
  | { ok: true; cents: number; segments: PriceSegment[] }
  /**
   * A gap in the club's own price list, not a user error. The booking page
   * must not offer a slot it cannot price, and the message names the hole so a
   * director can fix it rather than wondering why a time vanished.
   */
  | { ok: false; reason: 'no_rate'; uncoveredFrom: string; uncoveredTo: string };

/** 'HH:MM' or 'HH:MM:SS' → minutes past midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Minutes past midnight → 'HH:MM'. */
export function toHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const coversDay = (card: RateCard, dow: number): boolean =>
  !card.days_of_week || card.days_of_week.length === 0 || card.days_of_week.includes(dow);

/** The cards that could price this audience on this day, narrowest first. */
export function cardsFor(
  cards: RateCard[],
  audience: 'member' | 'public',
  dow: number,
): RateCard[] {
  return cards
    .filter((c) => c.active !== false)
    .filter((c) => c.applies_to === audience)
    .filter((c) => coversDay(c, dow))
    .sort((a, b) => {
      /*
       * Narrowest window wins where two overlap. A club that sets an all-day
       * base rate and then a 4pm–10pm peak means the peak to apply after 4pm —
       * the more specific rule is the one they were thinking about when they
       * typed it. Day-specific beats all-week for the same reason.
       */
      const span = (c: RateCard) => toMinutes(c.time_end) - toMinutes(c.time_start);
      const dayScoped = (c: RateCard) => (c.days_of_week && c.days_of_week.length > 0 ? 0 : 1);
      return dayScoped(a) - dayScoped(b) || span(a) - span(b) || toMinutes(a.time_start) - toMinutes(b.time_start);
    });
}

/**
 * Price one booking.
 *
 * `startTime` is club-local 'HH:MM'; `minutes` is its length. A booking is
 * walked minute by minute in one-minute steps only conceptually — in practice
 * it advances to the next boundary, so a 2-hour booking is two segments, not
 * 120.
 */
export function priceBooking(
  cards: RateCard[],
  opts: { audience: 'member' | 'public'; dayOfWeek: number; startTime: string; minutes: number },
): PriceResult {
  const applicable = cardsFor(cards, opts.audience, opts.dayOfWeek);
  const start = toMinutes(opts.startTime);
  const end = start + opts.minutes;

  const segments: PriceSegment[] = [];
  let cursor = start;
  let guard = 0;

  while (cursor < end) {
    // Runaway guard: a malformed card set must not spin the request forever.
    if (++guard > 100) break;

    const rank = applicable.findIndex(
      (c) => toMinutes(c.time_start) <= cursor && toMinutes(c.time_end) > cursor,
    );
    const card = rank === -1 ? undefined : applicable[rank];
    if (!card) {
      // Report the whole uncovered stretch, not just the first minute of it.
      const nextCoveredStart = applicable
        .map((c) => toMinutes(c.time_start))
        .filter((s) => s > cursor)
        .sort((a, b) => a - b)[0];
      const gapEnd = Math.min(end, nextCoveredStart ?? end);
      return {
        ok: false,
        reason: 'no_rate',
        uncoveredFrom: toHHMM(cursor),
        uncoveredTo: toHHMM(gapEnd),
      };
    }

    /*
     * Where this segment ends.
     *
     * Not simply the card's own end: a booking can run INTO a narrower window
     * that starts later. An 11:30–13:30 court at a club with an all-day base
     * rate and a 12:00–13:00 lunch rate has to stop at 12:00 and re-price, or
     * the cheaper hour is charged at the base rate and the club is quietly
     * overcharging. So the segment also ends at the start of any card ranked
     * ahead of this one — `applicable` is sorted narrowest-first, so "earlier
     * in the list" is exactly "more specific".
     */
    const nextNarrowerStart = applicable
      .slice(0, rank)
      .map((c) => toMinutes(c.time_start))
      .filter((s) => s > cursor)
      .sort((a, b) => a - b)[0];

    const segmentEnd = Math.min(
      end,
      toMinutes(card.time_end),
      nextNarrowerStart ?? Number.POSITIVE_INFINITY,
    );
    const segmentMinutes = segmentEnd - cursor;

    const cents = Math.round((card.price_cents * segmentMinutes) / 60);
    const existing = segments.find((s) => s.rate_card_id === card.id);
    if (existing) {
      // Same card reached twice (a gap-free split around another window):
      // one line on the receipt, not two.
      existing.minutes += segmentMinutes;
      existing.cents += cents;
    } else {
      segments.push({
        rate_card_id: card.id,
        label: card.label,
        minutes: segmentMinutes,
        price_cents_per_hour: card.price_cents,
        cents,
      });
    }

    cursor = segmentEnd;
  }

  return { ok: true, cents: segments.reduce((sum, s) => sum + s.cents, 0), segments };
}

/**
 * How many days ahead this audience may book, and the allowed lengths.
 *
 * Taken as the most GENEROUS of the audience's cards: if any card lets a member
 * book 7 days out, they can book 7 days out. The alternative — the strictest —
 * would mean adding a single peak-hour card silently shortened the whole club's
 * booking window.
 */
export function bookingRules(
  cards: RateCard[],
  audience: 'member' | 'public',
): { advanceDays: number; minMinutes: number; maxMinutes: number } {
  const mine = cards.filter((c) => c.active !== false && c.applies_to === audience);
  if (mine.length === 0) return { advanceDays: 0, minMinutes: 60, maxMinutes: 120 };
  return {
    advanceDays: Math.max(...mine.map((c) => c.advance_days)),
    // Tightest min and loosest max — the union of what the club allows.
    minMinutes: Math.min(...mine.map((c) => c.min_minutes ?? 60)),
    maxMinutes: Math.max(...mine.map((c) => c.max_minutes ?? 120)),
  };
}

/** Does this club take online court bookings at all? */
export function bookingEnabled(cards: RateCard[]): boolean {
  return cards.some((c) => c.active !== false);
}

/**
 * The durations to offer, in minutes.
 *
 * Half-hour steps between the club's own limits, capped so the list stays a
 * list of buttons rather than a scroll.
 */
export function durationOptions(rules: {
  minMinutes: number;
  maxMinutes: number;
}): number[] {
  const out: number[] = [];
  for (let m = Math.max(30, rules.minMinutes); m <= rules.maxMinutes && out.length < 8; m += 30) {
    out.push(m);
  }
  return out.length ? out : [60];
}
