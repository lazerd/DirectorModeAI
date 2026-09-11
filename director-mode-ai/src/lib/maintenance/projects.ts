/**
 * Long-term projects — progress and the two flags worth raising.
 * Pure: the caller passes `today` (club-local).
 */
import { daysBetween } from './dates';
import type { ISODate, Project, ProjectStep } from './types';

/** % of steps done, or null when there are no steps to measure against. */
export function progressPct(steps: Pick<ProjectStep, 'done'>[]): number | null {
  if (!steps.length) return null;
  return Math.round((steps.filter((s) => s.done).length / steps.length) * 100);
}

/** Past its target date and not finished. */
export function isPastTarget(p: Pick<Project, 'status' | 'target_date'>, today: ISODate): boolean {
  return p.status !== 'done' && !!p.target_date && p.target_date < today;
}

/** Active, but nobody has ticked a step or posted an update in `days` days. */
export function isStalled(
  p: Pick<Project, 'status'>,
  lastActivity: ISODate | null,
  today: ISODate,
  days = 14,
): boolean {
  return p.status === 'active' && !!lastActivity && daysBetween(lastActivity, today) >= days;
}

/** The next unfinished step, in order. */
export function nextStep<T extends Pick<ProjectStep, 'done' | 'sort_order' | 'title'>>(steps: T[]): T | null {
  return [...steps].sort((a, b) => a.sort_order - b.sort_order).find((s) => !s.done) ?? null;
}
