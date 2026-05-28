import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { CourtSheetEngine } from '@/lib/courtsheet/engine';
import { ConflictsBlockApplyError, PlanIdInvalidError } from '@/lib/courtsheet/apply';
import type { Plan } from '@/lib/courtsheet/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/courtsheet/ai/confirm
 *   body: { plan: Plan, allowConflicts?: boolean, skipConflicting?: boolean }
 *
 * Confirms a plan previously emitted by /ai/chat. Applies it through the
 * engine on the 'ai' channel — audit log records the AI provenance.
 */
export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const plan = body?.plan as Plan | undefined;
  if (!plan) return NextResponse.json({ error: 'Missing plan' }, { status: 400 });
  if (plan.club_id !== ctx.club.id) {
    return NextResponse.json({ error: 'club_id mismatch' }, { status: 400 });
  }

  const engine = await CourtSheetEngine.load({ db: ctx.db, club_id: ctx.club.id });
  try {
    const result = await engine.applyPlan(
      plan,
      {
        actor_user_id: ctx.user.id,
        channel: 'ai',
        user_agent: req.headers.get('user-agent') ?? undefined,
      },
      {
        allowConflicts: body?.allowConflicts === true,
        skipConflicting: body?.skipConflicting === true,
      }
    );
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof PlanIdInvalidError) {
      return NextResponse.json({ error: 'plan_id invalid or expired' }, { status: 400 });
    }
    if (err instanceof ConflictsBlockApplyError) {
      return NextResponse.json(
        { error: 'conflicts_block_apply', count: err.count },
        { status: 409 }
      );
    }
    console.error('ai confirm error:', err);
    return NextResponse.json(
      { error: 'Failed to apply plan', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
