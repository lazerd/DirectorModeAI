/**
 * GET /api/cron/outreach-send — push approved cards out, a few at a time.
 *
 * Hourly from 13:00 to 23:00 UTC — that covers 8 AM to 3 PM in every US zone
 * the list touches, and sendDue() decides for each individual card whether it
 * is inside its OWN club's window. Running hourly rather than once means an
 * approval at 10 AM goes out at 10 AM, not tomorrow.
 *
 * The hourly tick is a **Supabase pg_cron job** (`outreach-send-hourly`,
 * net.http_get with the CRON_SECRET bearer), not vercel.json: a Hobby account
 * may only run a cron once a day, and an hourly entry in vercel.json fails the
 * whole DEPLOY — every push after the deck landed was rejected until it was
 * taken out. vercel.json keeps a once-daily run as the backstop for a day when
 * the database scheduler is down.
 *
 * Four per tick (BATCH_SIZE) on purpose. Fifteen emails arriving from a
 * two-week-old domain in the same second is the shape of a blast; fifteen
 * spread over a morning is the shape of a person.
 *
 * It cannot send anything that is not already `approved`, and it re-checks
 * the cap, the pause switch, the 30-day rule and the suppression list on
 * every row. Fails closed without CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendDue } from '@/lib/outreach/send';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const report = await sendDue(getSupabaseAdmin());
  return NextResponse.json({ ok: true, ...report });
}
