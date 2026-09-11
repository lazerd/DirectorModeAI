/**
 * GET  /api/maintenance/routine/starter — the template chores (nothing pre-ticked).
 * POST /api/maintenance/routine/starter { keys: string[] } — add ONLY the ones
 *   the manager picked. Never called automatically.
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad } from '@/lib/maintenance/server';
import { STARTER_ROUTINE } from '@/lib/maintenance/starter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  return NextResponse.json({ items: STARTER_ROUTINE });
}

export async function POST(req: Request) {
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as { keys?: unknown };
  const keys = new Set(Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string') : []);
  const picked = STARTER_ROUTINE.filter((s) => keys.has(s.key));
  if (!picked.length) return bad('Pick at least one chore to add.');

  // Skip anything already on the routine by name, so a double-tap can't duplicate.
  const { data: existing } = await ctx.db
    .from('maint_routine_items')
    .select('title, sort_order')
    .eq('club_id', ctx.club.id)
    .is('archived_on', null);
  const rows = (existing as { title: string; sort_order: number }[]) || [];
  const have = new Set(rows.map((r) => r.title.toLowerCase()));
  let order = rows.reduce((m, r) => Math.max(m, r.sort_order), -1);

  const toAdd = picked
    .filter((s) => !have.has(s.title.toLowerCase()))
    .map((s) => ({
      club_id: ctx.club.id,
      title: s.title,
      department: s.department,
      location: s.location,
      days_of_week: s.days_of_week,
      target_time: s.target_time,
      sort_order: ++order,
      active_from: ctx.today,
      created_by: ctx.user.id,
    }));
  if (toAdd.length) {
    const { error } = await ctx.db.from('maint_routine_items').insert(toAdd);
    if (error) return bad(error.message, 500);
  }
  return NextResponse.json({ ok: true, added: toAdd.length });
}
