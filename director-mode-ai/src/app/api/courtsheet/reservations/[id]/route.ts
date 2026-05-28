import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET — fetch a single reservation with its signups.
export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;

  const { data: reservation } = await ctx.db
    .from('reservations')
    .select('*')
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();

  if (!reservation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: signups } = await ctx.db
    .from('reservation_signups')
    .select('*')
    .eq('reservation_id', id)
    .order('signed_up_at', { ascending: true });

  return NextResponse.json({ reservation, signups: signups ?? [] });
}

// PATCH — direct field edits (title, color, signup config, status).
// Time/court changes should go through the plan/apply flow so conflicts
// are surfaced first; this endpoint blocks moving in time/court.
export async function PATCH(req: Request, { params }: RouteParams) {
  const { id } = await params;
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const forbidden = ['starts_at', 'ends_at', 'court_id', 'club_id', 'source', 'source_id'];
  for (const k of forbidden) {
    if (k in body) {
      return NextResponse.json(
        { error: `Use /plan + /apply to change ${k}` },
        { status: 400 }
      );
    }
  }

  const { data, error } = await ctx.db
    .from('reservations')
    .update(body)
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ reservation: data });
}

// DELETE — cancel the reservation (soft delete via status='cancelled').
export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const { data, error } = await ctx.db
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await ctx.db.from('courtsheet_audit_log').insert({
    club_id: ctx.club.id,
    actor_user_id: ctx.user.id,
    action: 'reservation_cancel',
    intent: { id },
    diff: { cancelled_ids: [data.id] },
    channel: 'ui',
  });

  return NextResponse.json({ ok: true });
}
