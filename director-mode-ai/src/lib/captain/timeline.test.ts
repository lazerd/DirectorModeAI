import { describe, it, expect } from 'vitest';
import {
  buildTimeline,
  dueAtFor,
  isDue,
  nextCronTick,
  resolveSettings,
  type MatchRow,
  type OverrideRow,
  type TimelineCounts,
} from './timeline';

const match = (over: Partial<MatchRow> = {}): MatchRow => ({
  id: 'm1',
  match_at: '2026-09-01T16:30:00.000Z',
  status: 'scheduled',
  is_home: true,
  opponent: 'Diablo Valley',
  availability_poll_sent_at: null,
  nudge_sent_at: null,
  lineup_email_sent_at: null,
  reminder_sent_at: null,
  ...over,
});

const counts = (over: Partial<TimelineCounts> = {}): TimelineCounts => ({
  roster: 24,
  unanswered: new Map([['m1', 5]]),
  lineupCourts: new Map([['m1', 3]]),
  playing: new Map([['m1', 6]]),
  ...over,
});

const build = (
  now: string,
  m: MatchRow = match(),
  overrides: OverrideRow[] = [],
  c: TimelineCounts = counts(),
) =>
  buildTimeline({
    matches: [m],
    settings: resolveSettings([]),
    overrides,
    counts: c,
    now: new Date(now),
    subjectFor: (kind) => `subject:${kind}`,
  });

const pick = (events: ReturnType<typeof build>, kind: string) =>
  events.find((e) => e.kind === kind)!;

describe('nextCronTick', () => {
  it('uses the same day when the due moment is before the 16:00Z run', () => {
    expect(nextCronTick('2026-08-25T09:00:00.000Z')).toBe('2026-08-25T16:00:00.000Z');
  });

  it('rolls to the next day when the due moment is after the run', () => {
    expect(nextCronTick('2026-08-25T18:00:00.000Z')).toBe('2026-08-26T16:00:00.000Z');
  });

  it('treats the run time itself as on time', () => {
    expect(nextCronTick('2026-08-25T16:00:00.000Z')).toBe('2026-08-25T16:00:00.000Z');
  });
});

describe('dueAtFor', () => {
  it('subtracts the lead time from the match', () => {
    expect(dueAtFor('2026-09-01T16:30:00.000Z', 7)).toBe('2026-08-25T16:30:00.000Z');
  });

  it('honours fractional days', () => {
    expect(dueAtFor('2026-09-01T16:30:00.000Z', 0.5)).toBe('2026-09-01T04:30:00.000Z');
  });

  it('lets a per-match send_at win over the lead time', () => {
    const ov = { send_at: '2026-08-20T16:00:00.000Z' } as OverrideRow;
    expect(dueAtFor('2026-09-01T16:30:00.000Z', 7, ov)).toBe('2026-08-20T16:00:00.000Z');
  });
});

describe('resolveSettings', () => {
  it('falls back to the shipped defaults, with the poll blast off', () => {
    const s = resolveSettings([]);
    expect(s.lineup).toMatchObject({ leadDays: 7, enabled: true, isDefault: true });
    expect(s.nudge.leadDays).toBe(2);
    expect(s.reminder.leadDays).toBe(1);
    expect(s.poll.enabled).toBe(false);
  });

  it('prefers a stored row and coerces numeric strings from postgres', () => {
    const s = resolveSettings([
      { kind: 'lineup', enabled: false, lead_days: '10.5', subject_override: 'Hi', intro_override: null },
    ]);
    expect(s.lineup).toMatchObject({ leadDays: 10.5, enabled: false, subjectOverride: 'Hi', isDefault: false });
  });
});

