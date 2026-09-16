/**
 * POST /api/outreach/plan — build (or preview) a batch on demand.
 *
 *   {}                  plan today's batch and write the rows
 *   { dry_run: true }   write nothing, hand back the cards it WOULD write
 *
 * The dry run exists because the first thing anyone should do with a cold
 * outreach engine pointed at 519 real clubs is look at fifteen real cards and
 * send none of them. It costs model calls and touches no table.
 *
 * The cron calls the same planner; this route is the "do it now" button.
 */
import { NextResponse } from 'next/server';
import { isCrmAuthError, requireCrm } from '@/lib/crm/server';
import { planDay } from '@/lib/outreach/plan';

export const dynamic = 'force-dynamic';
// 15 cards means 15 model calls, one after another.
export const maxDuration = 300;

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const dryRun = body.dry_run === true;

  try {
    const result = await planDay(ctx.db, {
      repEmail: ctx.repEmail,
      repName: ctx.repName,
      dryRun,
      date: typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined,
    });
    return NextResponse.json({ dry_run: dryRun, ...result }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Planning failed.' }, { status: 500 });
  }
}
