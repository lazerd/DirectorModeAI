/**
 * One-off tasks — ordering, overdue, allowed status changes and who may edit.
 * Pure: the caller passes `today` (club-local) and `nowIso`.
 */
import { PRIORITY_RANK, type ISODate, type Task, type TaskStatus } from './types';

export function isOpenish(status: TaskStatus): boolean {
  return status === 'open' || status === 'in_progress';
}

/** Past its due date and still not done. Due today is not overdue. */
export function isOverdue(task: Pick<Task, 'due_date' | 'status'>, today: ISODate): boolean {
  return !!task.due_date && task.due_date < today && isOpenish(task.status);
}

/** The order the crew should work in: overdue, then urgent → low, then due date, then oldest. */
export function sortTasks<T extends Task>(tasks: T[], today: ISODate): T[] {
  return [...tasks].sort((a, b) => {
    const oa = isOpenish(a.status) ? 0 : 1;
    const ob = isOpenish(b.status) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const va = isOverdue(a, today) ? 0 : 1;
    const vb = isOverdue(b, today) ? 0 : 1;
    if (va !== vb) return va - vb;
    const pa = PRIORITY_RANK[a.priority] ?? 9;
    const pb = PRIORITY_RANK[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['in_progress', 'done', 'cancelled'],
  in_progress: ['open', 'done', 'cancelled'],
  done: ['open'],
  cancelled: ['open'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * The columns to write for a status change. Reopening clears the completion
 * and cancellation stamps so the record never claims a job is both open and
 * done.
 */
export function statusPatch(to: TaskStatus, userId: string, nowIso: string): Record<string, unknown> {
  switch (to) {
    case 'in_progress':
      return { status: to, started_at: nowIso, started_by: userId };
    case 'done':
      return { status: to, completed_at: nowIso, completed_by: userId, cancelled_at: null, cancelled_by: null };
    case 'cancelled':
      return { status: to, cancelled_at: nowIso, cancelled_by: userId };
    case 'open':
    default:
      return {
        status: 'open',
        started_at: null,
        started_by: null,
        completed_at: null,
        completed_by: null,
        completion_note: null,
        completion_photo_url: null,
        completion_photo_path: null,
        cancelled_at: null,
        cancelled_by: null,
      };
  }
}

export type Actor = { userId: string; canManage: boolean };

/** Edit a task's details: whoever posted it, or a manager. */
export function canEditTask(actor: Actor, task: Pick<Task, 'created_by'>): boolean {
  return actor.canManage || (!!task.created_by && task.created_by === actor.userId);
}

/** Delete outright: a manager, or the poster while nobody has started it. */
export function canDeleteTask(actor: Actor, task: Pick<Task, 'created_by' | 'status'>): boolean {
  if (actor.canManage) return true;
  return !!task.created_by && task.created_by === actor.userId && task.status === 'open';
}
