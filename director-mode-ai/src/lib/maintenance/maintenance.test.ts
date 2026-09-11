import { describe, it, expect } from 'vitest';
import { addDays, clubNowHHMM, clubToday, daysBetween, time12, weekdayOf } from './dates';
import { appliesOn, checklistFor, describeDays, groupChecklist, missedOn, missRecord } from './routine';
import { canDeleteTask, canEditTask, canTransition, isOverdue, sortTasks, statusPatch } from './tasks';
import { isPastTarget, isStalled, nextStep, progressPct } from './projects';
import { buildInsights } from './insights';
import { buildDigest } from './digest';
import type { RoutineCheck, RoutineItem, Task } from './types';

const LA = 'America/Los_Angeles';

function item(over: Partial<RoutineItem> = {}): RoutineItem {
  return {
    id: over.id ?? 'i1',
    title: 'Skim pool',
    notes: null,
    department: 'aquatics',
    location: 'Pool',
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    target_time: null,
    sort_order: 0,
    active_from: '2026-09-01',
    archived_on: null,
    ...over,
  };
}
function check(itemId: string, date: string, status: 'done' | 'skipped' = 'done'): RoutineCheck {
  return { id: `${itemId}-${date}`, item_id: itemId, local_date: date, status, done_by: 'u1', done_at: `${date}T14:00:00Z`, note: null, photo_url: null };
}
function task(over: Partial<Task> = {}): Task {
  return {
    id: over.id ?? 't1',
    title: 'Fix net on court 4',
    description: null,
    department: 'tennis',
    location: 'Court 4',
    priority: 'normal',
    due_date: null,
    status: 'open',
    photo_url: null,
    created_by: 'poster',
    created_at: '2026-09-10T15:00:00Z',
    started_at: null,
    started_by: null,
    completed_at: null,
    completed_by: null,
    completion_note: null,
    completion_photo_url: null,
    ...over,
  };
}

describe('club-local dates', () => {
  it('is still yesterday in LA at 06:30 UTC, but today in New York', () => {
    const now = new Date('2026-09-11T06:30:00Z');
    expect(clubToday(now, LA)).toBe('2026-09-10');
    expect(clubToday(now, 'America/New_York')).toBe('2026-09-11');
  });

  it('reads the club wall clock', () => {
    expect(clubNowHHMM(new Date('2026-09-11T14:05:00Z'), LA)).toBe('07:05');
  });

  it('keeps weekdays right across both DST changes', () => {
    expect(weekdayOf('2026-03-08')).toBe(0); // Sunday, spring forward
    expect(weekdayOf('2026-11-01')).toBe(0); // Sunday, fall back
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14);
  });

  it('formats a target time for people', () => {
    expect(time12('07:00:00')).toBe('7:00 AM');
    expect(time12('21:30')).toBe('9:30 PM');
    expect(time12('12:00')).toBe('12:00 PM');
  });
});

