/**
 * GET  /api/maintenance/updates?task_id=… — a task's notes log.
 * POST /api/maintenance/updates { task_id | project_id, body, photo_path? } — anyone.
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad, text, ownPhoto } from '@/lib/maintenance/server';
import { namesFor } from '@/lib/maintenance/load';
import type { Update } from '@/lib/maintenance/types';

export const dynamic = 'force-dynamic';

const COLS = 'id, task_id, project_id, author_id, body, photo_url, created_at';

export async function GET(req: Request) {
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const taskId = new URL(req.url).searchParams.get('task_id');
  if (!taskId) return bad('task_id is required.');
  const { data } = await ctx.db
    .from('maint_updates')
    .select(COLS)
    .eq('task_id', taskId)
    .eq('club_id', ctx.club.id)
    .order('created_at', { ascending: true });
  const updates = (data as Update[]) || [];
  return NextResponse.json({ updates, names: await namesFor(ctx.db, updates.map((u) => u.author_id)) });
}

export async function POST(req: Request) {
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const body = text(b.body, 2000);
  if (!body) return bad('Write something first.');
  const taskId = typeof b.task_id === 'string' ? b.task_id : null;
  const projectId = typeof b.project_id === 'string' ? b.project_id : null;
  if (!!taskId === !!projectId) return bad('Attach the note to a task or a project.');

  // The parent must be this club's.
  const table = taskId ? 'maint_tasks' : 'maint_projects';
  const { data: parent } = await ctx.db.from(table).select('id').eq('id', (taskId ?? projectId) as string).eq('club_id', ctx.club.id).maybeSingle();
  if (!parent) return bad('Not found.', 404);

  const photo = ownPhoto(ctx.db, ctx.club.id, b.photo_path);
  const { data, error } = await ctx.db
    .from('maint_updates')
    .insert({ club_id: ctx.club.id, task_id: taskId, project_id: projectId, author_id: ctx.user.id, body, ...(photo ?? {}) })
    .select(COLS)
    .single();
  if (error) return bad(error.message, 500);
  if (projectId) {
    await ctx.db.from('maint_projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId).eq('club_id', ctx.club.id);
  }
  return NextResponse.json({ update: data });
}
