import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// Runs daily; resets usage_credits at month rollover.
// Add a Vercel Cron entry hitting GET /api/cron/reset-monthly-usage at 00:05 UTC.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data: stale } = await supabase
    .from('usage_credits')
    .select('user_id')
    .lt('period_start', monthStart);

  const ids = (stale || []).map((r) => r.user_id);
  if (ids.length === 0) {
    return NextResponse.json({ reset: 0, monthStart });
  }

  const { error } = await supabase
    .from('usage_credits')
    .update({
      period_start: monthStart,
      emails_used: 0,
      sms_used: 0,
      sms_overage_cents: 0,
      tts_chars_used: 0,
      ai_calls_used: 0,
      updated_at: new Date().toISOString(),
    })
    .in('user_id', ids);

  if (error) {
    return NextResponse.json({ error: 'reset_failed', message: error.message }, { status: 500 });
  }

  return NextResponse.json({ reset: ids.length, monthStart });
}
