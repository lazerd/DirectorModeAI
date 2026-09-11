/**
 * At most three named findings for the top of a manager's screen.
 *
 * Not a dashboard: each one names the thing to go and look at ("Skim pool
 * missed 3 of the last 7 days"), and they are ranked so the worst comes first.
 */
import { daysBetween } from './dates';
import { isPastTarget, isStalled } from './projects';
import { missRecord } from './routine';
import { isOverdue, isOpenish } from './tasks';
import type { ISODate, Project, RoutineCheck, RoutineItem, Task } from './types';

export type Insight = { tone: 'red' | 'amber'; text: string; rank: number };

export function buildInsights(input: {
  items: RoutineItem[];
  checks: RoutineCheck[];
  tasks: Task[];
  projects: (Project & { lastActivity: ISODate | null })[];
  today: ISODate;
}): Insight[] {
  const { items, checks, tasks, projects, today } = input;
  const out: Insight[] = [];

  // Urgent work left over a day.
  const urgent = tasks
    .filter((t) => t.priority === 'urgent' && isOpenish(t.status))
    .filter((t) => daysBetween(t.created_at.slice(0, 10), today) >= 1)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (urgent.length) {
    const days = daysBetween(urgent[0].created_at.slice(0, 10), today);
    out.push({
      tone: 'red',
      rank: 0,
      text:
        urgent.length === 1
          ? `Urgent task open ${days} ${days === 1 ? 'day' : 'days'}: ${urgent[0].title}`
          : `${urgent.length} urgent tasks open over a day (oldest: ${urgent[0].title}, ${days} days)`,
    });
  }

  // Overdue, beyond the urgent ones already named.
  const overdue = tasks.filter((t) => isOverdue(t, today) && !urgent.includes(t));
  if (overdue.length) {
    out.push({
      tone: 'red',
      rank: 1,
      text:
        overdue.length === 1
          ? `Overdue: ${overdue[0].title} (due ${overdue[0].due_date})`
          : `${overdue.length} tasks are past their due date`,
    });
  }

  // The routine item slipping most over the last week.
  const worst = missRecord(items, checks, today, 7)
    .filter((r) => r.missed >= 2)
    .sort((a, b) => b.missed - a.missed || b.missed / b.due - a.missed / a.due)[0];
  if (worst) {
    out.push({
      tone: 'amber',
      rank: 2,
      text: `${worst.item.title} missed ${worst.missed} of the last ${worst.due} ${worst.due === 1 ? 'day' : 'days'} it was due`,
    });
  }

  // Projects running late or gone quiet.
  for (const p of projects) {
    if (isPastTarget(p, today)) {
      const late = daysBetween(p.target_date as string, today);
      out.push({ tone: 'amber', rank: 3, text: `${p.title} is ${late} ${late === 1 ? 'day' : 'days'} past its target date` });
    } else if (isStalled(p, p.lastActivity, today)) {
      out.push({ tone: 'amber', rank: 4, text: `${p.title} has had no progress in two weeks` });
    }
  }

  return out.sort((a, b) => a.rank - b.rank).slice(0, 3);
}
