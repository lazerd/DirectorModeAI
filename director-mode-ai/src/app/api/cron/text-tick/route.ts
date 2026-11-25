/**
 * Hourly (Supabase pg_cron): each director's 7am huddle and 6pm recap, in their club's
 * time zone. Safe to run more often: each line gets one of each per day.
 */
import { NextRequest, NextResponse } from 'next/server';
import { tick } from '@/lib/textstaff/inbound';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await tick());
}
