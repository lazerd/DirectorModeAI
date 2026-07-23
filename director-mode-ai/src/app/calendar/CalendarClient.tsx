'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays, Sparkles, Plus, Upload, FileText, Loader2, X, Trophy, Users,
  AlertTriangle, CheckCircle2, ExternalLink, Trash2, Megaphone, LandPlot, Globe,
} from 'lucide-react';

// The year grid — CalendarMode's daily-driver surface.
//
// Twelve month blocks, each a row of weekend cells. Events sit in the cell for
// their weekend; conflicts shade it. Dragging an event to another weekend
// re-scores it against the whole calendar and shows what changed, which is the
// interaction the whole product is really about: a director asking "what if we
// moved it?" and getting a real answer instead of a shrug.

type Item = {
  id: string;
  title: string;
  catalog_key: string | null;
  description: string | null;
  department: string;
  audience: string[] | null;
  status: string;
  target_date: string | null;
  target_end_date: string | null;
  start_time: string | null;
  duration_minutes: number | null;
  courts_needed: number | null;
  staff_needed: number | null;
  expected_attendance: number | null;
  entry_fee_cents: number | null;
  expected_revenue_cents: number | null;
  score: number | null;
  score_breakdown: { reasons?: Array<{ code?: string; points?: number; detail: string }> } | null;
  marketing: Record<string, any> | null;
  event_id: string | null;
  notes: string | null;
};

type Constraint = {
  id: string;
  source: string;
  title: string;
  starts_on: string;
  ends_on: string;
  impact: 'blocking' | 'heavy' | 'light' | 'favorable';
  audience_tags: string[] | null;
};

type Plan = {
  id: string; year: number; name: string; status: string;
  goals: Record<string, any> | null;
  season_windows: any[] | null;
};

type Summary = {
  total: number; byMonth: number[]; byDepartment: Record<string, number>;
  projectedRevenueCents: number; flagshipCount: number; emptyMonths: number[]; crowdedWeeks: number;
};

