/**
 * PATCH  /api/maintenance/projects/[id]/steps/[stepId]
 *   { done } — anyone (the crew ticks steps off);
 *   { title?, sort_order? } — owner / director.
 * DELETE — owner / director.
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad, text } from '@/lib/maintenance/server';
import { STEP_COLS } from '@/lib/maintenance/load';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; stepId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, stepId } = await params;
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if ('done' in body) {
    const done = body.done === true;
    patch.done = done;
    patch.done_by = done ? ctx.user.id : null;
    patch.done_at = done ? nowIso : null;
  }
  if ('title' in body || 'sort_order' in body) {
    if (!ctx.canManage) return bad('Only the owner or a director can edit steps.', 403);
    if ('title' in body) {
      const t = text(body.title, 200);
      if (!t) return bad('Describe the step.');
      patch.title = t;
    }
    if ('sort_order' in body && Number.isFinite(Number(body.sort_order))) patch.sort_order = Math.round(Number(body.sort_order));
  }
  if (!Object.keys(patch).length) return bad('Nothing to change.');

  const { data, error } = await ctx.db
    .from('maint_project_steps')
    .update(patch)
    .eq('id', stepId)
    .eq('project_id', id)
    .eq('club_id', ctx.club.id)
    .select(STEP_COLS)
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('Not found.', 404);
  await ctx.db.from('maint_projects').update({ updated_at: nowIso }).eq('id', id).eq('club_id', ctx.club.id);
  return NextResponse.json({ step: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, stepId } = await params;
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const { data } = await ctx.db
    .from('maint_project_steps')
    .delete()
    .eq('id', stepId)
    .eq('project_id', id)
    .eq('club_id', ctx.club.id)
    .select('id')
    .maybeSingle();
  if (!data) return bad('Not found.', 404);
  return NextResponse.json({ ok: true });
}
