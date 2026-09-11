/**
 * PATCH  /api/maintenance/routine/[id] — edit an item (owner / director).
 * DELETE /api/maintenance/routine/[id] — remove it. An item with history is
 *   archived instead, so past checks keep their name.
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad } from '@/lib/maintenance/server';
import { ITEM_COLS } from '@/lib/maintenance/load';
import { routineFields } from '@/lib/maintenance/validate';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = routineFields(body, true);
  if ('error' in v) return bad(v.error);
  if (!Object.keys(v.patch).length) return bad('Nothing to change.');

  const { data, error } = await ctx.db
    .from('maint_routine_items')
    .update({ ...v.patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .select(ITEM_COLS)
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('Not found.', 404);
  return NextResponse.json({ item: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;

  const { data: item } = await ctx.db
    .from('maint_routine_items')
    .select('id')
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!item) return bad('Not found.', 404);

  const { count } = await ctx.db
    .from('maint_routine_checks')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', id)
    .eq('club_id', ctx.club.id);

  if ((count ?? 0) > 0) {
    await ctx.db
      .from('maint_routine_items')
      .update({ archived_on: ctx.today, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('club_id', ctx.club.id);
    return NextResponse.json({ ok: true, archived: true });
  }
  await ctx.db.from('maint_routine_items').delete().eq('id', id).eq('club_id', ctx.club.id);
  return NextResponse.json({ ok: true, archived: false });
}
