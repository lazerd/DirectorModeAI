/**
 * POST /api/maintenance/projects/[id]/steps { title } — add a step (owner / director).
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad, text } from '@/lib/maintenance/server';
import { STEP_COLS } from '@/lib/maintenance/load';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = text(body.title, 200);
  if (!title) return bad('Describe the step.');

  const { data: project } = await ctx.db.from('maint_projects').select('id').eq('id', id).eq('club_id', ctx.club.id).maybeSingle();
  if (!project) return bad('Not found.', 404);

  const { data: last } = await ctx.db
    .from('maint_project_steps')
    .select('sort_order')
    .eq('project_id', id)
    .eq('club_id', ctx.club.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await ctx.db
    .from('maint_project_steps')
    .insert({
      club_id: ctx.club.id,
      project_id: id,
      title,
      sort_order: ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1,
    })
    .select(STEP_COLS)
    .single();
  if (error) return bad(error.message, 500);
  await ctx.db.from('maint_projects').update({ updated_at: new Date().toISOString() }).eq('id', id).eq('club_id', ctx.club.id);
  return NextResponse.json({ step: data });
}
