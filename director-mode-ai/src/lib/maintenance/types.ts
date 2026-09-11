/**
 * MaintenanceMode — shared shapes and fixed lists.
 *
 * Safe on the client: no server imports. Every list here mirrors a CHECK in
 * supabase/migrations/20260911_maintenance_mode.sql — change both together.
 */

export const DEPARTMENTS = ['tennis', 'aquatics', 'fitness', 'clubhouse', 'grounds', 'other'] as const;
export type Department = (typeof DEPARTMENTS)[number];
export const DEPARTMENT_LABEL: Record<Department, string> = {
  tennis: 'Tennis',
  aquatics: 'Aquatics',
  fitness: 'Fitness',
  clubhouse: 'Clubhouse',
  grounds: 'Grounds',
  other: 'Other',
};

/** Most urgent first — the order the crew should work in. */
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  on_hold: 'On hold',
  done: 'Done',
};

/** YYYY-MM-DD in the CLUB's time zone. Never a UTC date. */
export type ISODate = string;

export type RoutineItem = {
  id: string;
  title: string;
  notes: string | null;
  department: Department;
  location: string | null;
  /** 0 = Sunday … 6 = Saturday. */
  days_of_week: number[];
  /** 'HH:MM' or 'HH:MM:SS' (Postgres `time`), or null for "anytime". */
  target_time: string | null;
  sort_order: number;
  active_from: ISODate;
  archived_on: ISODate | null;
};

export type RoutineCheck = {
  id: string;
  item_id: string;
  local_date: ISODate;
  status: 'done' | 'skipped';
  done_by: string | null;
  done_at: string;
  note: string | null;
  photo_url: string | null;
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  department: Department;
  location: string | null;
  priority: Priority;
  due_date: ISODate | null;
  status: TaskStatus;
  photo_url: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  started_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completion_note: string | null;
  completion_photo_url: string | null;
};

export type Project = {
  id: string;
  title: string;
  description: string | null;
  department: Department;
  location: string | null;
  target_date: ISODate | null;
  status: ProjectStatus;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectStep = {
  id: string;
  project_id: string;
  title: string;
  sort_order: number;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
};

export type Update = {
  id: string;
  task_id: string | null;
  project_id: string | null;
  author_id: string | null;
  body: string;
  photo_url: string | null;
  created_at: string;
};

export function isDepartment(v: unknown): v is Department {
  return typeof v === 'string' && (DEPARTMENTS as readonly string[]).includes(v);
}
export function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
}
export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);
}
export function isProjectStatus(v: unknown): v is ProjectStatus {
  return typeof v === 'string' && (PROJECT_STATUSES as readonly string[]).includes(v);
}
