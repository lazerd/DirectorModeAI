/**
 * GET /api/cron/crm-scheduled-send — fire the CRM emails that are due.
 *
 * Every 15 minutes, from a **Supabase pg_cron job** called
 * `crm-scheduled-send` (net.http_get with the CRON_SECRET bearer), NOT from
 * vercel.json. This is a Hobby account: an entry there more frequent than
 * daily fails the whole DEPLOY, not just the cron — every push after the
 * outreach deck landed was rejected until its hourly entry was taken out.
 * Same pattern as `outreach-send-hourly`.
 *
 *   select cron.schedule('crm-scheduled-send', '*''/15 * * * *', $$
 *     select net.http_get(
 *       url     := 'https://clubmode.ai/api/cron/crm-scheduled-send',
 *       headers := jsonb_build_object('Authorization','Bearer <CRON_SECRET>'))
 *   $$);
 *
 * Fifteen minutes means an email scheduled for 8:00 goes out between 8:00 and
 * 8:15. That is the right resolution for a cold email to a volunteer board
 * member and the wrong resolution for anything that needs to be on the minute
 * — nothing here does.
 *
 * Fails closed without CRON_SECRET, and every decision it makes is in
 * lib/crm/scheduledSend.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendDueScheduled } from '@/lib/crm/scheduledSend';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const report = await sendDueScheduled(getSupabaseAdmin());
  return NextResponse.json({ ok: true, ...report });
}
