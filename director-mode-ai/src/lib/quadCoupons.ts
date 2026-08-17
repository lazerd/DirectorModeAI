/**
 * Comp / discount codes for Quads entries.
 *
 * A code is scoped either to a single event or to a whole series (so one code
 * covers every date). Claims are atomic — the `used_count < max_uses` guard
 * lives in the UPDATE itself, so two parents submitting the same single-use
 * code at the same moment can't both get it.
 *
 * Deliberately code-based rather than name-based: comping by surname has
 * burned us before (two unrelated families sharing a last name), so the family
 * has to hold the code.
 */

export type CouponCheck =
  | { valid: false; reason: string }
  | {
      valid: true;
      id: string;
      code: string;
      label: string | null;
      discountPercent: number;
      usesLeft: number;
    };

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase().slice(0, 40);
  return t.length === 0 ? null : t;
}

/** Amount owed after a discount, in cents. Rounds to the nearest cent. */
export function discountedCents(feeCents: number, discountPercent: number | null): number {
  if (!discountPercent) return feeCents;
  const pct = Math.min(100, Math.max(0, discountPercent));
  return Math.max(0, Math.round((feeCents * (100 - pct)) / 100));
}

/**
 * Look a code up for an event WITHOUT claiming it — used by the live check on
 * the signup form so a parent knows the code works before submitting.
 */
export async function checkCoupon(
  admin: any,
  args: { code: string; eventId: string; seriesSlug: string | null }
): Promise<CouponCheck> {
  const code = normalizeCode(args.code);
  if (!code) return { valid: false, reason: 'Enter a code.' };

  const scopes: string[] = [`event_id.eq.${args.eventId}`];
  if (args.seriesSlug) scopes.push(`series_slug.eq.${args.seriesSlug}`);

  const { data } = await admin
    .from('quad_coupons')
    .select('id, code, label, discount_percent, max_uses, used_count, active, event_id')
    .ilike('code', code)
    .or(scopes.join(','));

  const rows = (data as any[]) || [];
  if (rows.length === 0) return { valid: false, reason: "That code isn't recognized." };

  // An event-specific code beats a series-wide one with the same text.
  const row = rows.find((r) => r.event_id === args.eventId) ?? rows[0];

  if (!row.active) return { valid: false, reason: 'That code is no longer active.' };
  if (row.used_count >= row.max_uses) {
    return { valid: false, reason: 'That code has already been used.' };
  }

  return {
    valid: true,
    id: row.id,
    code: row.code,
    label: row.label ?? null,
    discountPercent: row.discount_percent,
    usesLeft: row.max_uses - row.used_count,
  };
}

/**
 * Check AND claim in one go. The reservation happens inside a single SQL
 * statement (`claim_quad_coupon`), so a concurrent claim on a single-use code
 * loses cleanly rather than both succeeding. Call `releaseCoupon` if whatever
 * you were doing with the claim then fails.
 */
export async function claimCoupon(
  admin: any,
  args: { code: string; eventId: string; seriesSlug: string | null }
): Promise<CouponCheck> {
  const found = await checkCoupon(admin, args);
  if (!found.valid) return found;

  const { data: claimed, error } = await admin.rpc('claim_quad_coupon', { p_id: found.id });
  if (error) return { valid: false, reason: 'Could not apply that code — try again.' };
  if (claimed !== true) {
    return { valid: false, reason: 'That code was just claimed by someone else.' };
  }

  return { ...found, usesLeft: found.usesLeft - 1 };
}

/** Give a claimed use back (e.g. the entry insert failed after claiming). */
export async function releaseCoupon(admin: any, couponId: string): Promise<void> {
  await admin.rpc('release_quad_coupon', { p_id: couponId });
}
