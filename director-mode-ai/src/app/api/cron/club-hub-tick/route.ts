import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { runOneBurst } from '@/lib/clubhub/tick';

export const dynamic = 'force-dynamic';

// Optional scheduled tick for Club Hub. NOT wired into vercel.json by default —
// the room is normally kept alive on-demand (src/app/api/club-hub/refresh) so it
// works on any Vercel plan without a cron slot. This route stays available so a
// cron entry can be added on a plan that allows sub-daily crons, or to trigger a
// burst manually. Protected by CRON_SECRET.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try { admin = getSupabaseAdmin(); }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'no admin client' }, { status: 500 }); }

  const result = await runOneBurst(admin);
  return NextResponse.json(result);
}
