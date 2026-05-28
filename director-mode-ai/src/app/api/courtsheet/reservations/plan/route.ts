import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { CourtSheetEngine } from '@/lib/courtsheet/engine';
import { PlanTooLargeError } from '@/lib/courtsheet/planner';
import type { BookingIntent, Mutation } from '@/lib/courtsheet/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/courtsheet/reservations/plan
 *   body: { kind: 'book', intent: BookingIntent }
 *     or  { kind: 'mutate', mutation: Mutation }
 *
 * Dry-run only. Returns a Plan the client renders as a preview before
 * confirming via /apply. No DB writes.
 */
export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const engine = await CourtSheetEngine.load({ db: ctx.db, club_id: ctx.club.id });

  try {
    if (body.kind === 'book') {
      const intent = body.intent as BookingIntent;
      if (!intent || typeof intent !== 'object') {
        return NextResponse.json({ error: 'Missing intent' }, { status: 400 });
      }
      // Always force the intent's club_id to the resolved one.
      intent.club_id = ctx.club.id;
      const plan = await engine.computeBookingPlan(intent, { allowLarge: body.allowLarge === true });
      return NextResponse.json({ plan });
    }
    if (body.kind === 'mutate') {
      const mutation = body.mutation as Mutation;
      if (!mutation || typeof mutation !== 'object') {
        return NextResponse.json({ error: 'Missing mutation' }, { status: 400 });
      }
      mutation.selector.club_id = ctx.club.id;
      const plan = await engine.computeMutationPlan(mutation);
      return NextResponse.json({ plan });
    }
    return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  } catch (err) {
    if (err instanceof PlanTooLargeError) {
      return NextResponse.json(
        {
          error: 'plan_too_large',
          message: err.message,
          instance_count: err.instanceCount,
          cap: err.cap,
        },
        { status: 413 }
      );
    }
    console.error('courtsheet plan error:', err);
    return NextResponse.json(
      { error: 'Failed to compute plan', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
