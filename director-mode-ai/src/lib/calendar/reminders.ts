/**
 * CalendarMode — reminder cadences.
 *
 * A director sets, per event: "three reminders — 30 days out, 15 days out, and
 * the night before the signup deadline — plus a same-day 'see you at 7pm
 * tonight'." This module turns that into concrete dates and decides which are
 * due today. Pure: no I/O, no clocks (the caller passes `today`).
 *
 * Two ideas do most of the work:
 *
 * ANCHOR. An offset is meaningless on its own. "The night before the deadline"
 * and "the morning of the event" are different dates, and a cadence that can
 * only count back from the event date can't express the first one. So every
 * rule names its anchor — `event` or `deadline`.
 *
 * TONE. A reminder 30 days out and a reminder at 8am on the day are not the
 * same email. One says "save the date, signups are open"; the other says "see
 * you at 7 tonight". Sending the same generic "coming up soon" copy four times
 * is how a club teaches its members to ignore club email. Each rule carries a
 * tone, and the tone picks the words.
 */

import { addDays, daysApart, shortLabel } from './dates';
import type { Effort, ISODate } from './types';

export type ReminderAnchor = 'event' | 'deadline';

export type ReminderTone =
  | 'save-the-date'  // far out: get it on the calendar
  | 'signups-open'   // mid: sign up now
  | 'last-call'      // deadline pressure
  | 'reminder'       // near: it's nearly here
  | 'day-of';        // the morning of: see you tonight

export interface ReminderRule {
  /** Stable id — the dedupe key in calendar_reminder_sends. */
  id: string;
  /** Days BEFORE the anchor. 0 = the anchor day itself. */
  offsetDays: number;
  anchor: ReminderAnchor;
  tone: ReminderTone;
  enabled: boolean;
}

export interface ReminderAnchors {
  eventDate: ISODate | null;
  /** Falls back to the event date when the club sets no separate deadline. */
  deadline: ISODate | null;
}

export interface ResolvedReminder {
  rule: ReminderRule;
  /** The date this rule fires, or null if its anchor is missing. */
  sendOn: ISODate | null;
  label: string;
  /** Filled by the caller from calendar_reminder_sends. */
  sentAt?: string | null;
  status?: 'scheduled' | 'sent' | 'past' | 'unanchored' | 'disabled';
}

/**
 * How late a missed reminder may still go out.
 *
 * A cron that fails on Tuesday shouldn't silently swallow the 30-day notice —
 * a day or two late is far better than never. But "see you at 7 tonight" is
 * worse than useless the morning after, so `day-of` and `last-call` get no
 * grace at all. This asymmetry is deliberate.
 */
export const GRACE_DAYS: Record<ReminderTone, number> = {
  'save-the-date': 3,
  'signups-open': 3,
  'reminder': 1,
  'last-call': 0,
  'day-of': 0,
};

// ============================================================
// Presets
// ============================================================

export interface CadencePreset {
  key: string;
  name: string;
  description: string;
  rules: ReminderRule[];
}

const r = (id: string, offsetDays: number, anchor: ReminderAnchor, tone: ReminderTone): ReminderRule =>
  ({ id, offsetDays, anchor, tone, enabled: true });

export const CADENCE_PRESETS: CadencePreset[] = [
  {
    key: 'standard',
    name: 'Standard',
    description: '30 days out, 15 days out, the night before the deadline, and a same-day note.',
    rules: [
      r('t30', 30, 'event', 'save-the-date'),
      r('t15', 15, 'event', 'signups-open'),
      r('d1', 1, 'deadline', 'last-call'),
      r('day0', 0, 'event', 'day-of'),
    ],
  },
  {
    key: 'flagship',
    name: 'Flagship',
    description: 'For the member-guest or club championships — two months of runway.',
    rules: [
      r('t60', 60, 'event', 'save-the-date'),
      r('t30', 30, 'event', 'signups-open'),
      r('t14', 14, 'event', 'reminder'),
      r('d3', 3, 'deadline', 'last-call'),
      r('d1', 1, 'deadline', 'last-call'),
      r('t2', 2, 'event', 'reminder'),
      r('day0', 0, 'event', 'day-of'),
    ],
  },
  {
    key: 'social',
    name: 'Casual social',
    description: 'A light touch for a Friday-night mixer — a week out, the day before, and day-of.',
    rules: [
      r('t7', 7, 'event', 'signups-open'),
      r('t1', 1, 'event', 'reminder'),
      r('day0', 0, 'event', 'day-of'),
    ],
  },
  {
    key: 'minimal',
    name: 'Just the essentials',
    description: 'One reminder the day before, and a same-day note.',
    rules: [
      r('t1', 1, 'event', 'reminder'),
      r('day0', 0, 'event', 'day-of'),
    ],
  },
  {
    key: 'none',
    name: 'No reminders',
    description: 'Nothing goes out automatically for this event.',
    rules: [],
  },
];

