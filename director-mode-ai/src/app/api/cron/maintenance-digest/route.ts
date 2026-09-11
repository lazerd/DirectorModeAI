import { NextRequest, NextResponse } from 'next/server';
import { runMaintenanceDigests } from '@/lib/maintenance/digestRunner';

// GET /api/cron/maintenance-digest — the MaintenanceMode morning email.
//
// Daily at 13:00 UTC (6 AM Pacific) via vercel.json. Vercel Hobby only allows
// once-a-day crons, which is exactly what this is. `?dryRun=1` reports what
// would be sent without sending anything.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const results = await runMaintenanceDigests({ dryRun });
  return NextResponse.json({ dryRun, clubs: results.length, results });
}