describe('buildTimeline', () => {
  it('schedules the lineup email on the cron tick a week out', () => {
    const e = pick(build('2026-08-01T00:00:00.000Z'), 'lineup');
    expect(e.status).toBe('scheduled');
    expect(e.sendAt).toBe('2026-08-26T16:00:00.000Z'); // due 8/25 16:30Z -> next 16:00Z run
  });

  it('marks a send whose moment has passed as due rather than late', () => {
    const e = pick(build('2026-08-27T00:00:00.000Z'), 'lineup');
    expect(e.status).toBe('due');
  });

  it('reports sent emails with the time they actually went', () => {
    const e = pick(
      build('2026-08-27T00:00:00.000Z', match({ lineup_email_sent_at: '2026-08-26T16:00:12.000Z' })),
      'lineup',
    );
    expect(e.status).toBe('sent');
    expect(e.sentAt).toBe('2026-08-26T16:00:12.000Z');
  });

  it('blocks lineup-dependent emails until a lineup exists', () => {
    const e = pick(
      build('2026-08-27T00:00:00.000Z', match(), [], counts({ lineupCourts: new Map([['m1', 0]]) })),
      'lineup',
    );
    expect(e.status).toBe('blocked');
    expect(e.reason).toMatch(/No lineup built/);
  });

  it('blocks the nudge once everybody has answered', () => {
    const e = pick(
      build('2026-08-30T18:00:00.000Z', match(), [], counts({ unanswered: new Map([['m1', 0]]) })),
      'nudge',
    );
    expect(e.status).toBe('blocked');
    expect(e.reason).toMatch(/already answered/);
  });

  it('shows a per-match skip as skipped and flags the row as edited', () => {
    const ov: OverrideRow = {
      match_id: 'm1',
      kind: 'reminder',
      skip: true,
      send_at: null,
      subject_override: null,
      intro_override: null,
    };
    const e = pick(build('2026-08-01T00:00:00.000Z', match(), [ov]), 'reminder');
    expect(e.status).toBe('skipped');
    expect(e.edited).toBe(true);
  });

  it('shows a disabled kind as off rather than scheduled', () => {
    const e = pick(build('2026-08-01T00:00:00.000Z'), 'poll');
    expect(e.status).toBe('off');
  });

  it('never schedules anything for a match that has already been played', () => {
    const e = pick(build('2026-09-02T00:00:00.000Z'), 'lineup');
    expect(e.status).toBe('missed');
  });

  it('drops emails for a cancelled match', () => {
    const e = pick(build('2026-08-01T00:00:00.000Z', match({ status: 'cancelled' })), 'lineup');
    expect(e.status).toBe('skipped');
  });

  it('sizes the audience per kind', () => {
    const events = build('2026-08-01T00:00:00.000Z');
    expect(pick(events, 'lineup').audienceCount).toBe(24); // whole roster
    expect(pick(events, 'nudge').audienceCount).toBe(5); // only the silent ones
    expect(pick(events, 'reminder').audienceCount).toBe(6); // only who is playing
  });

  it('orders the season by when each email goes out', () => {
    const kinds = build('2026-08-01T00:00:00.000Z').map((e) => e.kind);
    expect(kinds.indexOf('lineup')).toBeLessThan(kinds.indexOf('nudge'));
    expect(kinds.indexOf('nudge')).toBeLessThan(kinds.indexOf('reminder'));
  });
});

describe('isDue agrees with the timeline', () => {
  const settings = resolveSettings([]);

  it('is true exactly when the dashboard says due', () => {
    const now = new Date('2026-08-27T00:00:00.000Z');
    const m = match();
    expect(isDue('lineup', m, settings.lineup, null, now)).toBe(true);
    expect(pick(build(now.toISOString(), m), 'lineup').status).toBe('due');
  });

  it('is false while the dashboard still says scheduled', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    expect(isDue('lineup', match(), settings.lineup, null, now)).toBe(false);
  });

  it('stops once the send has been stamped', () => {
    const now = new Date('2026-08-27T00:00:00.000Z');
    const m = match({ lineup_email_sent_at: '2026-08-26T16:00:00.000Z' });
    expect(isDue('lineup', m, settings.lineup, null, now)).toBe(false);
  });

  it('stops for a skipped match and a disabled kind', () => {
    const now = new Date('2026-08-27T00:00:00.000Z');
    const ov: OverrideRow = {
      match_id: 'm1',
      kind: 'lineup',
      skip: true,
      send_at: null,
      subject_override: null,
      intro_override: null,
    };
    expect(isDue('lineup', match(), settings.lineup, ov, now)).toBe(false);
    expect(isDue('poll', match(), settings.poll, null, now)).toBe(false);
  });

  it('never fires after the match has started', () => {
    const now = new Date('2026-09-01T17:00:00.000Z');
    expect(isDue('reminder', match(), settings.reminder, null, now)).toBe(false);
  });
});
