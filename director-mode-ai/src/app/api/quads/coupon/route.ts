/**
 * GET /api/quads/coupon?slug=<event-slug>&code=<code>
 *
 * Public, read-only check so the signup form can tell a parent their code is
 * good before they submit. Does NOT claim a use — claiming happens inside
 * /api/quads/register. Returns only what the form needs to render; the code
 * list itself is never exposed.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { checkCoupon, normalizeCode, discountedCents } from '@/lib/quadCoupons';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (b.count >= RATE_LIMIT_MAX) return true;
  b.count += 1;
  return false;
}

export async function GET(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  // Throttled so the endpoint can't be walked to discover codes.
  if (rateLimited(ip)) {
    return NextResponse.json({ valid: false, reason: 'Too many tries — wait a minute.' });
  }

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  const code = normalizeCode(url.searchParams.get('code'));
  if (!slug || !code) {
    return NextResponse.json({ valid: false, reason: 'Enter a code.' });
  }

  const admin = getSupabaseAdmin();
  const { data: ev } = await admin
    .from('events')
    .select('id, series_slug, entry_fee_cents')
    .eq('slug', slug)
    .maybeSingle();
  if (!ev) return NextResponse.json({ valid: false, reason: 'Event not found.' });
  const e = ev as any;

  const result = await checkCoupon(admin, {
    code,
    eventId: e.id,
    seriesSlug: e.series_slug ?? null,
  });

  if (!result.valid) return NextResponse.json({ valid: false, reason: result.reason });

  const owed = discountedCents(e.entry_fee_cents ?? 0, result.discountPercent);
  return NextResponse.json({
    valid: true,
    code: result.code,
    label: result.label,
    discount_percent: result.discountPercent,
    amount_due_cents: owed,
  });
}
