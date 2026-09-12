/**
 * PATCH / DELETE one rate card.
 *
 * Deleting the last active card switches online booking off for the club,
 * which is a legitimate thing to want and worth saying out loud in the
 * response rather than leaving a director to discover it from the public page.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { rateCardPatchSchema } from '@/lib/courts/schema';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const parsed = rateCardPatchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first?.path?.join('.') || 'That'}: ${first?.message || 'not valid'}` },
      { status: 400 },
    );
  }

  const { data: before } = await ctx.db
    .from('court_rate_cards')
    .select('*')
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'No such rate.' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!(key in parsed.data)) continue;
    patch[key] = (parsed.data as Record<string, unknown>)[key];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
  }

  // Cross-field check against the stored row: a PATCH carrying only time_end
  // has nothing of its own to compare against.
  const merged = { ...before, ...patch } as Record<string, string>;
  if (String(merged.time_end) <= String(merged.time_start)) {
    return NextResponse.json(
      { error: 'The end time has to be after the start time.' },
      { status: 400 },
    );
  }

  const { data, error } = await ctx.db
    .from('court_rate_cards')
    .update(patch)
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rate: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const { error } = await ctx.db
    .from('court_rate_cards')
    .delete()
    .eq('id', id)
    .eq('club_id', ctx.club.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count } = await ctx.db
    .from('court_rate_cards')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', ctx.club.id)
    .eq('active', true);

  return NextResponse.json({
    ok: true,
    booking_now_off: (count ?? 0) === 0,
  });
}
