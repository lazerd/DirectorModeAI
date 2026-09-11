/**
 * GET    /api/maintenance/projects/[id] — the project, its steps and updates.
 * PATCH  /api/maintenance/projects/[id] — edit (owner / director).
 * DELETE /api/maintenance/projects/[id] — delete (owner / director).
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad } from '@/lib/maintenance/server';
import { PROJECT_COLS, STEP_COLS, namesFor } from '@/lib/maintenance/load';
import { isPastTarget, progressPct } from '@/lib/maintenance/projects';
import type { Project, ProjectStep, Update } from '@/lib/maintenance/types';
import { projectFields } from '@/lib/maintenance/validate';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const { data: project } = await ctx.db.from('maint_projects').select(PROJECT_COLS).eq('id', id).eq('club_id', ctx.club.id).maybeSingle();
  if (!project) return bad('Not found.', 404);
  const [{ data: steps }, { data: updates }] = await Promise.all([
    ctx.db.from('maint_project_steps').select(STEP_COLS).eq('project_id', id).eq('club_id', ctx.club.id).order('sort_order'),
    ctx.db
      .from('maint_updates')
      .select('id, task_id, project_id, author_id, body, photo_url, created_at')
      .eq('project_id', id)
      .eq('club_id', ctx.club.id)
      .order('created_at', { ascending: false }),
  ]);
  const s = (steps as ProjectStep[]) || [];
  const u = (updates as Update[]) || [];
  const names = await namesFor(ctx.db, [...s.map((x) => x.done_by), ...u.map((x) => x.author_id)]);
  return NextResponse.json({
    today: ctx.today,
    me: { id: ctx.user.id, canManage: ctx.canManage, isCrew: ctx.isCrew },
    project: { ...(project as Project), pct: progressPct(s), pastTarget: isPastTarget(project as Project, ctx.today) },
    steps: s,
    updates: u,
    names,
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = projectFields(body, true);
  if ('error' in v) return bad(v.error);
  if (!Object.keys(v.patch).length) return bad('Nothing to change.');
  const { data, error } = await ctx.db
    .from('maint_projects')
    .update({ ...v.patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .select(PROJECT_COLS)
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('Not found.', 404);
  return NextResponse.json({ project: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const { data } = await ctx.db.from('maint_projects').delete().eq('id', id).eq('club_id', ctx.club.id).select('id').maybeSingle();
  if (!data) return bad('Not found.', 404);
  return NextResponse.json({ ok: true });
}
