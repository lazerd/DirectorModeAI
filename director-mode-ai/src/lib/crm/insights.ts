/**
 * What needs doing today, in one line each.
 *
 * The house rule is insights, not dashboards. A board with eight columns and a
 * total at the top is a picture of the work; it does not tell a rep on a phone
 * between lessons which club to open. So the top of /crm is a short list of
 * sentences — "3 next steps overdue", "Rossmoor demo sent 6 days ago, no
 * reply" — and the board is underneath for when they want to look around.
 *
 * Ordered by how much it costs to ignore: something already late, then
 * something due today, then a deal going quiet, then a deal with no plan at
 * all. Capped, because a list of thirty urgent things is a list of none.
 *
 * Pure: it takes the rows and today's date and returns strings. Tested in
 * insights.test.ts.
 */

import { daysBetween, isOverdue, type ISODate } from './dates';
import { CLOSED_STAGES, STAGES, type Stage } from './stages';
import type { OrgCard } from './types';

/** A deal with nothing logged for this long is going cold. */
const QUIET_DAYS = 10;
/** A demo sent and not followed up inside this window is the classic miss. */
const DEMO_CHASE_DAYS = 3;
const MAX_NUDGES = 6;

export interface Nudge {
  /** The sentence itself. */
  text: string;
  /** Where clicking it goes — an org, or null for a roll-up. */
  orgId: string | null;
  tone: 'late' | 'today' | 'warm';
}

export interface Pipeline {
  open: OrgCard[];
  /** Open deals only, at each deal's own target. */
  valueCents: number;
  byStage: { stage: Stage; count: number; orgs: OrgCard[] }[];
  overdue: OrgCard[];
  dueToday: OrgCard[];
  wonCount: number;
  lostCount: number;
  nudges: Nudge[];
}

function ageDays(iso: string | null, today: ISODate): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // The activity's calendar day where the reps are, not UTC.
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return Math.max(0, daysBetween(day, today));
}

export function buildPipeline(orgs: OrgCard[], today: ISODate): Pipeline {
  const open = orgs.filter((o) => !CLOSED_STAGES.includes(o.stage));
  const overdue = open
    .filter((o) => isOverdue(o.next_step_at, today))
    .sort((a, b) => (a.next_step_at ?? '').localeCompare(b.next_step_at ?? ''));
  const dueToday = open.filter((o) => o.next_step_at === today);

  const byStage = STAGES.map((stage) => {
    const list = orgs.filter((o) => o.stage === stage);
    return { stage, count: list.length, orgs: list };
  });

  const nudges: Nudge[] = [];

  // 1. Already late. One roll-up line, because the cards below are red anyway.
  if (overdue.length === 1) {
    nudges.push({
      text: `${overdue[0].name}: "${overdue[0].next_step}" was due ${
        daysBetween(overdue[0].next_step_at!, today)
      } day${daysBetween(overdue[0].next_step_at!, today) === 1 ? '' : 's'} ago`,
      orgId: overdue[0].id,
      tone: 'late',
    });
  } else if (overdue.length > 1) {
    nudges.push({
      text: `${overdue.length} next steps overdue — ${overdue
        .slice(0, 3)
        .map((o) => o.name)
        .join(', ')}${overdue.length > 3 ? '…' : ''}`,
      orgId: null,
      tone: 'late',
    });
  }

  // 2. Due today, named: this is the whole list of what to do before bed.
  for (const o of dueToday) {
    nudges.push({ text: `${o.name}: ${o.next_step} — today`, orgId: o.id, tone: 'today' });
  }

  // 3. A demo that went out and got no answer. The single most common way one
  //    of these deals dies, so it gets its own sentence with the age in it.
  for (const o of open) {
    if (o.stage !== 'demo_done') continue;
    const age = ageDays(o.last_activity_at, today);
    if (age === null || age < DEMO_CHASE_DAYS) continue;
    if (overdue.includes(o) || dueToday.includes(o)) continue;
    nudges.push({
      text: `${o.name}: demo sent ${age} days ago, no reply`,
      orgId: o.id,
      tone: 'warm',
    });
  }

  // 4. Gone quiet, or never given a plan. Both mean "nobody is driving this".
  for (const o of open) {
    if (overdue.includes(o) || dueToday.includes(o)) continue;
    if (!o.next_step) {
      nudges.push({ text: `${o.name} has no next step`, orgId: o.id, tone: 'warm' });
      continue;
    }
    const age = ageDays(o.last_activity_at, today);
    if (age !== null && age >= QUIET_DAYS && o.stage !== 'demo_done') {
      nudges.push({ text: `${o.name}: nothing logged in ${age} days`, orgId: o.id, tone: 'warm' });
    }
  }

  return {
    open,
    valueCents: open.reduce((sum, o) => sum + (o.mrr_target_cents ?? 0), 0),
    byStage,
    overdue,
    dueToday,
    wonCount: orgs.filter((o) => o.stage === 'won').length,
    lostCount: orgs.filter((o) => o.stage === 'lost').length,
    nudges: nudges.slice(0, MAX_NUDGES),
  };
}

/** "$225/mo" — whole dollars, because nobody prices a club in cents. */
export function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}
