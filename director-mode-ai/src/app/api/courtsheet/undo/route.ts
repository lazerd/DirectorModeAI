import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { CourtSheetEngine } from '@/lib/courtsheet/engine';
import { PlanIdInvalidError } from '@/lib/courtsheet/apply';

export const dynamic = 'force-dynamic';

/**
 * POST /api/courtsheet/undo
 *   body: { plan_id: string }
 *
 * Replays the reverse-plan stored on the audit row for plan_id.
 */
export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const plan_id = body?.plan_id as string | undefined;
  if (!plan_id) return NextResponse.json({ error: 'Missing plan_id' }, { status: 400 });

  const engine = await CourtSheetEngine.load({ db: ctx.db, club_id: ctx.club.id });
  try {
    const result = await engine.undo(plan_id, {
      actor_user_id: ctx.user.id,
      channel: 'ui',
    });
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof PlanIdInvalidError) {
      return NextResponse.json({ error: 'plan_id invalid' }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Undo failed', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
