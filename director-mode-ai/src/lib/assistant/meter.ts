/**
 * The Ask Claude meter — what each assistant request cost, and what the club has
 * spent this month.
 *
 * Pricing is Darrin's (2026-10-09, constants in config/pricing): every club gets
 * AI_INCLUDED_USD a month, anything beyond is billed on top of the plan, a
 * notice goes out at every AI_NOTICE_STEP_USD of overage, and the director sees
 * the running total on every answer. The platform owner's own clubs are metered
 * for visibility but never billed.
 *
 * The arithmetic is pure and exported so it is tested without a database; the
 * two async functions at the bottom are the only places that touch one.
 */

import {
  AI_INCLUDED_USD,
  AI_MARKUP,
  AI_MONTHLY_CAP_USD,
  AI_NOTICE_STEP_USD,
} from '@/config/pricing';

const MICRO = 1_000_000;

/** USD per million tokens. Cache writes cost 1.25x input, cache reads 0.1x. */
type Rates = { input: number; output: number };
const RATES: { match: RegExp; rates: Rates }[] = [
  { match: /haiku/i, rates: { input: 1, output: 5 } },
  { match: /opus/i, rates: { input: 5, output: 25 } },
  { match: /sonnet|fable/i, rates: { input: 3, output: 15 } },
];
/** An unknown model is priced as the most expensive family we use, never as free. */
const FALLBACK: Rates = { input: 5, output: 25 };

export function ratesFor(model: string): Rates {
  return RATES.find((r) => r.match.test(model))?.rates ?? FALLBACK;
}

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

export const emptyUsage = (): TokenUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
});

/** Fold one API response's `usage` into a running total for the request. */
export function addUsage(total: TokenUsage, u: any): TokenUsage {
  return {
    input_tokens: total.input_tokens + Math.max(0, u?.input_tokens ?? 0),
    output_tokens: total.output_tokens + Math.max(0, u?.output_tokens ?? 0),
    cache_read_tokens: total.cache_read_tokens + Math.max(0, u?.cache_read_input_tokens ?? 0),
    cache_write_tokens: total.cache_write_tokens + Math.max(0, u?.cache_creation_input_tokens ?? 0),
  };
}

/** What Anthropic charges us for this usage, in micro-dollars. */
export function costMicro(model: string, u: TokenUsage): number {
  const r = ratesFor(model);
  // rate is $/1M tokens, so tokens * rate is already micro-dollars.
  return Math.round(
    u.input_tokens * r.input +
      u.output_tokens * r.output +
      u.cache_write_tokens * r.input * 1.25 +
      u.cache_read_tokens * r.input * 0.1,
  );
}

/**
 * What a club pays for that cost. Priced the same for exempt accounts: their
 * rows carry exempt=true and are left off any invoice, but the meter shows the
 * platform owner exactly what a paying club would see.
 */
export function billedMicro(cost: number): number {
  return Math.round(cost * AI_MARKUP);
}

export type MeterSnapshot = {
  /** Billed so far this month, dollars. */
  spentUsd: number;
  includedUsd: number;
  /** The part of spentUsd beyond the allowance — what lands on the invoice. */
  overageUsd: number;
  capUsd: number;
  /** This request alone, dollars (absent when reading the meter cold). */
  thisRequestUsd?: number;
  exempt: boolean;
  /** Set when this request carried the club past another $10 of overage. */
  notice?: string;
};

export function snapshot(spentMicro: number, exempt: boolean, thisMicro?: number): MeterSnapshot {
  const spentUsd = spentMicro / MICRO;
  return {
    spentUsd,
    includedUsd: AI_INCLUDED_USD,
    overageUsd: Math.max(0, spentUsd - AI_INCLUDED_USD),
    capUsd: AI_MONTHLY_CAP_USD,
    ...(thisMicro !== undefined ? { thisRequestUsd: thisMicro / MICRO } : {}),
    exempt,
  };
}

/** How many whole notice steps of overage a month total represents. */
export function noticeStep(spentMicro: number): number {
  const over = spentMicro / MICRO - AI_INCLUDED_USD;
  return over <= 0 ? 0 : Math.floor(over / AI_NOTICE_STEP_USD);
}

export function overCap(spentMicro: number, exempt: boolean): boolean {
  return !exempt && spentMicro / MICRO >= AI_MONTHLY_CAP_USD;
}

/** First instant of the current month, UTC — the meter's period. */
export function periodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/* ------------------------------ database ------------------------------ */

type Db = { from: (t: string) => any };

/** Total billed this month for one billing account, micro-dollars. */
export async function monthBilledMicro(db: Db, billingUserId: string, now = new Date()): Promise<number> {
  const { data } = await db
    .from('ai_usage_events')
    .select('billed_micro')
    .eq('billing_user_id', billingUserId)
    .gte('created_at', periodStart(now).toISOString());
  return ((data as { billed_micro: number }[] | null) ?? []).reduce((s, r) => s + Number(r.billed_micro || 0), 0);
}

/**
 * Write one request to the meter and return the club's new monthly position.
 * If the request carried them past a new $10 step, `notice` is set and the
 * step is recorded so the same step is never announced twice.
 */
export async function recordRequest(
  db: Db,
  args: {
    billingUserId: string;
    userId: string;
    clubId: string | null;
    model: string;
    rounds: number;
    usage: TokenUsage;
    page: string | null;
    exempt: boolean;
  },
): Promise<MeterSnapshot & { noticeStep?: number }> {
  const cost = costMicro(args.model, args.usage);
  const billed = billedMicro(cost);
  const before = await monthBilledMicro(db, args.billingUserId);
  await db.from('ai_usage_events').insert({
    billing_user_id: args.billingUserId,
    user_id: args.userId,
    club_id: args.clubId,
    model: args.model,
    rounds: args.rounds,
    ...args.usage,
    cost_micro: cost,
    billed_micro: billed,
    exempt: args.exempt,
    page: args.page,
  });
  const after = before + billed;
  const snap = snapshot(after, args.exempt, billed);

  const step = noticeStep(after);
  if (!args.exempt && step > noticeStep(before)) {
    const { error } = await db.from('ai_overage_notices').insert({
      billing_user_id: args.billingUserId,
      period: periodStart().toISOString().slice(0, 10),
      step,
    });
    // A duplicate-key error means another request already announced this step.
    if (!error) {
      return {
        ...snap,
        noticeStep: step,
        notice: `Heads up: Ask Claude is now $${(step * AI_NOTICE_STEP_USD).toFixed(0)} over your $${AI_INCLUDED_USD} monthly allowance. That will be added to this month's bill.`,
      };
    }
  }
  return snap;
}
