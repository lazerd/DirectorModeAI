'use client';

/**
 * MaintenanceMode — one screen, four tabs.
 *
 *   Today     the crew's home: missed-yesterday, the checklist, what needs attention
 *   Tasks     work orders; anyone can report a problem
 *   Projects  big jobs with steps and progress
 *   Setup     owner/directors: the routine, the digest, the crew
 *
 * Built for phones first: 56px tap targets, a bottom tab bar, bottom sheets.
 * Ticking an item updates the screen immediately and rolls back if the save
 * fails. The board refreshes when the tab regains focus and every minute
 * while visible, so two people ticking the same list stay in step.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CalendarClock, Check, ChevronRight, ClipboardList, FolderKanban,
  HardHat, Loader2, MoreHorizontal, Plus, Settings, SkipForward, Undo2,
} from 'lucide-react';
import { groupChecklist, type ChecklistRow } from '@/lib/maintenance/routine';
import { isOverdue } from '@/lib/maintenance/tasks';
import { daysBetween, longDate, shortDate } from '@/lib/maintenance/dates';
import {
  DEPARTMENTS, DEPARTMENT_LABEL, PRIORITIES, PRIORITY_LABEL,
  type Department, type Priority, type RoutineCheck, type RoutineItem, type Task,
} from '@/lib/maintenance/types';
import type { ProjectSummary } from '@/lib/maintenance/load';
import type { Insight } from '@/lib/maintenance/insights';
import {
  ACCENT, FIELD, fieldCls, api, ghostBtn, primaryBtn, Pill, PhotoPicker, PriorityPill, Sheet, type Photo,
} from './ui';
import MaintenanceSetup from './MaintenanceSetup';
import TaskSheet from './TaskSheet';

type Board = {
  today: string;
  nowHHMM: string;
  club: { id: string; name: string; timezone: string };
  me: { id: string; role: string; canManage: boolean; isCrew: boolean };
  items: RoutineItem[];
  checks: RoutineCheck[];
  checklist: ChecklistRow[];
  missedYesterday: RoutineItem[];
  tasks: Task[];
  recentDone: Task[];
  projects: ProjectSummary[];
  insights: Insight[];
  crewCount: number;
  names: Record<string, string>;
};

type Tab = 'today' | 'tasks' | 'projects' | 'setup';

export default function MaintenanceClient({
  clubName,
  canManage,
  isCrew,
  meId,
}: {
  clubName: string;
  canManage: boolean;
  isCrew: boolean;
  meId: string;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<ChecklistRow | null>(null);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [reporting, setReporting] = useState(false);
  const [setupIntent, setSetupIntent] = useState<'starter' | 'add' | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBoard(await api<Board>('GET', '/api/maintenance/board'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(t);
    };
  }, [refresh]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const who = useCallback(
    (id: string | null | undefined) => (!id ? 'Someone' : id === meId ? 'You' : board?.names[id] || 'Someone'),
    [board, meId],
  );
  const clock = useCallback(
    (iso: string) =>
      new Date(iso).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: board?.club.timezone || 'America/Los_Angeles',
      }),
    [board],
  );

  /** Tick / skip / undo, with an optimistic update. */
  async function mark(item: RoutineItem, day: 'today' | 'yesterday', status: 'done' | 'skipped' | 'undo', extra?: { note?: string; photo?: Photo | null }) {
    if (!board) return;
    const before = board;
    if (day === 'today') {
      setBoard({
        ...board,
        checklist: board.checklist.map((r) =>
          r.item.id !== item.id
            ? r
            : status === 'undo'
              ? { ...r, check: null, state: 'pending' }
              : {
                  ...r,
                  state: status,
                  check: { id: 'pending', item_id: item.id, local_date: board.today, status, done_by: meId, done_at: new Date().toISOString(), note: extra?.note ?? null, photo_url: extra?.photo?.url ?? null },
                },
        ),
      });
    } else if (status !== 'undo') {
      setBoard({ ...board, missedYesterday: board.missedYesterday.filter((i) => i.id !== item.id) });
    }
    try {
      if (status === 'undo') await api('DELETE', `/api/maintenance/routine/${item.id}/check?date=${day}`);
      else {
        const r = await api<{ already?: boolean; check?: RoutineCheck }>('POST', `/api/maintenance/routine/${item.id}/check`, {
          date: day,
          status,
          note: extra?.note,
          photo_path: extra?.photo?.path,
        });
        if (r.already && r.check) flash(`Already done by ${who(r.check.done_by)} at ${clock(r.check.done_at)}`);
      }
      void refresh();
    } catch (e) {
      setBoard(before);
      flash((e as Error).message);
    }
  }

  const tabs: { key: Tab; label: string; icon: typeof HardHat }[] = [
    { key: 'today', label: 'Today', icon: CalendarClock },
    { key: 'tasks', label: 'Tasks', icon: ClipboardList },
    { key: 'projects', label: 'Projects', icon: FolderKanban },
    ...(canManage ? [{ key: 'setup' as Tab, label: 'Setup', icon: Settings }] : []),
  ];

  const done = board ? board.checklist.filter((r) => r.state === 'done' || r.state === 'skipped').length : 0;
  const total = board?.checklist.length ?? 0;

  return (
    <div className="min-h-screen bg-[#001820] pb-28 text-white md:pb-10">
      <div className="mx-auto max-w-3xl px-4 pt-6 md:px-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `${ACCENT}22`, color: ACCENT }}>
            <HardHat size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-white/45">{clubName} · MaintenanceMode</p>
            <h1 className="text-2xl font-semibold">{board ? longDate(board.today) : 'Loading…'}</h1>
            {board && total > 0 && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[13px] text-white/55">
                  <span>
                    {done} of {total} done today
                  </span>
                  {done === total && <span style={{ color: ACCENT }}>All done ✓</span>}
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(done / total) * 100}%`, background: ACCENT }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Desktop tabs */}
        <div className="mt-5 hidden gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 md:flex">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-lg px-3 py-2 text-[14px] font-medium transition ${tab === t.key ? 'text-[#1a1200]' : 'text-white/60 hover:text-white'}`}
              style={tab === t.key ? { background: ACCENT } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        {!board && !error && (
          <p className="mt-10 flex items-center gap-2 text-white/50">
            <Loader2 size={16} className="animate-spin" /> Loading the board…
          </p>
        )}

        {board && tab === 'today' && (
          <TodayTab
            board={board}
            canManage={canManage}
            isCrew={isCrew}
            who={who}
            clock={clock}
            onTap={(r) => (r.state === 'pending' || r.state === 'late' ? mark(r.item, 'today', 'done') : setRowMenu(r))}
            onMenu={setRowMenu}
            onMissed={(i, s) => mark(i, 'yesterday', s)}
            onTask={setOpenTask}
            onSetup={(intent) => {
              setSetupIntent(intent);
              setTab('setup');
            }}
          />
        )}
        {board && tab === 'tasks' && (
          <TasksTab board={board} who={who} onOpen={setOpenTask} onReport={() => setReporting(true)} />
        )}
        {board && tab === 'projects' && <ProjectsTab board={board} canManage={canManage} onChanged={refresh} />}
        {board && tab === 'setup' && canManage && (
          <MaintenanceSetup
            crewCount={board.crewCount}
            intent={setupIntent}
            onIntentHandled={() => setSetupIntent(null)}
            onChanged={refresh}
          />
        )}
      </div>

      {/* Report a problem — from Today and Tasks. */}
      {board && (tab === 'today' || tab === 'tasks') && (
        <button
          onClick={() => setReporting(true)}
          className="fixed bottom-24 right-4 z-40 inline-flex min-h-[52px] items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-[#1a1200] shadow-lg md:bottom-8"
          style={{ background: ACCENT }}
        >
          <Plus size={18} /> Report a problem
        </button>
      )}

      {/* Phone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 bg-[#002838] md:hidden">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex min-h-[64px] flex-1 flex-col items-center justify-center gap-0.5 text-[12px]"
            style={{ color: tab === t.key ? ACCENT : 'rgba(255,255,255,0.55)' }}
          >
            <t.icon size={20} />
            {t.label}
          </button>
        ))}
      </nav>

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-[70] mx-auto w-fit max-w-[90vw] rounded-xl bg-black/85 px-4 py-2.5 text-[14px] text-white md:bottom-10">
          {toast}
        </div>
      )}

      {rowMenu && board && (
        <RowSheet
          row={rowMenu}
          who={who}
          clock={clock}
          onClose={() => setRowMenu(null)}
          onMark={async (status, extra) => {
            setRowMenu(null);
            await mark(rowMenu.item, 'today', status, extra);
          }}
        />
      )}
      {openTask && board && (
        <TaskSheet
          task={openTask}
          today={board.today}
          meId={meId}
          canManage={canManage}
          who={who}
          onClose={() => setOpenTask(null)}
          onChanged={async (msg) => {
            setOpenTask(null);
            if (msg) flash(msg);
            await refresh();
          }}
        />
      )}
      {reporting && (
        <ReportSheet
          onClose={() => setReporting(false)}
          onPosted={async () => {
            setReporting(false);
            flash('Posted — the crew will see it on their board.');
            await refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Today */

function TodayTab({
  board,
  canManage,
  isCrew,
  who,
  clock,
  onTap,
  onMenu,
  onMissed,
  onTask,
  onSetup,
}: {
  board: Board;
  canManage: boolean;
  isCrew: boolean;
  who: (id: string | null) => string;
  clock: (iso: string) => string;
  onTap: (r: ChecklistRow) => void;
  onMenu: (r: ChecklistRow) => void;
  onMissed: (i: RoutineItem, s: 'done' | 'skipped') => void;
  onTask: (t: Task) => void;
  onSetup: (intent: 'starter' | 'add') => void;
}) {
  const groups = useMemo(() => groupChecklist(board.checklist), [board.checklist]);
  const attention = board.tasks.filter((t) => t.priority === 'urgent' || isOverdue(t, board.today)).slice(0, 3);
  const noRoutine = board.items.filter((i) => !i.archived_on).length === 0;

  return (
    <div className="mt-5 space-y-5">
      {canManage && board.insights.length > 0 && (
        <div className="space-y-2">
          {board.insights.map((i, k) => (
            <p
              key={k}
              className={`flex items-start gap-2 rounded-xl border p-3 text-[14px] ${i.tone === 'red' ? 'border-red-400/30 bg-red-500/10 text-red-100' : 'border-amber-400/30 bg-amber-400/10 text-amber-100'}`}
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {i.text}
            </p>
          ))}
        </div>
      )}

      {canManage && board.crewCount === 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#002838] p-4 text-[14px] text-white/70">
          No maintenance staff yet. Invite them from{' '}
          <Link href="/club/people?role=maintenance" className="underline" style={{ color: ACCENT }}>
            People
          </Link>{' '}
          so they get the checklist and the morning email.
        </div>
      )}

      {board.missedYesterday.length > 0 && (
        <div className="rounded-2xl border border-amber-400/35 bg-amber-400/[0.08] p-4">
          <h2 className="text-[15px] font-semibold text-amber-200">Missed yesterday ({board.missedYesterday.length})</h2>
          <ul className="mt-2 divide-y divide-white/5">
            {board.missedYesterday.map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 text-[15px]">{i.title}</span>
                <button onClick={() => onMissed(i, 'done')} className="min-h-[44px] rounded-lg border border-amber-400/40 px-3 text-[13px] text-amber-100">
                  Done late
                </button>
                <button onClick={() => onMissed(i, 'skipped')} className="min-h-[44px] rounded-lg border border-white/15 px-3 text-[13px] text-white/60">
                  Skip
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {noRoutine ? (
        canManage ? (
          <div className="rounded-2xl border border-white/10 bg-[#002838] p-5">
            <h2 className="text-[17px] font-semibold">Set up the daily routine</h2>
            <p className="mt-1 text-[14px] text-white/60">
              The chores that happen every day — blowing courts, skimming the pool, restocking restrooms. The crew ticks them off from their phones.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => onSetup('starter')} className={primaryBtn}>
                Start from a template
              </button>
              <button onClick={() => onSetup('add')} className={ghostBtn}>
                Add my own
              </button>
            </div>
          </div>
        ) : (
          <p className="rounded-2xl border border-white/10 bg-[#002838] p-5 text-[15px] text-white/60">
            {isCrew ? 'Nothing posted yet. Your manager adds the daily checklist here.' : 'No daily routine set up yet.'}
          </p>
        )
      ) : board.checklist.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-[#002838] p-5 text-[15px] text-white/60">Nothing on the routine for today.</p>
      ) : (
        groups.map((g) => (
          <section key={g.label}>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-white/45">{g.label}</h2>
            <ul className="space-y-2">
              {g.rows.map((r) => {
                const finished = r.state === 'done' || r.state === 'skipped';
                return (
                  <li key={r.item.id} className="flex items-stretch gap-2">
                    <button
                      onClick={() => onTap(r)}
                      className={`flex min-h-[60px] flex-1 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${finished ? 'border-white/5 bg-white/[0.02]' : r.state === 'late' ? 'border-amber-400/40 bg-amber-400/[0.06]' : 'border-white/10 bg-[#002838] active:bg-white/5'}`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${r.state === 'done' ? 'border-transparent text-[#1a1200]' : r.state === 'skipped' ? 'border-white/25 text-white/40' : 'border-white/30'}`}
                        style={r.state === 'done' ? { background: ACCENT } : undefined}
                      >
                        {r.state === 'done' && <Check size={16} strokeWidth={3} />}
                        {r.state === 'skipped' && <SkipForward size={13} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[15.5px] ${finished ? 'text-white/45 line-through decoration-white/20' : 'text-white'}`}>{r.item.title}</span>
                        <span className="block text-[12.5px] text-white/45">
                          {r.check
                            ? `${r.state === 'skipped' ? 'Skipped' : '✓'} ${who(r.check.done_by)} · ${clock(r.check.done_at)}${r.check.note ? ` — “${r.check.note}”` : ''}`
                            : [r.item.location, DEPARTMENT_LABEL[r.item.department], r.state === 'late' ? 'Past its time' : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                    <button onClick={() => onMenu(r)} className="flex w-12 items-center justify-center rounded-2xl border border-white/10 text-white/50" aria-label="More">
                      <MoreHorizontal size={18} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {attention.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-white/45">Needs attention</h2>
          <ul className="space-y-2">
            {attention.map((t) => (
              <TaskCard key={t.id} task={t} today={board.today} who={who} onOpen={onTask} />
            ))}
          </ul>
        </section>
      )}

      {board.recentDone.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-white/45">Finished in the last day</h2>
          <ul className="space-y-1 text-[14px] text-white/60">
            {board.recentDone.map((t) => (
              <li key={t.id}>
                ✓ {t.title} — {who(t.completed_by)}
                {t.completed_at ? ` · ${clock(t.completed_at)}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RowSheet({
  row,
  who,
  clock,
  onClose,
  onMark,
}: {
  row: ChecklistRow;
  who: (id: string | null) => string;
  clock: (iso: string) => string;
  onClose: () => void;
  onMark: (s: 'done' | 'skipped' | 'undo', extra?: { note?: string; photo?: Photo | null }) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const finished = !!row.check;
  return (
    <Sheet open title={row.item.title} onClose={onClose}>
      {row.item.notes && <p className="mb-3 text-[14px] text-white/65">{row.item.notes}</p>}
      {finished ? (
        <>
          <p className="text-[15px] text-white/75">
            {row.check!.status === 'skipped' ? 'Skipped' : 'Done'} by {who(row.check!.done_by)} at {clock(row.check!.done_at)}
            {row.check!.note ? ` — “${row.check!.note}”` : ''}
          </p>
          {row.check!.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.check!.photo_url} alt="" className="mt-3 max-h-64 rounded-xl object-cover" />
          )}
          <button onClick={() => onMark('undo')} className={`${ghostBtn} mt-4 w-full`}>
            <Undo2 size={16} /> Undo
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — e.g. “low on chlorine tabs”"
            rows={2}
            style={FIELD}
            className={fieldCls}
          />
          <PhotoPicker value={photo} onChange={setPhoto} />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={() => onMark('done', { note, photo })} className={primaryBtn}>
              <Check size={16} /> Done
            </button>
            <button onClick={() => onMark('skipped', { note, photo })} className={ghostBtn}>
              <SkipForward size={16} /> Skip today
            </button>
          </div>
          <p className="text-[12.5px] text-white/40">Skip is for days it can’t or shouldn’t be done — rain, a closure. It won’t count as missed.</p>
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Tasks */

function TaskCard({ task, today, who, onOpen }: { task: Task; today: string; who: (id: string | null) => string; onOpen: (t: Task) => void }) {
  const overdue = isOverdue(task, today);
  return (
    <li>
      <button
        onClick={() => onOpen(task)}
        className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${overdue ? 'border-red-400/35 bg-red-500/[0.06]' : 'border-white/10 bg-[#002838]'} active:bg-white/5`}
      >
        {task.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={task.photo_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <PriorityPill p={task.priority} />
            {task.status === 'in_progress' && <Pill tone="amber">In progress</Pill>}
            {overdue && <Pill tone="red">Overdue {daysBetween(task.due_date as string, today)}d</Pill>}
            {!overdue && task.due_date && <Pill>Due {task.due_date === today ? 'today' : shortDate(task.due_date)}</Pill>}
          </span>
          <span className="mt-1 block text-[15.5px] text-white">{task.title}</span>
          <span className="block text-[12.5px] text-white/45">
            {[task.location, DEPARTMENT_LABEL[task.department], `posted by ${who(task.created_by)}`].filter(Boolean).join(' · ')}
          </span>
        </span>
        <ChevronRight size={18} className="mt-1 shrink-0 text-white/30" />
      </button>
    </li>
  );
}

function TasksTab({
  board,
  who,
  onOpen,
  onReport,
}: {
  board: Board;
  who: (id: string | null) => string;
  onOpen: (t: Task) => void;
  onReport: () => void;
}) {
  const [view, setView] = useState<'open' | 'done'>('open');
  const [dept, setDept] = useState<Department | 'all'>('all');
  const [doneList, setDoneList] = useState<Task[] | null>(null);
  const [doneNames, setDoneNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (view !== 'done') return;
    void api<{ tasks: Task[]; names: Record<string, string> }>('GET', '/api/maintenance/tasks?status=done').then((j) => {
      setDoneList(j.tasks);
      setDoneNames(j.names);
    });
  }, [view]);

  const list = (view === 'open' ? board.tasks : doneList ?? []).filter((t) => dept === 'all' || t.department === dept);

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        {(['open', 'done'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`min-h-[40px] rounded-full border px-4 text-[14px] ${view === v ? 'border-transparent text-[#1a1200]' : 'border-white/15 text-white/70'}`}
            style={view === v ? { background: ACCENT } : undefined}
          >
            {v === 'open' ? `Open (${board.tasks.length})` : 'Done'}
          </button>
        ))}
        <select value={dept} onChange={(e) => setDept(e.target.value as Department | 'all')} style={FIELD} className="min-h-[40px] rounded-full border border-white/15 px-3 text-[14px]">
          <option value="all">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABEL[d]}
            </option>
          ))}
        </select>
      </div>

      {view === 'done' && !doneList ? (
        <p className="mt-6 text-white/50">Loading…</p>
      ) : list.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-[#002838] p-5 text-[15px] text-white/60">
          {view === 'open' ? (
            <>
              No open work orders. Anyone on staff can{' '}
              <button onClick={onReport} className="underline" style={{ color: ACCENT }}>
                report a problem
              </button>
              .
            </>
          ) : (
            'Nothing finished in the last 30 days.'
          )}
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {list.map((t) =>
            view === 'open' ? (
              <TaskCard key={t.id} task={t} today={board.today} who={who} onOpen={onOpen} />
            ) : (
              <li key={t.id}>
                <button onClick={() => onOpen(t)} className="w-full rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-left">
                  <span className="block text-[15px] text-white/75">
                    {t.status === 'cancelled' ? '✕' : '✓'} {t.title}
                  </span>
                  <span className="block text-[12.5px] text-white/40">
                    {t.status === 'cancelled' ? 'Cancelled' : `Done by ${doneNames[t.completed_by ?? ''] || who(t.completed_by)}`}
                    {t.completed_at ? ` · ${new Date(t.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                    {t.completion_note ? ` — “${t.completion_note}”` : ''}
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function ReportSheet({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [department, setDepartment] = useState<Department>('other');
  const [priority, setPriority] = useState<Priority>('normal');
  const [due, setDue] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const post = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('POST', '/api/maintenance/tasks', {
        title,
        location,
        department,
        priority,
        due_date: due || null,
        description,
        photo_path: photo?.path,
      });
      onPosted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title="Report a problem" onClose={onClose}>
      <div className="space-y-3">
        <PhotoPicker value={photo} onChange={setPhoto} label="Take a photo of it" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing? e.g. Court 4 net torn" style={FIELD} className={fieldCls} autoFocus />
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where? e.g. Court 4" style={FIELD} className={fieldCls} />
        <select value={department} onChange={(e) => setDepartment(e.target.value as Department)} style={FIELD} className={fieldCls}>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABEL[d]}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-4 gap-1.5">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={`min-h-[44px] rounded-xl border text-[13px] font-medium ${priority === p ? 'border-transparent text-[#1a1200]' : 'border-white/15 text-white/70'}`}
              style={priority === p ? { background: p === 'urgent' ? '#f87171' : ACCENT } : undefined}
            >
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
        <label className="block text-[13px] text-white/50">
          Due by (optional)
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={FIELD} className={`${fieldCls} mt-1`} />
        </label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything else the crew should know (optional)" rows={3} style={FIELD} className={fieldCls} />
        {err && <p className="text-[14px] text-red-300">{err}</p>}
        <button onClick={post} disabled={busy || !title.trim()} className={`${primaryBtn} w-full`}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Post it
        </button>
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------------- Projects */

function ProjectsTab({ board, canManage, onChanged }: { board: Board; canManage: boolean; onChanged: () => Promise<void> }) {
  const [all, setAll] = useState<(ProjectSummary & { pastTarget: boolean })[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const j = await api<{ projects: (ProjectSummary & { pastTarget: boolean })[] }>('GET', '/api/maintenance/projects');
    setAll(j.projects);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const summaries = new Map(board.projects.map((p) => [p.id, p]));
  const list = all ?? [];
  const active = list.filter((p) => p.status !== 'done');
  const finished = list.filter((p) => p.status === 'done');

  return (
    <div className="mt-5">
      {canManage && (
        <button onClick={() => setCreating(true)} className={primaryBtn}>
          <Plus size={16} /> New project
        </button>
      )}
      {!all ? (
        <p className="mt-6 text-white/50">Loading…</p>
      ) : list.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-white/10 bg-[#002838] p-5 text-[15px] text-white/60">
          Track the big jobs — resurfacing courts, repainting the pool deck — with steps and progress.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {[...active, ...finished].map((p) => {
            const s = summaries.get(p.id);
            return (
              <li key={p.id}>
                <Link href={`/maintenance/projects/${p.id}`} className="block rounded-2xl border border-white/10 bg-[#002838] p-4 active:bg-white/5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={p.status === 'active' ? 'amber' : p.status === 'done' ? 'green' : 'muted'}>
                      {p.status === 'on_hold' ? 'On hold' : p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                    </Pill>
                    <Pill>{DEPARTMENT_LABEL[p.department]}</Pill>
                    {p.pastTarget && <Pill tone="red">Past target</Pill>}
                    {s?.stalled && <Pill tone="amber">No activity in 14 days</Pill>}
                  </div>
                  <p className="mt-1.5 text-[16px] text-white">{p.title}</p>
                  {p.pct != null ? (
                    <div className="mt-2">
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: ACCENT }} />
                      </div>
                      <p className="mt-1 text-[12.5px] text-white/50">
                        {p.pct}% done{p.next ? ` · next: ${p.next}` : ''}
                        {p.target_date ? ` · target ${shortDate(p.target_date)}` : ''}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-[12.5px] text-white/45">
                      Add steps to track progress{p.target_date ? ` · target ${shortDate(p.target_date)}` : ''}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {creating && (
        <NewProjectSheet
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function NewProjectSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState<Department>('tennis');
  const [location, setLocation] = useState('');
  const [target, setTarget] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('POST', '/api/maintenance/projects', {
        title,
        department,
        location,
        target_date: target || null,
        description,
        status: 'active',
        steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title="New project" onClose={onClose}>
      <div className="space-y-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Resurface courts 7–8" style={FIELD} className={fieldCls} autoFocus />
        <div className="grid grid-cols-2 gap-2">
          <select value={department} onChange={(e) => setDepartment(e.target.value as Department)} style={FIELD} className={fieldCls}>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {DEPARTMENT_LABEL[d]}
              </option>
            ))}
          </select>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where" style={FIELD} className={fieldCls} />
        </div>
        <label className="block text-[13px] text-white/50">
          Target date (optional)
          <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} style={FIELD} className={`${fieldCls} mt-1`} />
        </label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the job? (optional)" rows={3} style={FIELD} className={fieldCls} />
        <textarea value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'Steps, one per line (optional)\nGet three quotes\nBook the contractor\nClose courts 7–8'} rows={4} style={FIELD} className={fieldCls} />
        {err && <p className="text-[14px] text-red-300">{err}</p>}
        <button onClick={create} disabled={busy || !title.trim()} className={`${primaryBtn} w-full`}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create project
        </button>
      </div>
    </Sheet>
  );
}
