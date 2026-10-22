/**
 * The club owner's monthly spending limit (emails + texts + Ask Claude).
 *
 * GET  → { limitCents, spentCents } for the caller's club.
 * POST { limitDollars: number | null } → set it (owner only). null = no limit.
 *      Raising the limit sends any emails that were waiting on it.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { monthSpendCents, monthlyLimitCents, sendBilling } from '@/lib/usageMeter';
import { releaseHeldEmails } from '@/lib/email';
import { background } from '@/lib/partnerFinder/background';
import { blockIfDemo } from '@/lib/demo/server';

export const dynamic = 'force-dynamic';

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { billingUserId } = await sendBilling(user.id);
  return { user, billingUserId, isOwner: billingUserId === user.id };
}

export async function GET() {
  const c = await caller();
  if (!c) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const [limitCents, spentCents] = await Promise.all([
    monthlyLimitCents(c.billingUserId),
    monthSpendCents(c.billingUserId),
  ]);
  return NextResponse.json({ limitCents, spentCents, isOwner: c.isOwner });
}

export async function POST(req: Request) {
  const c = await caller();
  if (!c) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const demo = await blockIfDemo(c.user.id);
  if (demo) return demo;
  if (!c.isOwner) {
    return NextResponse.json({ error: 'Only the club owner can change the spending limit.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const raw = body?.limitDollars;
  let limitCents: number | null;
  if (raw === null || raw === '' || raw === undefined) {
    limitCents = null;
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100_000) {
      return NextResponse.json({ error: 'Enter a monthly limit in dollars, like 50.' }, { status: 400 });
    }
    limitCents = Math.round(n * 100);
  }

  const { error } = await getSupabaseAdmin()
    .from('usage_limits')
    .upsert(
      { billing_user_id: c.billingUserId, monthly_limit_cents: limitCents, updated_at: new Date().toISOString() },
      { onConflict: 'billing_user_id' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If the new limit leaves room, whatever was waiting on it goes out now.
  background('release held emails after limit change', () => releaseHeldEmails(c.billingUserId));
  return NextResponse.json({ ok: true, limitCents });
}
