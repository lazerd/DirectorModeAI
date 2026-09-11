/**
 * GET  /api/maintenance/tasks?status=open|done — open work, or the last 30 days done.
 * POST /api/maintenance/tasks — post a task / report a problem (anyone at the
 *   club with MaintenanceMode access, crew included).
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad, text, ownPhoto } from '@/lib/maintenance/server';
import { TASK_COLS, namesFor } from '@/lib/maintenance/load';
import { addDays, isISODate } from '@/lib/maintenance/dates';
import { sortTasks } from '@/lib/maintenance/tasks';
import { isDepartment, isPriority, type Task } from '@/lib/maintenance/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const status = new URL(req.url).searchParams.get('status');

  let q = ctx.db.from('maint_tasks').select(TASK_COLS).eq('club_id', ctx.club.id);
  if (status === 'done') {
    q = q.in('status', ['done', 'cancelled']).gte('updated_at', `${addDays(ctx.today, -30)}T00:00:00Z`).order('updated_at', { ascending: false });
  } else {
    q = q.in('status', ['open', 'in_progress']);
  }
  const { data } = await q.limit(300);
  // TASK_COLS is a joined string, so PostgREST can't infer the row type here.
  const rows = (data as unknown as Task[]) || [];
  const tasks = status === 'done' ? rows : sortTasks(rows, ctx.today);
  const names = await namesFor(ctx.db, tasks.flatMap((t) => [t.created_by, t.started_by, t.completed_by]));
  return NextResponse.json({ tasks, names, today: ctx.today });
}

export async function POST(req: Request) {
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const title = text(body.title, 200);
  if (!title) return bad('What needs doing? Give it a title.');
  const department = body.department ?? 'other';
  if (!isDepartment(department)) return bad('Pick a department.');
  const priority = body.priority ?? 'normal';
  if (!isPriority(priority)) return bad('Pick a priority.');
  const due = body.due_date ? String(body.due_date) : null;
  if (due && !isISODate(due)) return bad('Due date should be a date.');

  const photo = ownPhoto(ctx.db, ctx.club.id, body.photo_path);
  const { data, error } = await ctx.db
    .from('maint_tasks')
    .insert({
      club_id: ctx.club.id,
      title,
      description: text(body.description, 2000),
      department,
      location: text(body.location, 120),
      priority,
      due_date: due,
      created_by: ctx.user.id,
      ...(photo ?? {}),
    })
    .select(TASK_COLS)
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ task: data });
}
