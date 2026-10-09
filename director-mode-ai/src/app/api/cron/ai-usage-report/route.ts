import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { reportUsage, lsConfigured } from '@/lib/lemonsqueezy';
import { AI_INCLUDED_USD } from '@/config/pricing';

// GET /api/cron/ai-usage-report — Ask Claude overage → LemonSqueezy.
//
// Daily (Vercel Hobby allows once a day). For every club owner with
// pay-as-you-go on, works out this month's overage in cents (billed beyond the
// $5 allowance, exempt rows excluded) and reports only the increase since the
// last run as usage on their metered subscription — 1 unit = 1 cent. On the 1st
// it also settles the month just ended, so the last day's usage is never lost.
// `?dryRun=1` reports what it would send.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function monthStart(d: Date, back = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  if (!dryRun && !lsConfigured()) {
    return NextResponse.json({ skipped: 'LEMONSQUEEZY_API_KEY / STORE_ID not set' });
  }

  const db = getSupabaseAdmin();
  const { data: subs } = await db
    .from('ai_payg_subscriptions')
    .select('user_id, ls_subscription_item_id')
    .eq('status', 'active')
    .not('ls_subscription_item_id', 'is', null);

  const now = new Date();
  // Last month too, so usage between the final run and midnight on the 1st is billed.
  const periods = [monthStart(now, 1), monthStart(now, 0)];
  const results: unknown[] = [];

  for (const s of (subs as { user_id: string; ls_subscription_item_id: string }[] | null) ?? []) {
    for (const start of periods) {
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const { data: rows } = await db
        .from('ai_usage_events')
        .select('billed_micro')
        .eq('billing_user_id', s.user_id)
        .eq('exempt', false)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());
      const billedMicro = ((rows as { billed_micro: number }[] | null) ?? []).reduce((a, r) => a + Number(r.billed_micro || 0), 0);
      const overageCents = Math.max(0, Math.floor(billedMicro / 10_000) - AI_INCLUDED_USD * 100);

      const period = start.toISOString().slice(0, 10);
      const { data: rep } = await db
        .from('ai_usage_reports')
        .select('reported_cents')
        .eq('billing_user_id', s.user_id)
        .eq('period', period)
        .maybeSingle();
      const already = (rep as { reported_cents: number } | null)?.reported_cents ?? 0;
      const delta = overageCents - already;
      if (delta <= 0) continue;

      if (!dryRun) {
        await reportUsage(s.ls_subscription_item_id, delta);
        await db.from('ai_usage_reports').upsert(
          { billing_user_id: s.user_id, period, reported_cents: overageCents, updated_at: new Date().toISOString() },
          { onConflict: 'billing_user_id,period' },
        );
      }
      results.push({ user: s.user_id, period, overageCents, reported: delta });
    }
  }
  return NextResponse.json({ dryRun, accounts: subs?.length ?? 0, results });
}