export function presetByKey(key: string): CadencePreset | null {
  return CADENCE_PRESETS.find((p) => p.key === key) ?? null;
}

/** A sensible starting cadence for an event of a given size. */
export function defaultCadence(effort: Effort): ReminderRule[] {
  if (effort === 'flagship') return clone(presetByKey('flagship')!.rules);
  if (effort === 'heavy') return clone(presetByKey('standard')!.rules);
  if (effort === 'medium') return clone(presetByKey('standard')!.rules);
  return clone(presetByKey('social')!.rules);
}

function clone(rules: ReminderRule[]): ReminderRule[] {
  return rules.map((x) => ({ ...x }));
}

/**
 * Which preset a cadence matches, for the UI to show as selected.
 * Compares the meaningful shape, not object identity.
 */
export function matchPreset(rules: ReminderRule[]): string | null {
  const key = (rs: ReminderRule[]) =>
    rs.filter((x) => x.enabled)
      .map((x) => `${x.offsetDays}:${x.anchor}:${x.tone}`)
      .sort()
      .join('|');
  const mine = key(rules);
  return CADENCE_PRESETS.find((p) => key(p.rules) === mine)?.key ?? null;
}

// ============================================================
// Resolving
// ============================================================

/** Turn rules into concrete dates against an event's anchors. */
export function resolveSchedule(
  rules: ReminderRule[],
  anchors: ReminderAnchors,
  today?: ISODate,
): ResolvedReminder[] {
  return rules
    .map((rule) => {
      const anchorDate = anchorFor(rule, anchors);
      const sendOn = anchorDate ? addDays(anchorDate, -rule.offsetDays) : null;

      let status: ResolvedReminder['status'];
      if (!rule.enabled) status = 'disabled';
      else if (!sendOn) status = 'unanchored';
      else if (today && sendOn < today) status = 'past';
      else status = 'scheduled';

      return { rule, sendOn, label: describeRule(rule), status };
    })
    .sort((a, b) => {
      if (!a.sendOn) return 1;
      if (!b.sendOn) return -1;
      return a.sendOn < b.sendOn ? -1 : 1;
    });
}

/**
 * The deadline anchor falls back to the event date. A director who sets
 * "the night before the deadline" without recording a separate deadline means
 * the night before the event, and refusing to send is a worse answer than
 * doing the obvious thing.
 */
function anchorFor(rule: ReminderRule, anchors: ReminderAnchors): ISODate | null {
  if (rule.anchor === 'deadline') return anchors.deadline ?? anchors.eventDate;
  return anchors.eventDate;
}

/**
 * Which rules should go out today.
 *
 * A rule is due when its send date has arrived, it is still inside its grace
 * window, it hasn't already been sent, and the event itself hasn't happened.
 * That last check matters: without it, a cadence added the week after an event
 * would immediately fire every "past" reminder at once.
 */
export function dueToday(params: {
  rules: ReminderRule[];
  anchors: ReminderAnchors;
  today: ISODate;
  alreadySent: Set<string>;
}): ResolvedReminder[] {
  const { rules, anchors, today, alreadySent } = params;

  // Nothing fires for an event that has already been and gone.
  if (anchors.eventDate && anchors.eventDate < today) return [];

  return resolveSchedule(rules, anchors, today).filter((res) => {
    if (!res.rule.enabled || !res.sendOn) return false;
    if (alreadySent.has(res.rule.id)) return false;
    if (res.sendOn > today) return false;
    return daysApart(res.sendOn, today) <= GRACE_DAYS[res.rule.tone];
  });
}

/** "30 days before the event" / "the night before the deadline". */
export function describeRule(rule: ReminderRule): string {
  const anchor = rule.anchor === 'deadline' ? 'the signup deadline' : 'the event';
  if (rule.offsetDays === 0) {
    return rule.anchor === 'deadline' ? 'On the deadline' : 'Morning of the event';
  }
  if (rule.offsetDays === 1) {
    return rule.anchor === 'deadline' ? 'The night before the deadline' : 'The day before';
  }
  return `${rule.offsetDays} days before ${anchor}`;
}

/** One-line summary for the item drawer: "4 reminders · first 30 days out". */
export function summarizeCadence(rules: ReminderRule[], anchors: ReminderAnchors): string {
  const on = rules.filter((x) => x.enabled);
  if (on.length === 0) return 'No reminders';
  const resolved = resolveSchedule(on, anchors);
  const first = resolved.find((x) => x.sendOn);
  return `${on.length} reminder${on.length === 1 ? '' : 's'}${
    first?.sendOn ? ` · first ${shortLabel(first.sendOn)}` : ''
  }`;
}

