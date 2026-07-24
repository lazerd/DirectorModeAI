'use client';

import { AlertTriangle, CheckCircle2, Trophy, Bell, GripVertical } from 'lucide-react';

// The whole year on one page.
//
// A club runs 10-20 events a year. Rendering that as twelve month grids means
// scrolling past a great deal of empty space to see a list you could have read
// at a glance — the calendar metaphor is wrong for this. So: one dense list,
// date-ordered, thin month rules for orientation, and the conflicts the
// planner knows about surfaced inline against the row they affect.
//
// Rows are draggable onto a different month heading, which is the only
// rescheduling gesture that still makes sense without a grid; everything finer
// happens in the drawer, where the date suggestions live.

export type ListItem = {
  id: string;
  title: string;
  department: string;
  audience: string[] | null;
  status: string;
  target_date: string | null;
  target_end_date: string | null;
  start_time: string | null;
  expected_attendance: number | null;
  expected_revenue_cents: number | null;
  score: number | null;
  score_breakdown: { reasons?: Array<{ code?: string; points?: number; detail: string }> } | null;
  event_id: string | null;
  reminder_cadence?: unknown[] | null;
};

export type ListConstraint = {
  id: string;
  title: string;
  starts_on: string;
  ends_on: string;
  impact: 'blocking' | 'heavy' | 'light' | 'favorable';
};