const DEPT_COLOR: Record<string, string> = {
  tennis: '#eab308',
  pickleball: '#22d3ee',
  swim: '#38bdf8',
  fitness: '#a78bfa',
  social: '#fb923c',
  other: '#94a3b8',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function CalendarClient() {
  const [year, setYear] = useState<number>(() => new Date().getFullYear() + 1);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [club, setClub] = useState<{ name: string; slug: string } | null>(null);
  const [isPro, setIsPro] = useState(true);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);

  // ---- load ----
  const load = useCallback(async (y: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendar/plan?year=${y}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load the calendar.');
      setPlan(json.plan);
      setItems(json.items ?? []);
      setConstraints(json.constraints ?? []);
      setSummary(json.summary ?? null);
      setClub(json.club ?? null);
      setIsPro(json.isPro !== false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(year); }, [year, load]);

  // ---- weekend cells for the year ----
  const weekends = useMemo(() => buildWeekends(year), [year]);

  const itemsByDate = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) {
      if (!i.target_date || i.status === 'dropped') continue;
      const arr = m.get(i.target_date);
      if (arr) arr.push(i); else m.set(i.target_date, [i]);
    }
    return m;
  }, [items]);

  const unscheduled = useMemo(
    () => items.filter((i) => !i.target_date && i.status !== 'dropped'),
    [items],
  );

  const constraintsByDate = useMemo(() => {
    const m = new Map<string, Constraint[]>();
    for (const c of constraints) {
      for (const d of eachDay(c.starts_on, c.ends_on, 400)) {
        const arr = m.get(d);
        if (arr) arr.push(c); else m.set(d, [c]);
      }
    }
    return m;
  }, [constraints]);

  // ---- actions ----
  async function moveItem(itemId: string, date: string | null) {
    setBusy(itemId);
    const prev = items;
    // Optimistic: the grid should feel like dragging paper, not filing a form.
    setItems((cur) => cur.map((i) => (i.id === itemId ? { ...i, target_date: date, score: null, score_breakdown: null } : i)));
    try {
      const res = await fetch(`/api/calendar/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_date: date }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      // Re-score so the drawer can immediately answer "why here?".
      if (date && plan) {
        const r = await fetch('/api/calendar/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: plan.id, itemId, date }),
        });
        const rj = await r.json();
        if (r.ok && rj.scored) {
          await fetch(`/api/calendar/items/${itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_date: date }),
          });
          setItems((cur) => cur.map((i) => (i.id === itemId
            ? { ...i, score: rj.scored.score, score_breakdown: { reasons: rj.scored.reasons } }
            : i)));
          setSelected((s) => (s?.id === itemId
            ? { ...s, target_date: date, score: rj.scored.score, score_breakdown: { reasons: rj.scored.reasons } }
            : s));
        }
      }
    } catch (e: any) {
      setItems(prev);
      setError(e.message || 'Could not move that event.');
    } finally {
      setBusy(null);
    }
  }

  async function removeItem(itemId: string) {
    setBusy(itemId);
    try {
      const res = await fetch(`/api/calendar/items/${itemId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      setItems((cur) => cur.filter((i) => i.id !== itemId));
      setSelected(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function publish(next: 'published' | 'draft') {
    if (!plan) return;
    setBusy('publish');
    try {
      const res = await fetch('/api/calendar/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id, status: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setPlan((p) => (p ? { ...p, status: next } : p));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  // ---- render ----
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#001820' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#D3FB52' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#001820', color: '#e6f0f3' }}>
      {/* header */}
      <div className="sticky top-0 z-20 border-b" style={{ background: '#001820e6', backdropFilter: 'blur(8px)', borderColor: '#0d3d4d' }}>
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 mr-auto">
              <CalendarDays className="w-5 h-5" style={{ color: '#c084fc' }} />
              <h1 className="text-lg font-semibold">CalendarMode</h1>
              {club && <span className="text-sm opacity-60 hidden sm:inline">· {club.name}</span>}
              {plan?.status === 'published' && (
                <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{ background: '#14532d', color: '#86efac' }}>
                  Published
                </span>
              )}
            </div>

            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="px-2 py-1.5 rounded-lg text-sm border"
              style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }}
            >
              {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
            </select>

            <button
              onClick={() => setBuildOpen(true)}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5"
              style={{ background: '#D3FB52', color: '#001820' }}
            >
              <Sparkles className="w-4 h-4" /> Build my year
            </button>

            <Link href="/calendar/ideas" className="px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1.5"
                  style={{ borderColor: '#0d3d4d', color: '#e6f0f3' }}>
              <Plus className="w-4 h-4" /> Ideas
            </Link>
            <Link href="/calendar/import" className="px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1.5"
                  style={{ borderColor: '#0d3d4d', color: '#e6f0f3' }}>
              <Upload className="w-4 h-4" /> Import
            </Link>
            <Link href={`/calendar/board?year=${year}`} className="px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1.5"
                  style={{ borderColor: '#0d3d4d', color: '#e6f0f3' }}>
              <FileText className="w-4 h-4" /> Board packet
            </Link>

            {plan?.status === 'published' ? (
              <button onClick={() => publish('draft')} disabled={busy === 'publish'}
                      className="px-3 py-1.5 rounded-lg text-sm border" style={{ borderColor: '#0d3d4d' }}>
                Unpublish
              </button>
            ) : (
              <button onClick={() => publish('published')} disabled={busy === 'publish'}
                      className="px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1.5"
                      style={{ borderColor: '#c084fc', color: '#c084fc' }}>
                <Globe className="w-4 h-4" /> Publish to members
              </button>
            )}
          </div>

          {summary && <SummaryBar summary={summary} constraints={constraints.length} />}
        </div>
      </div>

      {error && (
        <div className="max-w-[1600px] mx-auto px-4 pt-3">
          <div className="px-3 py-2 rounded-lg text-sm flex items-center justify-between"
               style={{ background: '#4c1d1d', color: '#fecaca' }}>
            {error}
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {!isPro && (
        <div className="max-w-[1600px] mx-auto px-4 pt-3">
          <div className="px-3 py-2 rounded-lg text-sm" style={{ background: '#3b2f0b', color: '#fde68a' }}>
            CalendarMode planning is a Pro feature. You can browse event ideas for free —{' '}
            <Link href="/pricing" className="underline">see plans</Link>.
          </div>
        </div>
      )}

      {/* unscheduled tray */}
      {unscheduled.length > 0 && (
        <div className="max-w-[1600px] mx-auto px-4 pt-4">
          <div className="rounded-xl border p-3" style={{ background: '#002838', borderColor: '#0d3d4d' }}>
            <div className="text-xs uppercase tracking-wide opacity-60 mb-2">
              Not yet scheduled — drag onto a weekend
            </div>
            <div className="flex flex-wrap gap-2">
              {unscheduled.map((i) => (
                <EventChip key={i.id} item={i} onOpen={() => setSelected(i)}
                           onDragStart={() => setDragging(i.id)} onDragEnd={() => setDragging(null)} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* the year */}
      <div className="max-w-[1600px] mx-auto px-4 pt-4 space-y-4">
        {MONTHS.map((name, mi) => {
          const monthWeekends = weekends.filter((w) => Number(w.saturday.slice(5, 7)) === mi + 1);
          const count = summary?.byMonth[mi] ?? 0;
          return (
            <section key={name} className="rounded-xl border overflow-hidden"
                     style={{ background: '#002838', borderColor: '#0d3d4d' }}>
              <div className="px-4 py-2 flex items-center gap-3 border-b" style={{ borderColor: '#0d3d4d' }}>
                <h2 className="font-semibold">{name}</h2>
                <span className="text-xs opacity-50">
                  {count === 0 ? 'nothing planned' : `${count} event${count === 1 ? '' : 's'}`}
                </span>
              </div>
              <div className="grid gap-px p-px"
                   style={{ gridTemplateColumns: `repeat(${Math.max(monthWeekends.length, 1)}, minmax(150px, 1fr))`, background: '#0d3d4d' }}>
                {monthWeekends.map((w) => (
                  <WeekendCell
                    key={w.saturday}
                    weekend={w}
                    items={w.days.flatMap((d) => itemsByDate.get(d) ?? [])}
                    constraints={dedupe(w.days.flatMap((d) => constraintsByDate.get(d) ?? []))}
                    dragging={dragging}
                    onOpen={setSelected}
                    onDragStart={setDragging}
                    onDragEnd={() => setDragging(null)}
                    onDrop={(date) => { if (dragging) moveItem(dragging, date); setDragging(null); }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {selected && (
        <ItemDrawer
          item={selected}
          planId={plan?.id ?? ''}
          onClose={() => setSelected(null)}
          onChange={(next) => {
            setItems((cur) => cur.map((i) => (i.id === next.id ? next : i)));
            setSelected(next);
          }}
          onRemove={() => removeItem(selected.id)}
          onUnschedule={() => moveItem(selected.id, null)}
          busy={busy === selected.id}
        />
      )}

      {buildOpen && plan && (
        <BuildDialog
          planId={plan.id}
          year={year}
          onClose={() => setBuildOpen(false)}
          onDone={() => { setBuildOpen(false); load(year); }}
        />
      )}
    </div>
  );
}

// ============================================================
// Pieces
// ============================================================

function SummaryBar({ summary, constraints }: { summary: Summary; constraints: number }) {
  const stat = (label: string, value: string, tone?: string) => (
    <div className="flex items-baseline gap-1.5">
      <span className="font-semibold" style={{ color: tone ?? '#e6f0f3' }}>{value}</span>
      <span className="opacity-50">{label}</span>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs mt-2">
      {stat('events', String(summary.total))}
      {stat('flagship', String(summary.flagshipCount))}
      {stat('projected', `$${Math.round(summary.projectedRevenueCents / 100).toLocaleString()}`, '#86efac')}
      {stat('conflicts tracked', String(constraints))}
      {summary.emptyMonths.length > 0 &&
        stat('empty months', summary.emptyMonths.map((m) => MONTHS[m - 1].slice(0, 3)).join(' '), '#fbbf24')}
      {summary.crowdedWeeks > 0 && stat('crowded weekends', String(summary.crowdedWeeks), '#fb923c')}
    </div>
  );
}

function EventChip({
  item, onOpen, onDragStart, onDragEnd,
}: { item: Item; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void }) {
  const color = DEPT_COLOR[item.department] ?? DEPT_COLOR.other;
  return (
    <button
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      title={item.title}
      className="text-left text-xs px-2 py-1 rounded-md border w-full truncate cursor-grab active:cursor-grabbing"
      style={{ borderColor: `${color}55`, background: `${color}14`, color: '#e6f0f3' }}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: color }} />
      {item.title}
      {item.event_id && <Trophy className="w-3 h-3 inline ml-1 opacity-70" />}
    </button>
  );
}

function WeekendCell({
  weekend, items, constraints, dragging, onOpen, onDragStart, onDragEnd, onDrop,
}: {
  weekend: Weekend;
  items: Item[];
  constraints: Constraint[];
  dragging: string | null;
  onOpen: (i: Item) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (date: string) => void;
}) {
  const [over, setOver] = useState(false);
  const blocking = constraints.find((c) => c.impact === 'blocking');
  const heavy = constraints.find((c) => c.impact === 'heavy');
  const favorable = constraints.find((c) => c.impact === 'favorable');

  const shade = blocking ? '#3b1219' : heavy ? '#3a2a12' : favorable ? '#0f2e1d' : '#002838';

  return (
    <div
      onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(weekend.saturday); }}
      className="p-2 min-h-[92px] flex flex-col gap-1.5 transition-colors"
      style={{ background: over ? '#0d3d4d' : shade }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium opacity-70">
          {Number(weekend.saturday.slice(8, 10))}
        </span>
        {weekend.holiday && (
          <span className="text-[10px] px-1 rounded" style={{ background: '#3b2f0b', color: '#fde68a' }}
                title={weekend.holiday}>
            {weekend.holiday.length > 12 ? `${weekend.holiday.slice(0, 11)}…` : weekend.holiday}
          </span>
        )}
      </div>

      {constraints.slice(0, 2).map((c) => (
        <div key={c.id} className="text-[10px] truncate flex items-center gap-1"
             style={{ color: c.impact === 'blocking' ? '#fca5a5' : c.impact === 'favorable' ? '#86efac' : '#fcd34d' }}
             title={`${c.title} (${c.impact})`}>
          {c.impact === 'blocking' ? <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
            : c.impact === 'favorable' ? <CheckCircle2 className="w-2.5 h-2.5 shrink-0" /> : null}
          {c.title}
        </div>
      ))}

      <div className="flex flex-col gap-1 mt-auto">
        {items.map((i) => (
          <EventChip key={i.id} item={i} onOpen={() => onOpen(i)}
                     onDragStart={() => onDragStart(i.id)} onDragEnd={onDragEnd} />
        ))}
      </div>
    </div>
  );
}

function ItemDrawer({
  item, planId, onClose, onChange, onRemove, onUnschedule, busy,
}: {
  item: Item; planId: string; onClose: () => void;
  onChange: (i: Item) => void; onRemove: () => void; onUnschedule: () => void; busy: boolean;
}) {
  const [tab, setTab] = useState<'why' | 'details' | 'promo'>('why');
  const [recs, setRecs] = useState<any[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const color = DEPT_COLOR[item.department] ?? DEPT_COLOR.other;
  const reasons = item.score_breakdown?.reasons ?? [];

  async function suggest() {
    setWorking('suggest');
    try {
      const res = await fetch('/api/calendar/recommend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, itemId: item.id, limit: 5 }),
      });
      const json = await res.json();
      if (res.ok) setRecs(json.recommendations ?? []);
      else setMsg(json.error);
    } finally { setWorking(null); }
  }

  async function promote() {
    setWorking('promote');
    setMsg(null);
    try {
      const res = await fetch('/api/calendar/promote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error); return; }
      onChange({ ...item, event_id: json.event.id, status: 'promoted' });
      setMsg(json.alreadyPromoted ? 'Already promoted — opening it.' : 'Event created.');
      window.open(json.url, '_blank');
    } finally { setWorking(null); }
  }

  async function holdCourts() {
    setWorking('hold');
    setMsg(null);
    try {
      const res = await fetch('/api/calendar/hold', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id }),
      });
      const json = await res.json();
      setMsg(res.ok
        ? json.partial
          ? `Held ${json.held} of ${json.requested} court slots — the rest were already taken.`
          : `Held ${json.held} court slot${json.held === 1 ? '' : 's'} on the sheet.`
        : json.error);
    } finally { setWorking(null); }
  }

  async function writeMarketing() {
    setWorking('marketing');
    setMsg(null);
    try {
      const res = await fetch('/api/calendar/marketing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error); return; }
      onChange({ ...item, marketing: json.marketing });
      setTab('promo');
    } finally { setWorking(null); }
  }

  async function moveTo(date: string) {
    setWorking('move');
    try {
      await fetch(`/api/calendar/items/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_date: date }),
      });
      onChange({ ...item, target_date: date });
      setRecs(null);
    } finally { setWorking(null); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: '#00121899' }} onClick={onClose}>
      <div className="w-full max-w-md h-full overflow-y-auto border-l"
           style={{ background: '#002838', borderColor: '#0d3d4d' }}
           onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 p-4 border-b flex items-start gap-3"
             style={{ background: '#002838', borderColor: '#0d3d4d' }}>
          <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold leading-tight">{item.title}</h3>
            <div className="text-xs opacity-60 mt-0.5">
              {item.target_date ? longDate(item.target_date) : 'Not scheduled'}
              {item.department && ` · ${item.department}`}
              {item.audience?.length ? ` · ${item.audience.join(', ')}` : ''}
            </div>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 opacity-60" /></button>
        </div>

        <div className="flex gap-1 px-4 pt-3 text-sm">
          {(['why', 'details', 'promo'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
                    className="px-3 py-1 rounded-lg capitalize"
                    style={tab === t
                      ? { background: '#0d3d4d', color: '#e6f0f3' }
                      : { color: '#7f9aa5' }}>
              {t === 'why' ? 'Why this date' : t === 'promo' ? 'Marketing' : 'Details'}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          {msg && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: '#0d3d4d', color: '#cde8f0' }}>{msg}</div>
          )}

          {tab === 'why' && (
            <>
              {item.score != null && (
                <div className="text-sm">
                  <span className="opacity-60">Date score</span>{' '}
                  <span className="font-semibold" style={{ color: '#D3FB52' }}>{item.score}</span>
                </div>
              )}
              {reasons.length > 0 ? (
                <ul className="space-y-2">
                  {reasons.map((r, i) => (
                    <li key={i} className="text-sm flex gap-2">
                      <span className="font-mono text-xs shrink-0 w-8 text-right pt-0.5"
                            style={{ color: (r.points ?? 0) > 0 ? '#86efac' : (r.points ?? 0) < 0 ? '#fca5a5' : '#7f9aa5' }}>
                        {r.points != null && r.points !== 0 ? (r.points > 0 ? `+${r.points}` : r.points) : '·'}
                      </span>
                      <span className="opacity-90">{r.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm opacity-60">
                  No scoring yet for this date. Ask for suggestions to see how the weekends compare.
                </p>
              )}

              <button onClick={suggest} disabled={!!working}
                      className="w-full px-3 py-2 rounded-lg text-sm border flex items-center justify-center gap-2"
                      style={{ borderColor: '#0d3d4d' }}>
                {working === 'suggest' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Suggest better dates
              </button>

              {recs && (
                <div className="space-y-2">
                  {recs.map((r) => (
                    <button key={r.date} onClick={() => moveTo(r.date)} disabled={!!working}
                            className="w-full text-left p-2 rounded-lg border"
                            style={{ borderColor: r.date === item.target_date ? '#D3FB52' : '#0d3d4d' }}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{longDate(r.date)}</span>
                        <span style={{ color: r.blocked ? '#fca5a5' : '#D3FB52' }}>
                          {r.blocked ? 'blocked' : r.score}
                        </span>
                      </div>
                      <div className="text-xs opacity-60 mt-0.5">{r.reasons?.[0]?.detail}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'details' && (
            <div className="space-y-2 text-sm">
              {item.description && <p className="opacity-80">{item.description}</p>}
              <Row label="Courts" value={item.courts_needed != null ? String(item.courts_needed) : '—'} />
              <Row label="Staff" value={item.staff_needed != null ? String(item.staff_needed) : '—'} />
              <Row label="Expected" value={item.expected_attendance ? `${item.expected_attendance} players` : '—'} />
              <Row label="Entry fee" value={item.entry_fee_cents ? `$${(item.entry_fee_cents / 100).toFixed(0)}` : 'free'} />
              <Row label="Projected" value={item.expected_revenue_cents ? `$${Math.round(item.expected_revenue_cents / 100).toLocaleString()}` : '—'} />
              <Row label="Runs" value={item.duration_minutes ? `${Math.round(item.duration_minutes / 60)} hrs` : '—'} />
            </div>
          )}

          {tab === 'promo' && (
            <div className="space-y-3 text-sm">
              {item.marketing?.blurb ? (
                <>
                  <Block title="Blurb" body={item.marketing.blurb} />
                  {item.marketing.email_subject && (
                    <Block title="Email subject" body={item.marketing.email_subject} />
                  )}
                  {item.marketing.email_body && <Block title="Email" body={item.marketing.email_body} />}
                  {item.marketing.flyer_headline && (
                    <Block title="Flyer" body={[item.marketing.flyer_headline, ...(item.marketing.flyer_lines ?? [])].join('\n')} />
                  )}
                  {item.marketing.schedule?.note && (
                    <div className="text-xs px-3 py-2 rounded-lg" style={{ background: '#0d3d4d', color: '#cde8f0' }}>
                      <Megaphone className="w-3.5 h-3.5 inline mr-1" />
                      {item.marketing.schedule.note}
                    </div>
                  )}
                </>
              ) : (
                <p className="opacity-60">No copy yet.</p>
              )}
              <button onClick={writeMarketing} disabled={!!working}
                      className="w-full px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2 font-semibold"
                      style={{ background: '#D3FB52', color: '#001820' }}>
                {working === 'marketing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                {item.marketing?.blurb ? 'Rewrite copy' : 'Write the marketing kit'}
              </button>
            </div>
          )}
        </div>

        {/* actions */}
        <div className="p-4 border-t space-y-2" style={{ borderColor: '#0d3d4d' }}>
          {item.event_id ? (
            <a href={`/mixer/events/${item.event_id}`} target="_blank" rel="noreferrer"
               className="w-full px-3 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
               style={{ background: '#0d3d4d', color: '#e6f0f3' }}>
              <ExternalLink className="w-4 h-4" /> Open the live event
            </a>
          ) : (
            <button onClick={promote} disabled={!!working || !item.target_date}
                    className="w-full px-3 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
                    style={{ background: '#D3FB52', color: '#001820' }}
                    title={item.target_date ? 'Create the real event' : 'Give it a date first'}>
              {working === 'promote' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
              Promote to a real event
            </button>
          )}

          <button onClick={holdCourts} disabled={!!working || !item.target_date}
                  className="w-full px-3 py-2 rounded-lg text-sm border flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ borderColor: '#0d3d4d' }}>
            {working === 'hold' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LandPlot className="w-4 h-4" />}
            Hold the courts on CourtSheet
          </button>

          <div className="flex gap-2">
            {item.target_date && (
              <button onClick={onUnschedule} disabled={busy}
                      className="flex-1 px-3 py-2 rounded-lg text-sm border" style={{ borderColor: '#0d3d4d' }}>
                Unschedule
              </button>
            )}
            <button onClick={onRemove} disabled={busy}
                    className="flex-1 px-3 py-2 rounded-lg text-sm border flex items-center justify-center gap-1.5"
                    style={{ borderColor: '#7f1d1d', color: '#fca5a5' }}>
              <Trash2 className="w-4 h-4" /> Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b pb-1" style={{ borderColor: '#0d3d4d' }}>
      <span className="opacity-60">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide opacity-50 mb-1">{title}</div>
      <div className="text-sm whitespace-pre-wrap p-2 rounded-lg" style={{ background: '#001820' }}>{body}</div>
    </div>
  );
}

function BuildDialog({
  planId, year, onClose, onDone,
}: { planId: string; year: number; onClose: () => void; onDone: () => void }) {
  const [brief, setBrief] = useState('');
  const [count, setCount] = useState(18);
  const [result, setResult] = useState<any | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setWorking(true); setError(null);
    try {
      const res = await fetch('/api/calendar/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, targetCount: count, brief }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setResult(json);
    } catch (e: any) { setError(e.message); } finally { setWorking(false); }
  }

  async function accept() {
    setWorking(true);
    try {
      const res = await fetch('/api/calendar/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, items: result.rows }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onDone();
    } catch (e: any) { setError(e.message); setWorking(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: '#00121899' }}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border"
           style={{ background: '#002838', borderColor: '#0d3d4d' }}>
        <div className="p-5 border-b flex items-center gap-2" style={{ borderColor: '#0d3d4d' }}>
          <Sparkles className="w-5 h-5" style={{ color: '#D3FB52' }} />
          <h3 className="font-semibold">Build the {year} calendar</h3>
          <button onClick={onClose} className="ml-auto"><X className="w-5 h-5 opacity-60" /></button>
        </div>

        <div className="p-5 space-y-4">
          {!result ? (
            <>
              <p className="text-sm opacity-70">
                The assistant picks a balanced slate of events for your club. The scheduling engine then
                places each one on a real weekend, working around your imported conflicts, court bookings
                and the weather.
              </p>

              <label className="block text-sm">
                <span className="opacity-60">Roughly how many events?</span>
                <input type="number" min={4} max={40} value={count}
                       onChange={(e) => setCount(Number(e.target.value))}
                       className="mt-1 w-full px-3 py-2 rounded-lg border"
                       style={{ background: '#001820', borderColor: '#0d3d4d', color: '#e6f0f3' }} />
              </label>

              <label className="block text-sm">
                <span className="opacity-60">Anything it should know? (optional)</span>
                <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3}
                          placeholder="We want more junior programming this year, and the ladies group has asked for a second invitational."
                          className="mt-1 w-full px-3 py-2 rounded-lg border"
                          style={{ background: '#001820', borderColor: '#0d3d4d', color: '#e6f0f3' }} />
              </label>

              {error && <div className="text-sm" style={{ color: '#fca5a5' }}>{error}</div>}

              <button onClick={run} disabled={working}
                      className="w-full px-4 py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2"
                      style={{ background: '#D3FB52', color: '#001820' }}>
                {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Build it
              </button>
            </>
          ) : (
            <>
              {result.narrative && <p className="text-sm opacity-80 italic">{result.narrative}</p>}

              <div className="space-y-1.5">
                {result.proposed.map((p: any) => (
                  <div key={p.index} className="flex items-start gap-2 text-sm p-2 rounded-lg"
                       style={{ background: '#001820' }}>
                    <span className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                          style={{ background: DEPT_COLOR[p.department] ?? DEPT_COLOR.other }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium">{p.title}</span>
                        <span className="text-xs opacity-60">
                          {p.date ? longDate(p.date) : <span style={{ color: '#fca5a5' }}>no date found</span>}
                        </span>
                      </div>
                      {p.why && <div className="text-xs opacity-60">{p.why}</div>}
                      {p.reasons?.[0] && <div className="text-xs opacity-50">{p.reasons[0].detail}</div>}
                      {p.unplaced && <div className="text-xs" style={{ color: '#fca5a5' }}>{p.unplaced}</div>}
                    </div>
                  </div>
                ))}
              </div>

              {error && <div className="text-sm" style={{ color: '#fca5a5' }}>{error}</div>}

              <div className="flex gap-2">
                <button onClick={() => setResult(null)} className="flex-1 px-4 py-2.5 rounded-lg border text-sm"
                        style={{ borderColor: '#0d3d4d' }}>
                  Start over
                </button>
                <button onClick={accept} disabled={working}
                        className="flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
                        style={{ background: '#D3FB52', color: '#001820' }}>
                  {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                  Add all {result.proposed.length} to the calendar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Date helpers — the grid needs the same weekend model the engine uses, but
// without importing the server-side modules into the bundle.
// ============================================================

type Weekend = { saturday: string; days: string[]; holiday: string | null };

function buildWeekends(year: number): Weekend[] {
  const out: Weekend[] = [];
  const holidays = holidayMap(year);
  const d = new Date(Date.UTC(year, 0, 1));
  // Advance to the first Saturday.
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);

  while (d.getUTCFullYear() === year) {
    const sat = iso(d);
    const fri = shift(sat, -1);
    const sun = shift(sat, 1);
    const mon = shift(sat, 2);
    const days = [fri, sat, sun];
    // A holiday Monday belongs to the weekend before it.
    if (holidays.has(mon)) days.push(mon);
    out.push({
      saturday: sat,
      days,
      holiday: days.map((x) => holidays.get(x)).find(Boolean) ?? null,
    });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/** The handful of holidays worth labelling in the grid. Display only. */
function holidayMap(y: number): Map<string, string> {
  const m = new Map<string, string>();
  const nth = (month: number, dow: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1));
    const offset = (dow - first.getUTCDay() + 7) % 7;
    return iso(new Date(Date.UTC(y, month - 1, 1 + offset + (n - 1) * 7)));
  };
  const last = (month: number, dow: number) => {
    const lastDay = new Date(Date.UTC(y, month, 0));
    const offset = (lastDay.getUTCDay() - dow + 7) % 7;
    return iso(new Date(Date.UTC(y, month - 1, lastDay.getUTCDate() - offset)));
  };
  m.set(`${y}-01-01`, "New Year's");
  m.set(nth(1, 1, 3), 'MLK Day');
  m.set(nth(2, 1, 3), 'Presidents Day');
  m.set(last(5, 1), 'Memorial Day');
  m.set(`${y}-07-04`, 'July 4th');
  m.set(nth(9, 1, 1), 'Labor Day');
  m.set(`${y}-10-31`, 'Halloween');
  m.set(nth(11, 4, 4), 'Thanksgiving');
  m.set(`${y}-12-25`, 'Christmas');
  return m;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shift(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

function eachDay(start: string, end: string, cap: number): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end && out.length < cap) { out.push(cur); cur = shift(cur, 1); }
  return out;
}

function dedupe(cs: Constraint[]): Constraint[] {
  const seen = new Set<string>();
  return cs.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]}, ${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

function yearOptions(): number[] {
  const now = new Date().getFullYear();
  return [now - 1, now, now + 1, now + 2];
}
