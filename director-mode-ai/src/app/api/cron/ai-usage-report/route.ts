import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { reportUsage, lsConfigured } from '@/lib/lemonsqueezy';
import { releaseHeldEmails } from '@/lib/email';
import { AI_INCLUDED_USD, METERING_ENFORCED, MIN_CHARGE_USD } from '@/config/pricing';

// GET /api/cron/ai-usage-report — Ask Claude overage, plus emails and texts
// once METERING_ENFORCED is on, → LemonSqueezy.
//
// Daily (Vercel Hobby allows once a day). For every club owner with
// pay-as-you-go on, works out this month's overage in cents (billed beyond the
// $5 allowance, exempt rows excluded) and reports only the increase since the
// last run as usage on their metered subscription — 1 unit = 1 cent. LemonSqueezy
// charges the card once a month at renewal, never per report. Nothing is reported
// until a club owes MIN_CHARGE_USD; smaller balances carry forward month to month.
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
  const results: unknown[] = [];

  for (const s of (subs as { user_id: string; ls_subscription_item_id: string }[] | null) ?? []) {
    // Backstop for the webhook: anything still held for a club with a card goes out.
    if (!dryRun && METERING_ENFORCED) {
      const rel = await releaseHeldEmails(s.user_id);
      if (rel.released || rel.failed) results.push({ user: s.user_id, heldReleased: rel.released, heldFailed: rel.failed });
    }
    // Every month this club owes something for and we haven't reported yet. Under-threshold balances
    // carry forward, so this looks back over the whole year, not just this month and last.
    const owed: { period: string; overageCents: number; delta: number }[] = [];
    for (let back = 12; back >= 0; back--) {
      const start = monthStart(now, back);
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const { data: rows } = await db
        .from('ai_usage_events')
        .select('billed_micro')
        .eq('billing_user_id', s.user_id)
        .eq('exempt', false)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());
      const billedMicro = ((rows as { billed_micro: number }[] | null) ?? []).reduce((a, r) => a + Number(r.billed_micro || 0), 0);
      const aiCents = Math.max(0, Math.floor(billedMicro / 10_000) - AI_INCLUDED_USD * 100);
      let sendCents = 0;
      if (METERING_ENFORCED) {
        const { data: sends } = await db
          .from('usage_events')
          .select('billed_cents')
          .eq('billing_user_id', s.user_id)
          .eq('exempt', false)
          .gte('created_at', start.toISOString())
          .lt('created_at', end.toISOString());
        sendCents = ((sends as { billed_cents: number }[] | null) ?? []).reduce((a, r) => a + Number(r.billed_cents || 0), 0);
      }
      const overageCents = aiCents + sendCents;
      if (!overageCents) continue;

      const period = start.toISOString().slice(0, 10);
      const { data: rep } = await db
        .from('ai_usage_reports')
        .select('reported_cents')
        .eq('billing_user_id', s.user_id)
        .eq('period', period)
        .maybeSingle();
      const already = (rep as { reported_cents: number } | null)?.reported_cents ?? 0;
      if (overageCents > already) owed.push({ period, overageCents, delta: overageCents - already });
    }

    // Nothing goes on the card until the club owes MIN_CHARGE_USD (Darrin 2026-10-23: the card
    // fee would eat a 40-cent bill). Smaller balances wait for a later run.
    const pending = owed.reduce((a, o) => a + o.delta, 0);
    if (!pending) continue;
    if (pending < MIN_CHARGE_USD * 100) {
      results.push({ user: s.user_id, carriedCents: pending });
      continue;
    }
    if (!dryRun) {
      await reportUsage(s.ls_subscription_item_id, pending);
      await db.from('ai_usage_reports').upsert(
        owed.map((o) => ({ billing_user_id: s.user_id, period: o.period, reported_cents: o.overageCents, updated_at: new Date().toISOString() })),
        { onConflict: 'billing_user_id,period' },
      );
    }
    results.push({ user: s.user_id, reported: pending, periods: owed.map((o) => o.period) });
  }
  return NextResponse.json({ dryRun, accounts: subs?.length ?? 0, results });
}
