import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { CourtSheetEngine } from '@/lib/courtsheet/engine';
import { ConflictsBlockApplyError, PlanIdInvalidError } from '@/lib/courtsheet/apply';
import type { Plan } from '@/lib/courtsheet/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/courtsheet/reservations/apply
 *   body: { plan: Plan, allowConflicts?: boolean, skipConflicting?: boolean,
 *           channel?: 'ai'|'ui'|'api'|'cron' }
 *
 * Executes a previously-computed plan in a transaction. Idempotent by
 * plan_id — retrying with the same plan returns the prior result.
 */
export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const plan = body?.plan as Plan | undefined;
  if (!plan) {
    return NextResponse.json({ error: 'Missing plan' }, { status: 400 });
  }
  if (plan.club_id !== ctx.club.id) {
    return NextResponse.json({ error: 'club_id mismatch' }, { status: 400 });
  }

  const engine = await CourtSheetEngine.load({ db: ctx.db, club_id: ctx.club.id });
  const channel = (body?.channel as 'ai' | 'ui' | 'api' | 'cron' | undefined) ?? 'ui';

  try {
    const result = await engine.applyPlan(
      plan,
      {
        actor_user_id: ctx.user.id,
        channel,
        user_agent: req.headers.get('user-agent') ?? undefined,
      },
      {
        allowConflicts: body?.allowConflicts === true,
        skipConflicting: body?.skipConflicting === true,
      }
    );

    // Fire booker-SMS confirmation if the plan's first toCreate had the
    // opt-in fields in meta. Fire-and-forget — never blocks the response.
    if (result.created_ids.length > 0 && plan.toCreate.length > 0) {
      const firstMeta = plan.toCreate[0].meta as Record<string, unknown> | undefined;
      if (firstMeta?.booker_sms_opt_in && firstMeta?.booker_sms_phone) {
        (async () => {
          try {
            const { data: createdRow } = await ctx.db
              .from('reservations')
              .select('*')
              .eq('id', result.created_ids[0])
              .single();
            if (!createdRow) return;
            const courts = engine.getCourts();
            const court = courts.find((c) => c.id === createdRow.court_id) ?? null;
            const { sendBookingConfirmation } = await import('@/lib/courtsheet/smsConfirm');
            await sendBookingConfirmation({
              reservation: createdRow as import('@/lib/courtsheet/types').Reservation,
              court,
              club: engine.getClub(),
              actor_user_id: ctx.user.id,
            });
          } catch (err) {
            console.error('[courtsheet sms] booking confirmation failed:', err);
          }
        })();
      }
    }

    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof PlanIdInvalidError) {
      return NextResponse.json({ error: 'plan_id invalid' }, { status: 400 });
    }
    if (err instanceof ConflictsBlockApplyError) {
      return NextResponse.json(
        { error: 'conflicts_block_apply', count: err.count },
        { status: 409 }
      );
    }
    console.error('courtsheet apply error:', err);
    return NextResponse.json(
      { error: 'Failed to apply plan', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
