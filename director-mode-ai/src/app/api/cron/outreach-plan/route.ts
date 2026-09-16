/**
 * GET /api/cron/outreach-plan — build tomorrow's deck, once a day.
 *
 * 13:00 UTC (6 AM Pacific) via vercel.json, so the cards are waiting when
 * Darrin picks up his phone. Planning is the expensive half — one model call
 * per card — and it writes `planned` rows only. Nothing it does can put an
 * email in an inbox; that needs a human swipe and then the sender cron.
 *
 * Fails closed without CRON_SECRET, like every other cron in the app.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { planDay } from '@/lib/outreach/plan';
import { platformOwnerEmails } from '@/lib/platformOwner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  // A cron has no signed-in rep. The cards go to whoever is on the allowlist
  // first — in practice Darrin — and a right swipe re-stamps rep_email with
  // whoever actually decided, so ownership follows the human, not the cron.
  const { data } = await db
    .from('crm_users')
    .select('email, full_name')
    .eq('active', true)
    .order('created_at')
    .limit(1);
  const rep = ((data as { email: string; full_name: string | null }[] | null) ?? [])[0];
  const repEmail = rep?.email ?? platformOwnerEmails()[0] ?? '';
  if (!repEmail) {
    return NextResponse.json({ ok: false, error: 'No CRM user to plan for.' }, { status: 200 });
  }

  const result = await planDay(db, { repEmail, repName: rep?.full_name || repEmail });
  return NextResponse.json({
    ok: true,
    date: result.date,
    cap: result.cap,
    paused: result.paused,
    planned: result.planned,
    intros: result.intros,
    follow_ups: result.follow_ups,
    note: result.note,
  });
}