const DEPT_COLOR: Record<string, string> = {
  tennis: '#eab308', pickleball: '#22d3ee', swim: '#38bdf8',
  fitness: '#a78bfa', social: '#fb923c', other: '#94a3b8',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function EventList({
  items, constraints, onOpen, onMoveToMonth, busyId,
}: {
  items: ListItem[];
  constraints: ListConstraint[];
  onOpen: (i: ListItem) => void;
  onMoveToMonth: (itemId: string, month: number) => void;
  busyId: string | null;
}) {
  const dated = items
    .filter((i) => i.target_date && i.status !== 'dropped')
    .sort((a, b) => (a.target_date! < b.target_date! ? -1 : 1));
  const undated = items.filter((i) => !i.target_date && i.status !== 'dropped');

  // Which months actually have something. Empty months still get a thin line,
  // because a gap in the year is information a director wants to see.
  const byMonth = new Map<number, ListItem[]>();
  for (const i of dated) {
    const m = Number(i.target_date!.slice(5, 7));
    const arr = byMonth.get(m);
    if (arr) arr.push(i); else byMonth.set(m, [i]);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pb-24">
      {undated.length > 0 && (
        <div className="mb-4 rounded-xl border p-3" style={{ background: '#002838', borderColor: '#3a2a12' }}>
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: '#fcd34d' }}>
            No date yet
          </div>
          <div className="space-y-1">
            {undated.map((i) => (
              <Row key={i.id} item={i} conflicts={[]} onOpen={onOpen} busy={busyId === i.id} />
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ background: '#002838', borderColor: '#0d3d4d' }}>
        {MONTHS.map((name, idx) => {
          const month = idx + 1;
          const rows = byMonth.get(month) ?? [];
          return (
            <div key={name}
                 onDragOver={(e) => e.preventDefault()}
                 onDrop={(e) => {
                   const id = e.dataTransfer.getData('text/plain');
                   if (id) onMoveToMonth(id, month);
                 }}>
              <div className="flex items-center gap-3 px-3 py-1.5 sticky top-[104px] z-10"
                   style={{ background: '#00202c', borderTop: '1px solid #0d3d4d' }}>
                <span className="text-[11px] uppercase tracking-widest font-semibold"
                      style={{ color: rows.length ? '#7f9aa5' : '#4a6a76' }}>
                  {name}
                </span>
                {rows.length === 0 && (
                  <span className="text-[11px]" style={{ color: '#4a6a76' }}>— nothing planned</span>
                )}
                <span className="ml-auto text-[11px]" style={{ color: '#4a6a76' }}>
                  {rows.length > 0 ? `${rows.length}` : ''}
                </span>
              </div>

              {rows.map((i) => (
                <Row key={i.id} item={i}
                     conflicts={conflictsFor(i, constraints)}
                     onOpen={onOpen}
                     busy={busyId === i.id} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({
  item, conflicts, onOpen, busy,
}: {
  item: ListItem;
  conflicts: ListConstraint[];
  onOpen: (i: ListItem) => void;
  busy: boolean;
}) {
  const color = DEPT_COLOR[item.department] ?? DEPT_COLOR.other;
  const blocking = conflicts.find((c) => c.impact === 'blocking');
  const heavy = conflicts.find((c) => c.impact === 'heavy');
  const favorable = conflicts.find((c) => c.impact === 'favorable');
  const why = item.score_breakdown?.reasons?.[0]?.detail;
  const reminders = Array.isArray(item.reminder_cadence) ? item.reminder_cadence.length : 0;

  return (
    <button
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', item.id)}
      onClick={() => onOpen(item)}
      className="w-full text-left flex items-start gap-3 px-3 py-2 border-t hover:brightness-125 transition"
      style={{ borderColor: '#08303d', opacity: busy ? 0.5 : 1 }}
    >
      <GripVertical className="w-3.5 h-3.5 mt-1 shrink-0 opacity-20" />

      <span className="text-xs tabular-nums shrink-0 w-[86px] pt-0.5" style={{ color: '#9fc0cb' }}>
        {item.target_date ? dayLabel(item.target_date) : '—'}
        {item.target_end_date && item.target_end_date !== item.target_date && (
          <span className="opacity-50">–{Number(item.target_end_date.slice(8, 10))}</span>
        )}
      </span>

      <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: color }} />

      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{item.title}</span>
          {item.event_id && (
            <Trophy className="w-3 h-3 opacity-60" aria-label="Promoted to a live event" />
          )}
          {reminders > 0 && (
            <span className="text-[10px] flex items-center gap-0.5 opacity-50">
              <Bell className="w-2.5 h-2.5" />{reminders}
            </span>
          )}
          {item.start_time && (
            <span className="text-[11px] opacity-40">{time12(item.start_time)}</span>
          )}
        </span>

        <span className="block text-[11px] opacity-50 truncate">
          {[item.department, ...(item.audience ?? [])].filter(Boolean).join(' · ')}
          {item.expected_attendance ? ` · ${item.expected_attendance} expected` : ''}
        </span>

        {blocking ? (
          <span className="flex items-center gap-1 text-[11px] mt-0.5" style={{ color: '#fca5a5' }}>
            <AlertTriangle className="w-3 h-3 shrink-0" /> Clashes with {blocking.title}
          </span>
        ) : heavy ? (
          <span className="flex items-center gap-1 text-[11px] mt-0.5" style={{ color: '#fcd34d' }}>
            <AlertTriangle className="w-3 h-3 shrink-0" /> {heavy.title} is on
          </span>
        ) : favorable ? (
          <span className="flex items-center gap-1 text-[11px] mt-0.5" style={{ color: '#86efac' }}>
            <CheckCircle2 className="w-3 h-3 shrink-0" /> {favorable.title}
          </span>
        ) : why ? (
          <span className="block text-[11px] opacity-40 truncate mt-0.5">{why}</span>
        ) : null}
      </span>

      {item.expected_revenue_cents ? (
        <span className="text-[11px] tabular-nums shrink-0 pt-0.5" style={{ color: '#86efac' }}>
          ${Math.round(item.expected_revenue_cents / 100).toLocaleString()}
        </span>
      ) : null}
    </button>
  );
}

function conflictsFor(item: ListItem, constraints: ListConstraint[]): ListConstraint[] {
  if (!item.target_date) return [];
  const start = item.target_date;
  const end = item.target_end_date && item.target_end_date > start ? item.target_end_date : start;
  return constraints.filter((c) => c.starts_on <= end && start <= c.ends_on);
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]} ${MON[m - 1]} ${d}`;
}

function time12(t: string): string {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}
