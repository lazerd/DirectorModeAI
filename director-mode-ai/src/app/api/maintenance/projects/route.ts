/**
 * GET  /api/maintenance/projects — every project with its steps and progress.
 * POST /api/maintenance/projects — start one (owner / director).
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad, text } from '@/lib/maintenance/server';
import { PROJECT_COLS, STEP_COLS } from '@/lib/maintenance/load';
import { isPastTarget, nextStep, progressPct } from '@/lib/maintenance/projects';
import { projectFields } from '@/lib/maintenance/validate';
import type { Project, ProjectStep } from '@/lib/maintenance/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const [{ data: projects }, { data: steps }] = await Promise.all([
    ctx.db.from('maint_projects').select(PROJECT_COLS).eq('club_id', ctx.club.id).order('created_at', { ascending: false }),
    ctx.db.from('maint_project_steps').select(STEP_COLS).eq('club_id', ctx.club.id).order('sort_order'),
  ]);
  const all = (steps as ProjectStep[]) || [];
  return NextResponse.json({
    today: ctx.today,
    projects: ((projects as Project[]) || []).map((p) => {
      const mine = all.filter((s) => s.project_id === p.id);
      return { ...p, steps: mine, pct: progressPct(mine), next: nextStep(mine)?.title ?? null, pastTarget: isPastTarget(p, ctx.today) };
    }),
  });
}

export async function POST(req: Request) {
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = projectFields(body, false);
  if ('error' in v) return bad(v.error);

  const { data, error } = await ctx.db
    .from('maint_projects')
    .insert({ ...v.patch, club_id: ctx.club.id, created_by: ctx.user.id })
    .select(PROJECT_COLS)
    .single();
  if (error) return bad(error.message, 500);

  // Optional starting steps, one per line.
  const steps = Array.isArray(body.steps)
    ? (body.steps as unknown[]).map((s) => text(s, 200)).filter((s): s is string => !!s).slice(0, 50)
    : [];
  if (steps.length) {
    await ctx.db.from('maint_project_steps').insert(
      steps.map((title, i) => ({ club_id: ctx.club.id, project_id: (data as { id: string }).id, title, sort_order: i })),
    );
  }
  return NextResponse.json({ project: data });
}