describe('the daily routine', () => {
  it('applies only on its days — Sunday is 0', () => {
    const weekdays = item({ days_of_week: [1, 2, 3, 4, 5] });
    expect(appliesOn(weekdays, '2026-09-12')).toBe(false); // Saturday
    expect(appliesOn(weekdays, '2026-09-11')).toBe(true); // Friday
  });

  it('never calls a brand-new item missed', () => {
    const fresh = item({ active_from: '2026-09-11' });
    expect(missedOn([fresh], [], '2026-09-10')).toEqual([]);
  });

  it('never calls an archived item missed', () => {
    const gone = item({ archived_on: '2026-09-10' });
    expect(missedOn([gone], [], '2026-09-10')).toEqual([]);
  });

  it('treats a skip as handled, not missed', () => {
    expect(missedOn([item()], [check('i1', '2026-09-10', 'skipped')], '2026-09-10')).toEqual([]);
  });

  it('does not count a check from a different day', () => {
    expect(missedOn([item()], [check('i1', '2026-09-09')], '2026-09-10').map((i) => i.id)).toEqual(['i1']);
  });

  it('marks a pending item late once its target time passes', () => {
    const rows = checklistFor([item({ target_time: '07:00:00' })], [], '2026-09-11', '07:30');
    expect(rows[0].state).toBe('late');
    expect(checklistFor([item({ target_time: '07:00:00' })], [], '2026-09-11', '06:30')[0].state).toBe('pending');
  });

  it('groups by target time with Anytime last', () => {
    const rows = checklistFor(
      [item({ id: 'a', title: 'Anytime job' }), item({ id: 'b', target_time: '07:00' }), item({ id: 'c', target_time: '10:00' })],
      [],
      '2026-09-11',
    );
    expect(groupChecklist(rows).map((g) => g.label)).toEqual(['By 7:00 AM', 'By 10:00 AM', 'Anytime']);
  });

  it('counts misses over the last week', () => {
    const checks = ['2026-09-10', '2026-09-08', '2026-09-06', '2026-09-05'].map((d) => check('i1', d));
    const [rec] = missRecord([item()], checks, '2026-09-11', 7);
    expect(rec).toMatchObject({ due: 7, missed: 3 });
  });

  it('describes days the way a board would', () => {
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(describeDays([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(describeDays([6, 0])).toBe('Weekends');
    expect(describeDays([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(describeDays([0, 2])).toBe('Tue, Sun');
  });
});

describe('one-off tasks', () => {
  it('is overdue only after the due date, and never once done', () => {
    expect(isOverdue(task({ due_date: '2026-09-11' }), '2026-09-11')).toBe(false);
    expect(isOverdue(task({ due_date: '2026-09-10' }), '2026-09-11')).toBe(true);
    expect(isOverdue(task({ due_date: '2026-09-10', status: 'done' }), '2026-09-11')).toBe(false);
    expect(isOverdue(task({ due_date: '2026-09-10', status: 'cancelled' }), '2026-09-11')).toBe(false);
  });

  it('sorts overdue, then urgent → low, then due date', () => {
    const sorted = sortTasks(
      [
        task({ id: 'low', priority: 'low' }),
        task({ id: 'urgent', priority: 'urgent' }),
        task({ id: 'overdue-normal', due_date: '2026-09-01' }),
        task({ id: 'done', status: 'done', priority: 'urgent' }),
        task({ id: 'high-soon', priority: 'high', due_date: '2026-09-12' }),
      ],
      '2026-09-11',
    );
    expect(sorted.map((t) => t.id)).toEqual(['overdue-normal', 'urgent', 'high-soon', 'low', 'done']);
  });

  it('allows only sensible status changes', () => {
    expect(canTransition('open', 'in_progress')).toBe(true);
    expect(canTransition('done', 'open')).toBe(true);
    expect(canTransition('done', 'in_progress')).toBe(false);
    expect(canTransition('cancelled', 'done')).toBe(false);
  });

  it('stamps who and when, and reopening clears the completion', () => {
    expect(statusPatch('done', 'u9', 'NOW')).toMatchObject({ status: 'done', completed_by: 'u9', completed_at: 'NOW' });
    const reopen = statusPatch('open', 'u9', 'NOW');
    expect(reopen).toMatchObject({ status: 'open', completed_at: null, completed_by: null, completion_note: null });
  });

  it('lets the poster or a manager edit; delete only while still open', () => {
    const crew = { userId: 'crew', canManage: false };
    const mgr = { userId: 'mgr', canManage: true };
    const mine = task({ created_by: 'crew' });
    expect(canEditTask(crew, mine)).toBe(true);
    expect(canEditTask(crew, task({ created_by: 'someone' }))).toBe(false);
    expect(canEditTask(mgr, task({ created_by: 'someone' }))).toBe(true);
    expect(canDeleteTask(crew, mine)).toBe(true);
    expect(canDeleteTask(crew, { ...mine, status: 'in_progress' })).toBe(false);
    expect(canDeleteTask(mgr, { ...mine, status: 'done' })).toBe(true);
  });
});

describe('projects', () => {
  it('measures progress by steps, and says nothing without any', () => {
    expect(progressPct([])).toBeNull();
    expect(progressPct([{ done: true }, { done: false }, { done: false }])).toBe(33);
    expect(progressPct([{ done: true }, { done: true }])).toBe(100);
  });

  it('flags past target and stalled work', () => {
    expect(isPastTarget({ status: 'active', target_date: '2026-09-01' }, '2026-09-11')).toBe(true);
    expect(isPastTarget({ status: 'done', target_date: '2026-09-01' }, '2026-09-11')).toBe(false);
    expect(isStalled({ status: 'active' }, '2026-08-28', '2026-09-11')).toBe(true); // 14 days
    expect(isStalled({ status: 'active' }, '2026-08-29', '2026-09-11')).toBe(false); // 13 days
    expect(isStalled({ status: 'on_hold' }, '2026-08-01', '2026-09-11')).toBe(false);
  });

  it('finds the next unfinished step in order', () => {
    expect(nextStep([{ done: true, sort_order: 0, title: 'A' }, { done: false, sort_order: 2, title: 'C' }, { done: false, sort_order: 1, title: 'B' }])?.title).toBe('B');
  });
});

describe('insights', () => {
  it('names at most three findings, worst first', () => {
    const out = buildInsights({
      items: [item()],
      checks: ['2026-09-10', '2026-09-09'].map((d) => check('i1', d)),
      tasks: [
        task({ id: 'u', priority: 'urgent', title: 'Court 4 net torn', created_at: '2026-09-09T15:00:00Z' }),
        task({ id: 'o', title: 'Paint lines', due_date: '2026-09-05' }),
      ],
      projects: [
        { id: 'p', title: 'Resurface courts 7–8', description: null, department: 'tennis', location: null, target_date: '2026-09-01', status: 'active', completed_at: null, created_by: null, created_at: '', updated_at: '', lastActivity: '2026-09-10' },
      ],
      today: '2026-09-11',
    });
    expect(out).toHaveLength(3);
    expect(out[0].text).toMatch(/Urgent task open 2 days: Court 4 net torn/);
    expect(out[1].text).toMatch(/Overdue: Paint lines/);
    expect(out[2].text).toMatch(/Skim pool missed 5 of the last 7/);
  });
});

describe('the morning digest', () => {
  const base = {
    clubName: 'Sleepy Hollow',
    date: '2026-09-11',
    appUrl: 'https://clubmode.ai',
    routineToday: checklistFor([item({ target_time: '07:00' })], [], '2026-09-11'),
    missedYesterday: [item({ id: 'm', title: 'Clubhouse trash' })],
    tasks: [task({ priority: 'urgent' }), task({ id: 't2', due_date: '2026-09-01' }), task({ id: 't3', title: 'Order new balls', priority: 'low' })],
    projects: [{ title: 'Repaint pool deck', pct: 40, target_date: '2026-10-01' }],
  };

  it('counts the day in the subject', () => {
    expect(buildDigest(base).subject).toBe('Fri Sep 11 at Sleepy Hollow: 1 routine item · 3 open tasks (1 urgent, 1 overdue)');
  });

  it('leads with what was missed, then what is urgent', () => {
    const { html } = buildDigest(base);
    expect(html.indexOf('Missed yesterday')).toBeLessThan(html.indexOf('Urgent &amp; overdue'));
    expect(html.indexOf('Urgent &amp; overdue')).toBeLessThan(html.indexOf("Today&#39;s routine"));
    expect(html).toContain('https://clubmode.ai/maintenance');
  });

  it('leaves out an empty section and reports an empty day', () => {
    const none = buildDigest({ ...base, routineToday: [], missedYesterday: [], tasks: [], projects: [] });
    expect(none.isEmpty).toBe(true);
    expect(buildDigest({ ...base, missedYesterday: [] }).html).not.toContain('Missed yesterday');
  });

  it('escapes anything a person typed', () => {
    const { html } = buildDigest({ ...base, tasks: [task({ title: '<script>alert(1)</script>' })] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
