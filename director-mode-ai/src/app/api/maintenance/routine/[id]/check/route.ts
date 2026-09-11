/**
 * POST   /api/maintenance/routine/[id]/check — tick (or skip) an item.
 *   { date: 'today' | 'yesterday', status?: 'done' | 'skipped', note?, photo_path? }
 * DELETE /api/maintenance/routine/[id]/check?date=today|yesterday — undo.
 *
 * The server turns 'today'/'yesterday' into the CLUB-local date, so a phone
 * set to another time zone can never tick the wrong day.
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad, text, ownPhoto } from '@/lib/maintenance/server';
import { CHECK_COLS, ITEM_COLS } from '@/lib/maintenance/load';
import { addDays } from '@/lib/maintenance/dates';
import { appliesOn } from '@/lib/maintenance/routine';
import type { RoutineItem } from '@/lib/maintenance/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function whichDay(v: unknown, today: string): string | null {
  if (v === undefined || v === 'today') return today;
  if (v === 'yesterday') return addDays(today, -1);
  return null;
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const date = whichDay(body.date, ctx.today);
  if (!date) return bad('date must be today or yesterday.');
  const status = body.status === 'skipped' ? 'skipped' : 'done';

  const { data: row } = await ctx.db
    .from('maint_routine_items')
    .select(ITEM_COLS)
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!row) return bad('Not found.', 404);
  const item = { ...(row as RoutineItem), days_of_week: ((row as RoutineItem).days_of_week || []).map(Number) };
  if (!appliesOn(item, date)) return bad("That item isn't on the list for that day.");

  const photo = ownPhoto(ctx.db, ctx.club.id, body.photo_path);
  const { data, error } = await ctx.db
    .from('maint_routine_checks')
    .insert({
      club_id: ctx.club.id,
      item_id: id,
      local_date: date,
      status,
      done_by: ctx.user.id,
      note: text(body.note, 500),
      ...(photo ?? {}),
    })
    .select(CHECK_COLS)
    .single();

  if (error) {
    // Someone beat them to it — say who, rather than failing.
    if (error.code === '23505') {
      const { data: existing } = await ctx.db
        .from('maint_routine_checks')
        .select(CHECK_COLS)
        .eq('item_id', id)
        .eq('local_date', date)
        .eq('club_id', ctx.club.id)
        .maybeSingle();
      return NextResponse.json({ check: existing, already: true });
    }
    return bad(error.message, 500);
  }
  return NextResponse.json({ check: data });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const date = whichDay(new URL(req.url).searchParams.get('date') ?? undefined, ctx.today);
  if (!date) return bad('date must be today or yesterday.');

  const { data: check } = await ctx.db
    .from('maint_routine_checks')
    .select('id, done_by')
    .eq('item_id', id)
    .eq('local_date', date)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!check) return NextResponse.json({ ok: true });
  if ((check as { done_by: string | null }).done_by !== ctx.user.id && !ctx.canManage) {
    return bad('Only the person who ticked it (or a manager) can undo it.', 403);
  }
  await ctx.db.from('maint_routine_checks').delete().eq('id', (check as { id: string }).id).eq('club_id', ctx.club.id);
  return NextResponse.json({ ok: true });
}
