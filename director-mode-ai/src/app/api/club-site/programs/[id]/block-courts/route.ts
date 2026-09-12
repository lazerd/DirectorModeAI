/**
 * POST   — hold this class's courts on the court sheet
 * DELETE — give them back
 *
 * Reports partial success rather than hiding it. A club switching blocking on
 * for a class that has been running a month will hit dates where somebody
 * already has the court, and the useful answer is "held 14 of 16, here are the
 * two that clash" — not a silent failure, and certainly not stealing a court
 * out from under an existing booking.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import {
  blockProgramCourts,
  clearProgramBlocks,
  describeBlockResult,
  type BlockableProgram,
} from '@/lib/programs/courtBlocks';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { court_count?: number };

  const { data } = await ctx.db
    .from('club_programs')
    .select('*')
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: 'No such class.' }, { status: 404 });
  const program = data as unknown as BlockableProgram;

  // How many courts. Taken from the request when given, so the toggle and the
  // number arrive together and a club never has to save twice.
  const requested = Number(body.court_count);
  const courtCount = Number.isFinite(requested) && requested > 0
    ? Math.min(40, Math.round(requested))
    : program.court_count;

  if (!courtCount || courtCount <= 0) {
    // Refusing beats guessing 1: a class that needs three courts and holds one
    // is worse than a class that holds none, because it looks handled.
    return NextResponse.json(
      { error: 'How many courts does this class use? Set that first.' },
      { status: 400 },
    );
  }

  await ctx.db
    .from('club_programs')
    .update({ court_count: courtCount, blocks_courts: true })
    .eq('id', id);

  const result = await blockProgramCourts(
    ctx.db,
    { ...program, court_count: courtCount, blocks_courts: true },
    { timeZone: ctx.club.timezone, createdBy: ctx.user.id },
  );

  return NextResponse.json({
    ok: true,
    ...result,
    message: describeBlockResult(result),
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const { data } = await ctx.db
    .from('club_programs')
    .select('id')
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: 'No such class.' }, { status: 404 });

  const removed = await clearProgramBlocks(ctx.db, id);
  await ctx.db
    .from('club_programs')
    .update({ blocks_courts: false, courts_blocked_at: null })
    .eq('id', id);

  return NextResponse.json({
    ok: true,
    released: removed,
    message: removed
      ? `Released ${removed} court slots — they are bookable again.`
      : 'Nothing was being held.',
  });
}
