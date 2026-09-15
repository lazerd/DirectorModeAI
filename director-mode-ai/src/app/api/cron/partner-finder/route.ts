import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { runHousekeeping } from '@/lib/partnerFinder/notify';

// GET /api/cron/partner-finder — Partner Finder housekeeping.
//
// Daily at 12:00 UTC (5 AM Pacific, 8 AM Eastern) via vercel.json: marks past
// games that never filled as expired, and sends each of today's groups its
// morning-of reminder. Fails closed without CRON_SECRET, like event-reminders.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await runHousekeeping(getSupabaseAdmin());
  return NextResponse.json({ ok: true, ...result });
}
