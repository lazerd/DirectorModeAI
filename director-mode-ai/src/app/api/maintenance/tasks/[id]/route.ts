/**
 * PATCH  /api/maintenance/tasks/[id]
 *   { status, completion_note?, completion_photo_path? } — anyone may move a task
 *     along (start it, finish it, reopen it).
 *   { title?, description?, department?, location?, priority?, due_date?, photo_path? }
 *     — only whoever posted it, or a manager.
 * DELETE /api/maintenance/tasks/[id] — a manager, or the poster while still open.
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad, text, ownPhoto } from '@/lib/maintenance/server';
import { TASK_COLS } from '@/lib/maintenance/load';
import { isISODate } from '@/lib/maintenance/dates';
import { canDeleteTask, canEditTask, canTransition, statusPatch } from '@/lib/maintenance/tasks';
import { isDepartment, isPriority, isTaskStatus, type Task } from '@/lib/maintenance/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Exclude<Awaited<ReturnType<typeof requireMaintenanceContext>>, { error: unknown }>, id: string) {
  const { data } = await ctx.db.from('maint_tasks').select(TASK_COLS).eq('id', id).eq('club_id', ctx.club.id).maybeSingle();
  return data as Task | null;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const task = await load(ctx, id);
  if (!task) return bad('Not found.', 404);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = { userId: ctx.user.id, canManage: ctx.canManage };
  const nowIso = new Date().toISOString();
  let patch: Record<string, unknown> = {};

  if ('status' in body) {
    if (!isTaskStatus(body.status)) return bad('Unknown status.');
    if (body.status !== task.status) {
      if (!canTransition(task.status, body.status)) return bad(`Can't go from ${task.status} to ${body.status}.`);
      // Cancelling is a decision about the job, not progress on it.
      if (body.status === 'cancelled' && !canEditTask(actor, task)) {
        return bad('Only whoever posted it, or a manager, can cancel a task.', 403);
      }
      patch = statusPatch(body.status, ctx.user.id, nowIso);
      if (body.status === 'done') {
        patch.completion_note = text(body.completion_note, 1000);
        const p = ownPhoto(ctx.db, ctx.club.id, body.completion_photo_path);
        if (p) {
          patch.completion_photo_url = p.photo_url;
          patch.completion_photo_path = p.photo_path;
        }
      }
    }
  }

  const detailKeys = ['title', 'description', 'department', 'location', 'priority', 'due_date', 'photo_path'];
  if (detailKeys.some((k) => k in body)) {
    if (!canEditTask(actor, task)) return bad('Only whoever posted it, or a manager, can edit it.', 403);
    if ('title' in body) {
      const t = text(body.title, 200);
      if (!t) return bad('A task needs a title.');
      patch.title = t;
    }
    if ('description' in body) patch.description = text(body.description, 2000);
    if ('location' in body) patch.location = text(body.location, 120);
    if ('department' in body) {
      if (!isDepartment(body.department)) return bad('Pick a department.');
      patch.department = body.department;
    }
    if ('priority' in body) {
      if (!isPriority(body.priority)) return bad('Pick a priority.');
      patch.priority = body.priority;
    }
    if ('due_date' in body) {
      const d = body.due_date ? String(body.due_date) : null;
      if (d && !isISODate(d)) return bad('Due date should be a date.');
      patch.due_date = d;
    }
    if ('photo_path' in body) {
      const p = ownPhoto(ctx.db, ctx.club.id, body.photo_path);
      patch.photo_url = p?.photo_url ?? null;
      patch.photo_path = p?.photo_path ?? null;
    }
  }

  if (!Object.keys(patch).length) return NextResponse.json({ task });
  const { data, error } = await ctx.db
    .from('maint_tasks')
    .update({ ...patch, updated_at: nowIso })
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .select(TASK_COLS)
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ task: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const task = await load(ctx, id);
  if (!task) return bad('Not found.', 404);
  if (!canDeleteTask({ userId: ctx.user.id, canManage: ctx.canManage }, task)) {
    return bad('Only a manager — or whoever posted it, before anyone starts — can delete a task. Cancel it instead.', 403);
  }
  await ctx.db.from('maint_tasks').delete().eq('id', id).eq('club_id', ctx.club.id);
  return NextResponse.json({ ok: true });
}
