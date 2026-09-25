'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, List, CalendarDays, AlertTriangle, Mail, MapPin } from 'lucide-react';
import type { AgendaItem, AgendaKind } from '@/lib/member/myTennis';

/**
 * The member's "Coming up": one list of everything they're in, or a month grid
 * (Vi Le asked for both — "my brain needs the visual break", while others
 * scan a list). Overlaps are flagged, since catching a double booking across
 * leagues is the reason this exists.
 */

const KIND: Record<AgendaKind, { label: string; color: string; bg: string }> = {
  match: { label: 'Match', color: '#0e7490', bg: '#ecfeff' },
  game: { label: 'Game', color: '#047857', bg: '#ecfdf5' },
  event: { label: 'Event', color: '#b45309', bg: '#fffbeb' },
  lesson: { label: 'Lesson', color: '#6d28d9', bg: '#f5f3ff' },
  court: { label: 'Court', color: '#1d4ed8', bg: '#eff6ff' },
  signup: { label: 'Clinic', color: '#be185d', bg: '#fdf2f8' },
};

const TONE: Record<string, string> = {
  yes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  maybe: 'bg-amber-50 text-amber-800 border-amber-200',
  ask: 'bg-rose-50 text-rose-700 border-rose-200',
  wait: 'bg-slate-100 text-slate-700 border-slate-200',
};

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const minutes = (at: string) => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));

function timeLabel(it: AgendaItem): string {
  if (it.allDay) return 'All day';
  const t = (at: string) => {
    const h = Number(at.slice(11, 13));
    const m = at.slice(14, 16);
    return `${h % 12 === 0 ? 12 : h % 12}${m === '00' ? '' : `:${m}`}${h >= 12 ? 'pm' : 'am'}`;
  };
  return it.end && it.end.slice(0, 10) === it.at.slice(0, 10) ? `${t(it.at)}–${t(it.end)}` : t(it.at);
}

function dayHeading(day: string, today: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const [ty, tm, td] = today.split('-').map(Number);
  const diff = Math.round((dt.getTime() - Date.UTC(ty, tm - 1, td)) / 864e5);
  const base = `${DOW[dt.getUTCDay()]}, ${MONTHS[m - 1].slice(0, 3)} ${d}`;
  return diff === 0 ? `Today · ${base}` : diff === 1 ? `Tomorrow · ${base}` : base;
}

/** Items that overlap another on the same day. Unknown ends count as 2 hours. */
function findConflicts(items: AgendaItem[]): Map<string, string> {
  const out = new Map<string, string>();
  const byDay = new Map<string, AgendaItem[]>();
  for (const it of items) {
    if (it.allDay) continue;
    const d = it.at.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) || []), it]);
  }
  for (const list of byDay.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const aS = minutes(a.at), aE = a.end ? minutes(a.end) : aS + 120;
        const bS = minutes(b.at), bE = b.end ? minutes(b.end) : bS + 120;
        if (aS < bE && bS < aE) {
          if (!out.has(a.id)) out.set(a.id, b.title);
          if (!out.has(b.id)) out.set(b.id, a.title);
        }
      }
    }
  }
  return out;
}

export default function MyTennisAgenda({ items, today }: { items: AgendaItem[]; today: string }) {
  const [view, setView] = useState<'list' | 'month'>('list');
  const [showAll, setShowAll] = useState(false);
  const [month, setMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const [picked, setPicked] = useState<string | null>(null);
  const conflicts = useMemo(() => findConflicts(items), [items]);

  const byDay = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const it of items) {
      const d = it.at.slice(0, 10);
      m.set(d, [...(m.get(d) || []), it]);
    }
    return m;
  }, [items]);

  const days = [...byDay.keys()].sort();
  const listDays = showAll ? days : days.slice(0, 8);

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <CalendarDays className="w-6 h-6 text-cyan-600" /> Coming up
        </h2>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
          {(['list', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium ${view === v ? 'bg-cyan-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {v === 'list' ? <List className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
              {v === 'list' ? 'List' : 'Month'}
            </button>
          ))}
        </div>
      </div>

      {conflicts.size > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm">
            Some of your plans overlap. They&apos;re marked below so you can sort them out before match day.
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-600">
          <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="font-medium text-slate-800">Nothing on your calendar yet.</p>
          <p className="text-sm mt-1">
            Team matches, games you join, lessons, courts and club events you sign up for all show up here.
          </p>
        </div>
      ) : view === 'list' ? (
        <div className="space-y-5">
          {listDays.map((d) => (
            <div key={d}>
              <div className="text-sm font-semibold text-slate-500 mb-2">{dayHeading(d, today)}</div>
              <div className="space-y-2">
                {byDay.get(d)!.map((it) => (
                  <Card key={it.id} it={it} conflict={conflicts.get(it.id)} />
                ))}
              </div>
            </div>
          ))}
          {days.length > listDays.length && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full rounded-xl border border-slate-200 bg-white py-3 font-medium text-cyan-700 hover:bg-slate-50"
            >
              Show {days.length - listDays.length} more day{days.length - listDays.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      ) : (
        <MonthGrid
          month={month}
          setMonth={(m) => {
            setMonth(m);
            setPicked(null);
          }}
          today={today}
          byDay={byDay}
          conflicts={conflicts}
          picked={picked}
          setPicked={setPicked}
        />
      )}
    </section>
  );
}

