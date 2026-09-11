/**
 * GET  /api/maintenance/routine — the routine items with their 14-day record.
 * POST /api/maintenance/routine — add an item (owner / director).
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad } from '@/lib/maintenance/server';
import { ITEM_COLS, CHECK_COLS } from '@/lib/maintenance/load';
import { addDays } from '@/lib/maintenance/dates';
import { missRecord } from '@/lib/maintenance/routine';
import { routineFields } from '@/lib/maintenance/validate';
import type { RoutineCheck, RoutineItem } from '@/lib/maintenance/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const [{ data: items }, { data: checks }] = await Promise.all([
    ctx.db.from('maint_routine_items').select(ITEM_COLS).eq('club_id', ctx.club.id).is('archived_on', null).order('sort_order'),
    ctx.db.from('maint_routine_checks').select(CHECK_COLS).eq('club_id', ctx.club.id).gte('local_date', addDays(ctx.today, -14)),
  ]);
  const rows = ((items as RoutineItem[]) || []).map((i) => ({ ...i, days_of_week: (i.days_of_week || []).map(Number) }));
  const record = missRecord(rows, (checks as RoutineCheck[]) || [], ctx.today, 14);
  return NextResponse.json({
    items: rows.map((i) => {
      const r = record.find((x) => x.item.id === i.id);
      return { ...i, due14: r?.due ?? 0, missed14: r?.missed ?? 0 };
    }),
  });
}

export async function POST(req: Request) {
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = routineFields(body, false);
  if ('error' in v) return bad(v.error);

  const { data: last } = await ctx.db
    .from('maint_routine_items')
    .select('sort_order')
    .eq('club_id', ctx.club.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.db
    .from('maint_routine_items')
    .insert({
      ...v.patch,
      sort_order: v.patch.sort_order ?? ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1,
      club_id: ctx.club.id,
      active_from: ctx.today,
      created_by: ctx.user.id,
    })
    .select(ITEM_COLS)
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ item: data });
}
