/**
 * Today — the work, as sentences.
 *
 * Darrin's complaint about the first version of /crm was "it's just a never
 * ending vertical list of people, doesn't seem all that useful". A list is not
 * work. This is: four questions asked of the live deals, each answered as a
 * line a rep can act on without opening anything, each carrying the one button
 * that is the obvious next move.
 *
 *   1. What is late, or due today.        → open it
 *   2. Whose demo went out and went quiet. → chase it
 *   3. Who replied and got no answer.      → answer them
 *   4. How many emails the deck has ready. → go to the deck
 *
 * Only live deals go in. Running this over the 519 cold clubs would produce
 * 519 copies of "has no next step", which is a list again, and a worse one.
 *
 * Pure: rows in, items out, `today` and the deck count passed by the caller.
 * Tested in today.test.ts.
 */

import { daysBetween, isOverdue, type ISODate } from './dates';
import { CLOSED_STAGES } from './stages';
import type { OrgCard } from './types';

/** A demo with nothing back after this long is the classic miss. */
export const DEMO_SILENCE_DAYS = 5;

/**
 * What a logged reply looks like.
 *
 * The reps write their own timeline entries, in their own words: "Mary replied
 * — wants to see it on a phone", "got a reply from the GM". There is no
 * inbound-mail integration and no `reply` activity kind, so the note itself is
 * the signal. Narrow on purpose — it matches the word, not "no reply", which
 * is the opposite thing and is what rule 2 writes.
 */
const REPLY_RE = /\b(replied|reply|replies|wrote back|got back to)\b/i;
const NO_REPLY_RE = /\bno (reply|response)\b/i;

export function looksLikeAReply(body: string | null | undefined): boolean {
  const t = (body ?? '').trim();
  if (!t) return false;
  if (NO_REPLY_RE.test(t)) return false;
  return REPLY_RE.test(t);
}

export type TodayTone = 'late' | 'today' | 'warm' | 'info';

export interface TodayItem {
  /** What to do, in one sentence. */
  text: string;
  /** The club it is about, or null for a roll-up. */
  orgId: string | null;
  /** The one obvious move, and where it goes. */
  actionLabel: string;
  href: string;
  tone: TodayTone;
}

/** Whole days between an activity's timestamp and today, in the reps' zone. */
function ageDays(iso: string | null, today: ISODate): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return Math.max(0, daysBetween(day, today));
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export interface TodayList {
  items: TodayItem[];
  /** For the heading: how much of this there is, before any capping. */
  overdueCount: number;
  dueTodayCount: number;
  silentDemoCount: number;
  unansweredReplyCount: number;
}

/**
 * `deckQueued` is the outreach deck's own count, or null when the deck does
 * not exist yet. Null hides the line entirely — a zero there would read as "we
 * have a deck and it is empty", which is a different and wrong statement.
 */
export function buildToday(
  live: OrgCard[],
  today: ISODate,
  deckQueued: number | null,
  queuedForOutreach = 0,
): TodayList {
  const open = live.filter((o) => !CLOSED_STAGES.includes(o.stage));

  // ------------------------------------------------------------- 1. late
  const overdue = open
    .filter((o) => isOverdue(o.next_step_at, today))
    .sort((a, b) => (a.next_step_at ?? '').localeCompare(b.next_step_at ?? ''));
  const dueToday = open.filter((o) => o.next_step_at === today);

  // --------------------------------------------------- 2. silent demos
  //
  // Skipped when the club is already named above: a rep who sees "Rossmoor,
  // due today" does not also need "Rossmoor, demo sent 6 days ago". One club,
  // one line, or Today becomes the list it replaced.
  const named = new Set([...overdue, ...dueToday].map((o) => o.id));
  const silentDemos = open
    .filter((o) => o.stage === 'demo_done' && !named.has(o.id))
    .map((o) => ({ org: o, age: ageDays(o.last_activity_at, today) }))
    .filter((x): x is { org: OrgCard; age: number } => x.age !== null && x.age >= DEMO_SILENCE_DAYS)
    .sort((a, b) => b.age - a.age);

  // ------------------------------------------ 3. replies nobody answered
  //
  // The newest thing on the timeline is a reply, and there is no next step —
  // so the reply is where the deal stopped. If a rep logged a reply and then
  // set a next step, they have acted; that is the whole test.
  const unansweredReplies = open.filter(
    (o) => !named.has(o.id) && !o.next_step && looksLikeAReply(o.last_activity_body),
  );
  const replyIds = new Set(unansweredReplies.map((o) => o.id));

  const items: TodayItem[] = [];

  if (overdue.length === 1) {
    const o = overdue[0];
    const late = daysBetween(o.next_step_at!, today);
    items.push({
      text: `${o.name}: "${o.next_step}" was due ${late} ${plural(late, 'day', 'days')} ago`,
      orgId: o.id,
      actionLabel: 'Open it',
      href: `/crm/${o.id}`,
      tone: 'late',
    });
  } else if (overdue.length > 1) {
    for (const o of overdue.slice(0, 3)) {
      const late = daysBetween(o.next_step_at!, today);
      items.push({
        text: `${o.name}: "${o.next_step}" was due ${late} ${plural(late, 'day', 'days')} ago`,
        orgId: o.id,
        actionLabel: 'Open it',
        href: `/crm/${o.id}`,
        tone: 'late',
      });
    }
    if (overdue.length > 3) {
      items.push({
        text: `${overdue.length - 3} more next ${plural(overdue.length - 3, 'step is', 'steps are')} overdue`,
        orgId: null,
        actionLabel: 'See them',
        href: '#live',
        tone: 'late',
      });
    }
  }

  for (const o of dueToday) {
    items.push({
      text: `${o.name}: ${o.next_step} — today`,
      orgId: o.id,
      actionLabel: 'Open it',
      href: `/crm/${o.id}`,
      tone: 'today',
    });
  }

  for (const { org, age } of silentDemos) {
    items.push({
      text: `${org.name}: demo sent ${age} days ago, still no reply`,
      orgId: org.id,
      actionLabel: 'Chase it',
      href: `/crm/${org.id}`,
      tone: 'warm',
    });
  }

  for (const o of unansweredReplies) {
    const when = ageDays(o.last_activity_at, today);
    items.push({
      text:
        `${o.name} replied${when === 0 ? ' today' : when === 1 ? ' yesterday' : when != null ? ` ${when} days ago` : ''}` +
        ' and there is no next step',
      orgId: o.id,
      actionLabel: 'Answer them',
      href: `/crm/${o.id}`,
      tone: 'warm',
    });
  }

  // ------------------------------------------------------- 4. the deck
  if (deckQueued !== null) {
    items.push({
      text:
        deckQueued === 0
          ? "Today's deck is empty — nothing queued to send"
          : `${deckQueued} ${plural(deckQueued, 'email is', 'emails are')} waiting in today's deck`,
      orgId: null,
      actionLabel: "Open today's emails",
      href: '/crm/deck',
      tone: 'info',
    });
  } else if (queuedForOutreach > 0) {
    // No deck yet, but a rep has flagged clubs for one. Say the true thing.
    items.push({
      text: `${queuedForOutreach} ${plural(queuedForOutreach, 'club is', 'clubs are')} queued for outreach`,
      orgId: null,
      actionLabel: 'See them',
      href: '#cold',
      tone: 'info',
    });
  }

  return {
    items,
    overdueCount: overdue.length,
    dueTodayCount: dueToday.length,
    silentDemoCount: silentDemos.length,
    unansweredReplyCount: replyIds.size,
  };
}
