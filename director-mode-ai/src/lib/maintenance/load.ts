/**
 * Loads a club's MaintenanceMode data for one club-local date.
 *
 * Shared by the Today screen and the morning digest, so the email always says
 * exactly what the app shows. Service-role client — every query is filtered by
 * `clubId`, which is the access check for these tables.
 */
import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { addDays } from './dates';
import { checklistFor, missedOn, type ChecklistRow } from './routine';
import { sortTasks } from './tasks';
import { isPastTarget, isStalled, nextStep, progressPct } from './projects';
import type { ISODate, Project, ProjectStep, RoutineCheck, RoutineItem, Task } from './types';

type Db = ReturnType<typeof getSupabaseAdmin>;

export const ITEM_COLS =
  'id, title, notes, department, location, days_of_week, target_time, sort_order, active_from, archived_on';
export const CHECK_COLS = 'id, item_id, local_date, status, done_by, done_at, note, photo_url';
export const TASK_COLS =
  'id, title, description, department, location, priority, due_date, status, photo_url, created_by, created_at, ' +
  'started_at, started_by, completed_at, completed_by, completion_note, completion_photo_url';
export const PROJECT_COLS =
  'id, title, description, department, location, target_date, status, completed_at, created_by, created_at, updated_at';
export const STEP_COLS = 'id, project_id, title, sort_order, done, done_by, done_at';

export type ProjectSummary = Project & {
  steps: ProjectStep[];
  pct: number | null;
  next: string | null;
  lastActivity: ISODate | null;
  pastTarget: boolean;
  stalled: boolean;
};

export type BoardData = {
  items: RoutineItem[];
  checks: RoutineCheck[];
  checklist: ChecklistRow[];
  missedYesterday: RoutineItem[];
  tasks: Task[];
  recentDone: Task[];
  projects: ProjectSummary[];
};

function normaliseItem(r: RoutineItem): RoutineItem {
  return { ...r, days_of_week: (r.days_of_week || []).map(Number) };
}

export async function loadBoardData(
  db: Db,
  clubId: string,
  today: ISODate,
  nowHHMM?: string | null,
): Promise<BoardData> {
  const since = addDays(today, -14);
  const yesterday = addDays(today, -1);
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [itemsRes, checksRes, tasksRes, doneRes, projectsRes, stepsRes, updatesRes] = await Promise.all([
    db
      .from('maint_routine_items')
      .select(ITEM_COLS)
      .eq('club_id', clubId)
      // Archived items still matter for yesterday's record.
      .or(`archived_on.is.null,archived_on.gte.${since}`)
      .order('sort_order'),
    db.from('maint_routine_checks').select(CHECK_COLS).eq('club_id', clubId).gte('local_date', since),
    db.from('maint_tasks').select(TASK_COLS).eq('club_id', clubId).in('status', ['open', 'in_progress']),
    db
      .from('maint_tasks')
      .select(TASK_COLS)
      .eq('club_id', clubId)
      .eq('status', 'done')
      .gte('completed_at', dayAgo)
      .order('completed_at', { ascending: false }),
    db.from('maint_projects').select(PROJECT_COLS).eq('club_id', clubId).neq('status', 'done').order('created_at'),
    db.from('maint_project_steps').select(STEP_COLS).eq('club_id', clubId).order('sort_order'),
    db
      .from('maint_updates')
      .select('project_id, created_at')
      .eq('club_id', clubId)
      .not('project_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  const items = ((itemsRes.data as RoutineItem[]) || []).map(normaliseItem);
  const checks = (checksRes.data as RoutineCheck[]) || [];
  const steps = (stepsRes.data as ProjectStep[]) || [];
  const updates = (updatesRes.data as { project_id: string; created_at: string }[]) || [];

  const projects: ProjectSummary[] = ((projectsRes.data as Project[]) || []).map((p) => {
    const mine = steps.filter((s) => s.project_id === p.id);
    const stamps = [
      p.updated_at,
      ...mine.map((s) => s.done_at).filter(Boolean),
      ...updates.filter((u) => u.project_id === p.id).map((u) => u.created_at),
    ].filter(Boolean) as string[];
    const lastActivity = stamps.length ? stamps.sort().reverse()[0].slice(0, 10) : null;
    return {
      ...p,
      steps: mine,
      pct: progressPct(mine),
      next: nextStep(mine)?.title ?? null,
      lastActivity,
      pastTarget: isPastTarget(p, today),
      stalled: isStalled(p, lastActivity, today),
    };
  });

  return {
    items,
    checks,
    checklist: checklistFor(items, checks, today, nowHHMM),
    missedYesterday: missedOn(items, checks, yesterday),
    // TASK_COLS is a joined string, so PostgREST can't infer the row type here.
    tasks: sortTasks((tasksRes.data as unknown as Task[]) || [], today),
    recentDone: (doneRes.data as unknown as Task[]) || [],
    projects,
  };
}

/** Display names for the user ids that appear on the board. */
export async function namesFor(db: Db, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (!unique.length) return {};
  const { data } = await db.from('profiles').select('id, full_name').in('id', unique);
  const out: Record<string, string> = {};
  for (const p of (data as { id: string; full_name: string | null }[]) || []) {
    out[p.id] = (p.full_name || '').trim() || 'Someone';
  }
  return out;
}

/** Everyone on the club's maintenance crew. */
export async function crewOf(db: Db, clubId: string): Promise<string[]> {
  const { data } = await db
    .from('cc_club_members')
    .select('user_id')
    .eq('club_id', clubId)
    .eq('role', 'maintenance');
  return ((data as { user_id: string }[]) || []).map((r) => r.user_id);
}