function Card({ it, conflict }: { it: AgendaItem; conflict?: string }) {
  const k = KIND[it.kind];
  return (
    <div className={`rounded-2xl border bg-white p-4 ${conflict ? 'border-amber-400' : 'border-slate-200'}`}>
      <div className="flex items-start gap-3">
        <div className="w-20 shrink-0 text-sm font-semibold text-slate-700 pt-0.5">{timeLabel(it)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: k.color, background: k.bg }}>
              {it.source}
            </span>
            {it.status && (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[it.tone || 'wait']}`}>
                {it.status}
              </span>
            )}
          </div>
          <div className="mt-1 font-semibold text-slate-900">{it.title}</div>
          {it.where && (
            <div className="mt-0.5 flex items-center gap-1 text-sm text-slate-500">
              <MapPin className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{it.where}</span>
            </div>
          )}
          {conflict && (
            <div className="mt-1 flex items-center gap-1 text-sm font-medium text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5" /> Overlaps with {conflict}
            </div>
          )}
          {(it.href || it.contact) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {it.href && (
                <Link
                  href={it.href}
                  className="inline-flex min-h-[40px] items-center rounded-lg border border-cyan-600 px-3 text-sm font-semibold text-cyan-700 hover:bg-cyan-50"
                >
                  {it.cta || 'Open'}
                </Link>
              )}
              {it.contact && (
                <a
                  href={it.contact.href}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Mail className="w-4 h-4" /> {it.contact.label}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  month, setMonth, today, byDay, conflicts, picked, setPicked,
}: {
  month: string;
  setMonth: (m: string) => void;
  today: string;
  byDay: Map<string, AgendaItem[]>;
  conflicts: Map<string, string>;
  picked: string | null;
  setPicked: (d: string | null) => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array(first).fill(null),
    ...Array.from({ length: len }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const pickedItems = picked ? byDay.get(picked) || [] : [];

  return (
    <div>
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => shift(-1)} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Previous month">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="font-semibold">{MONTHS[m - 1]} {y}</div>
          <button onClick={() => shift(1)} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Next month">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-xs font-medium text-slate-400 mb-1">
          {DOW.map((d) => <div key={d}>{d.slice(0, 2)}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const its = byDay.get(d) || [];
            const clash = its.some((x) => conflicts.has(x.id));
            return (
              <button
                key={d}
                onClick={() => setPicked(d === picked ? null : d)}
                className={`min-h-[64px] rounded-lg border p-1 text-left align-top ${
                  d === picked ? 'border-cyan-600 ring-1 ring-cyan-600' : clash ? 'border-amber-400' : 'border-slate-100'
                } ${d < today ? 'opacity-50' : ''} hover:border-cyan-400`}
              >
                <div className={`text-xs font-semibold ${d === today ? 'text-white bg-cyan-600 rounded-full w-5 h-5 grid place-items-center' : 'text-slate-600'}`}>
                  {Number(d.slice(8))}
                </div>
                <div className="mt-0.5 space-y-0.5">
                  {its.slice(0, 2).map((x) => (
                    <div
                      key={x.id}
                      className="truncate rounded px-1 text-[10px] font-medium leading-4"
                      style={{ color: KIND[x.kind].color, background: KIND[x.kind].bg }}
                    >
                      {x.title}
                    </div>
                  ))}
                  {its.length > 2 && <div className="text-[10px] text-slate-500 px-1">+{its.length - 2} more</div>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {picked && (
        <div className="mt-4">
          <div className="text-sm font-semibold text-slate-500 mb-2">{dayHeading(picked, today)}</div>
          {pickedItems.length ? (
            <div className="space-y-2">
              {pickedItems.map((it) => <Card key={it.id} it={it} conflict={conflicts.get(it.id)} />)}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nothing that day.</p>
          )}
        </div>
      )}
    </div>
  );
}