// ============================================================
// Copy
// ============================================================

export interface ToneCopy {
  /** `title` and `when` are already plain text. */
  subject: (title: string, when: string | null) => string;
  /** Opening line, HTML-safe plain text (the caller escapes). */
  lead: (title: string, when: string | null, startTime: string | null) => string;
  /** Short label for the UI. */
  label: string;
}

export const TONE_COPY: Record<ReminderTone, ToneCopy> = {
  'save-the-date': {
    label: 'Save the date',
    subject: (t) => `Save the date — ${t}`,
    lead: (t, when) =>
      `Putting this on your radar early: ${t} is coming${when ? ` on ${when}` : ''}. ` +
      `Get it in the calendar now — this one fills up.`,
  },
  'signups-open': {
    label: 'Sign up',
    subject: (t) => `${t} — signups are open`,
    lead: (t, when) =>
      `Signups are open for ${t}${when ? `, ${when}` : ''}. ` +
      `Grab your spot while there's still room.`,
  },
  'last-call': {
    label: 'Last call',
    subject: (t) => `Last call — ${t} signups close tomorrow`,
    lead: (t, when) =>
      `Last call for ${t}${when ? `, ${when}` : ''}. ` +
      `Signups close tomorrow, so if you're in, now's the moment.`,
  },
  'reminder': {
    label: 'Reminder',
    subject: (t) => `Coming up: ${t}`,
    lead: (t, when) =>
      `Quick reminder that ${t} is nearly here${when ? ` — ${when}` : ''}. ` +
      `Looking forward to seeing you.`,
  },
  'day-of': {
    label: 'Day of',
    subject: (t) => `Tonight: ${t}`,
    lead: (t, _when, startTime) =>
      startTime
        ? `See you at ${startTime} tonight for ${t}! Everything's set — just bring your racquet.`
        : `Today's the day — ${t} is on. Everything's set, we'll see you there.`,
  },
};

/**
 * The day-of subject should say "Tonight" for an evening event and "Today" for
 * a morning one, because "Tonight:" on a 9am event reads as a mistake.
 */
export function dayOfWord(startTime: string | null): 'Tonight' | 'Today' {
  if (!startTime) return 'Today';
  const hour = Number(startTime.slice(0, 2));
  return Number.isFinite(hour) && hour >= 16 ? 'Tonight' : 'Today';
}

/** Subject + lead for one fired reminder. */
export function reminderCopy(params: {
  tone: ReminderTone;
  title: string;
  whenLabel: string | null;
  startTime: string | null;
}): { subject: string; lead: string } {
  const { tone, title, whenLabel, startTime } = params;
  const c = TONE_COPY[tone];

  if (tone === 'day-of') {
    const word = dayOfWord(startTime);
    return {
      subject: `${word}: ${title}`,
      lead: word === 'Tonight'
        ? c.lead(title, whenLabel, startTime ? time12(startTime) : null)
        : startTime
          ? `See you at ${time12(startTime)} today for ${title}! Everything's set — just bring your racquet.`
          : c.lead(title, whenLabel, null),
    };
  }

  return {
    subject: c.subject(title, whenLabel),
    lead: c.lead(title, whenLabel, startTime ? time12(startTime) : null),
  };
}

/** '19:00' → '7pm', '19:30' → '7:30pm'. */
export function time12(t: string): string {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(h)) return t;
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

// ============================================================
// Validation
// ============================================================

const TONES: ReminderTone[] = ['save-the-date', 'signups-open', 'last-call', 'reminder', 'day-of'];
const ANCHORS: ReminderAnchor[] = ['event', 'deadline'];

/**
 * Clean whatever the client sent into storable rules.
 *
 * Duplicate ids are dropped rather than merged: the id is the dedupe key for
 * sending, so two rules sharing one would mean the second silently never fires.
 */
export function sanitizeCadence(input: unknown): ReminderRule[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ReminderRule[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;

    const id = String(o.id ?? '').trim().slice(0, 40);
    if (!id || seen.has(id)) continue;

    const offset = Number(o.offsetDays);
    if (!Number.isFinite(offset) || offset < 0 || offset > 365) continue;

    const anchor = ANCHORS.includes(o.anchor as ReminderAnchor) ? (o.anchor as ReminderAnchor) : 'event';
    const tone = TONES.includes(o.tone as ReminderTone) ? (o.tone as ReminderTone) : 'reminder';

    seen.add(id);
    out.push({ id, offsetDays: Math.round(offset), anchor, tone, enabled: o.enabled !== false });
    if (out.length >= 12) break;
  }

  return out;
}
