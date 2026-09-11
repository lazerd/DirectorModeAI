/**
 * Field validation shared by the MaintenanceMode create/edit routes.
 *
 * Lives here, not in the route files: Next.js only allows HTTP-method exports
 * (and route config) from a route.ts, and the create and edit routes both
 * need these.
 */
import { hhmm, isISODate } from './dates';
import { isDepartment, isProjectStatus } from './types';

/** Trimmed text or null; `max` caps runaway pastes. */
export function text(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

type Result = { patch: Record<string, unknown> } | { error: string };

export function routineFields(body: Record<string, unknown>, partial: boolean): Result {
  const patch: Record<string, unknown> = {};
  if (!partial || 'title' in body) {
    const title = text(body.title, 200);
    if (!title) return { error: 'Give the item a name.' };
    patch.title = title;
  }
  if ('notes' in body) patch.notes = text(body.notes, 1000);
  if ('location' in body) patch.location = text(body.location, 120);
  if (!partial || 'department' in body) {
    const d = body.department ?? 'other';
    if (!isDepartment(d)) return { error: 'Pick a department.' };
    patch.department = d;
  }
  if (!partial || 'days_of_week' in body) {
    const days = Array.isArray(body.days_of_week)
      ? [...new Set((body.days_of_week as unknown[]).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [0, 1, 2, 3, 4, 5, 6];
    if (!days.length) return { error: 'Pick at least one day.' };
    patch.days_of_week = days.sort();
  }
  if ('target_time' in body) {
    if (body.target_time === null || body.target_time === '') patch.target_time = null;
    else {
      const t = hhmm(String(body.target_time));
      if (!t) return { error: 'Target time should look like 07:00.' };
      patch.target_time = t;
    }
  }
  if ('sort_order' in body && Number.isFinite(Number(body.sort_order))) patch.sort_order = Math.round(Number(body.sort_order));
  return { patch };
}

export function projectFields(body: Record<string, unknown>, partial: boolean): Result {
  const patch: Record<string, unknown> = {};
  if (!partial || 'title' in body) {
    const t = text(body.title, 200);
    if (!t) return { error: 'Give the project a name.' };
    patch.title = t;
  }
  if ('description' in body) patch.description = text(body.description, 4000);
  if ('location' in body) patch.location = text(body.location, 120);
  if (!partial || 'department' in body) {
    const d = body.department ?? 'other';
    if (!isDepartment(d)) return { error: 'Pick a department.' };
    patch.department = d;
  }
  if ('target_date' in body) {
    const d = body.target_date ? String(body.target_date) : null;
    if (d && !isISODate(d)) return { error: 'Target date should be a date.' };
    patch.target_date = d;
  }
  if ('status' in body) {
    if (!isProjectStatus(body.status)) return { error: 'Unknown status.' };
    patch.status = body.status;
    patch.completed_at = body.status === 'done' ? new Date().toISOString() : null;
  }
  return { patch };
}
