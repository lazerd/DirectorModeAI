/**
 * GET /api/cron/outreach-plan — plan today's cold letters, once a weekday.
 *
 * 13:00 UTC (6 AM Pacific) via vercel.json. Runs the autopilot: with
 * auto_send off it writes `planned` cards for the deck and sends nothing;
 * with it on it writes them `approved`, the hourly sender cron sends them,
 * and the morning digest goes to Darrin and Kevin.
 *
 * Fails closed without CRON_SECRET, like every other cron in the app.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { planAutopilot, sendDigest } from '@/lib/outreach/autopilot';
import { discoverClubs } from '@/lib/outreach/discover';
import { platformOwnerEmails } from '@/lib/platformOwner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getSupabaseAdmin();

  // ?discover=dry: find clubs on the live keys and write nothing. The way to
  // check the Brave + Gemini keys work in production (their values cannot be
  // read back out of Vercel).
  if (request.nextUrl.searchParams.get('discover') === 'dry') {
    const r = await discoverClubs(db, { count: 1, dryRun: true });
    return NextResponse.json({ ok: true, note: r.note, found: (r.accepted ?? []).map((c) => `${c.club} (${c.state})`) });
  }
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

  // The autopilot: 3 Directors Club + 3 found clubs, letters A/B, then the
  // morning digest to Darrin and Kevin. With auto_send off the cards wait in
  // the deck exactly as before. See lib/outreach/autopilot.ts.
  const result = await planAutopilot(db, { repEmail });
  const digest = result.auto_send ? await sendDigest(db, result) : { sent: false, error: 'autopilot off' };
  return NextResponse.json({
    ok: true,
    date: result.date,
    auto_send: result.auto_send,
    planned: result.planned,
    discovered: result.discovered,
    note: result.note,
    digest,
  });
}
