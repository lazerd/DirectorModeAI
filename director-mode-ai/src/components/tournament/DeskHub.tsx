'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Trophy, X, Zap, RefreshCw, Plus, AlertTriangle, Check, MoreHorizontal } from 'lucide-react';

type DeskEvent = { id: string; name: string; division: string; num_courts: number; match_format: string; public_status: string; event_date: string | null };
type DeskMatch = {
  id: string; event_id: string; division: string; round: number; slot: number;
  court: string | null; status: string; score: string | null; score_token: string;
  sideA: string; sideB: string; ready: boolean;
};
type DeskData = { events: DeskEvent[]; matches: DeskMatch[]; courtCount: number };

const DIVISION_COLORS: Record<string, string> = {
  Gold: '#eab308', Silver: '#94a3b8', Bronze: '#b45309',
};
function divColor(d: string): string {
  return DIVISION_COLORS[d] || '#22d3ee';
}

type EventGroups = { today: DeskEvent[]; week: DeskEvent[]; older: DeskEvent[] };
// Bucket events by date so the picker stays fast with lots of past tournaments:
// Today, This week (±7 days), Older (everything else / undated).
function groupEvents(events: DeskEvent[]): EventGroups {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const DAY = 86400000;
  const g: EventGroups = { today: [], week: [], older: [] };
  for (const e of events) {
    if (!e.event_date) { g.older.push(e); continue; }
    const diff = Math.round((new Date(e.event_date + 'T00:00:00').getTime() - t.getTime()) / DAY);
    if (diff === 0) g.today.push(e);
    else if (Math.abs(diff) <= 7) g.week.push(e);
    else g.older.push(e);
  }
  const byDate = (a: DeskEvent, b: DeskEvent) =>
    (a.event_date || '').localeCompare(b.event_date || '') || a.name.localeCompare(b.name);
  g.today.sort(byDate); g.week.sort(byDate); g.older.sort((a, b) => byDate(b, a)); // older newest-first
  return g;
}

// Parse a court spec into the actual list of court labels the venue is using.
// Accepts ranges and lists and names: "5-15", "1,3,5", "1-3,7,9-11", "Center, 5-7".
function parseCourtSpec(spec: string): string[] {
  const out: string[] = [];
  for (const part of (spec || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b && out.length < 60; i++) out.push(String(i));
    } else if (out.length < 60) {
      out.push(part);
    }
  }
  return [...new Set(out)];
}

// Compact label for the court set, e.g. "Courts 5–15 · 11" or "6 courts".
function courtsLabel(courts: string[]): string {
  if (!courts.length) return 'no courts';
  const nums = courts.map(Number);
  if (nums.every((n) => Number.isFinite(n)) && courts.length > 1) {
    const s = [...nums].sort((x, y) => x - y);
    const contiguous = s.every((n, i) => i === 0 || n === s[i - 1] + 1);
    if (contiguous) return `Courts ${s[0]}–${s[s.length - 1]} · ${courts.length}`;
  }
  return `${courts.length} court${courts.length > 1 ? 's' : ''}`;
}

export default function DeskHub({ initialEvents }: { initialEvents: string[] }) {
  const eventsParam = initialEvents.length ? `?events=${initialEvents.join(',')}` : '';
  const [data, setData] = useState<DeskData | null>(null);
  const [courtSpec, setCourtSpec] = useState<string>('1-8');
  const [editingCourts, setEditingCourts] = useState(false);
  const [courtInput, setCourtInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [scoring, setScoring] = useState<DeskMatch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const specInited = useRef(false);
  const courts = useMemo(() => parseCourtSpec(courtSpec), [courtSpec]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments/desk${eventsParam}`, { cache: 'no-store' });
      if (!res.ok) return;
      const d: DeskData = await res.json();
      setData(d);
    } catch { /* keep last */ }
  }, [eventsParam]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  // Initialize the court set once from saved prefs, else 1..(default count).
  useEffect(() => {
    if (!data || specInited.current) return;
    specInited.current = true;
    let saved = '';
    try { saved = localStorage.getItem('deskhub.courts') || ''; } catch { /* ignore */ }
    setCourtSpec(saved.trim() || `1-${Math.max(1, data.courtCount || 8)}`);
  }, [data]);

  // Which events (divisions) the director is running on THIS desk. The desk only
  // shows the events they pick — so old or other-venue events (e.g. a stale
  // tournament still marked running) never clutter the board. Persisted locally.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ today: true, week: true, older: false });
  const [closingId, setClosingId] = useState<string | null>(null);
  const initedSel = useRef(false);
  const persist = (s: Set<string>) => { try { localStorage.setItem('deskhub.selected', JSON.stringify([...s])); } catch { /* ignore */ } };
  useEffect(() => {
    if (!data || initedSel.current) return;
    initedSel.current = true;
    let restored: Set<string> | null = null;
    if (initialEvents.length) {
      const v = initialEvents.filter((id) => data.events.some((e) => e.id === id));
      if (v.length) restored = new Set(v);
    }
    if (!restored) {
      try {
        const saved = JSON.parse(localStorage.getItem('deskhub.selected') || 'null');
        if (Array.isArray(saved)) {
          const v = saved.filter((id: string) => data.events.some((e) => e.id === id));
          if (v.length) restored = new Set(v);
        }
      } catch { /* ignore */ }
    }
    if (restored && restored.size) { setSelected(restored); persist(restored); }
    else setPickerOpen(true); // first visit — make them choose
  }, [data, initialEvents]);
  const isOn = useCallback((id: string) => selected.has(id), [selected]);
  const toggleDiv = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    persist(next); return next;
  });

  const activeEventIds = useMemo(
    () => (data?.events || []).filter((e) => isOn(e.id)).map((e) => e.id),
    [data, isOn],
  );
  const shownMatches = useMemo(
    () => (data?.matches || []).filter((m) => isOn(m.event_id)),
    [data, isOn],
  );
  // Picker groups: only events that actually have a draw (skip registration-only),
  // bucketed by date so the list stays short even with many past tournaments.
  const pickerGroups = useMemo(() => {
    const withDraw = (data?.events || []).filter((e) => (data?.matches || []).some((m) => m.event_id === e.id));
    return groupEvents(withDraw);
  }, [data]);

  const post = useCallback(async (payload: any) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/tournaments/desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j?.error || 'Action failed');
      await load();
      return j;
    } finally { setBusy(false); }
  }, [load]);

  // Court occupancy, waiting queue, and any match stranded on a court above the
  // current count (so lowering courts mid-day never hides a live match).
  const { courtsView, queue, offBoard } = useMemo(() => {
    const courtSet = new Set(courts);
    const occByCourt = new Map<string, DeskMatch>();
    const offBoard: DeskMatch[] = [];
    for (const m of shownMatches) {
      if (m.status === 'completed' || !m.court) continue;
      if (courtSet.has(String(m.court))) occByCourt.set(String(m.court), m);
      else offBoard.push(m);
    }
    const courtsView = courts.map((c) => ({ court: c, match: occByCourt.get(c) || null }));
    const queue = shownMatches
      .filter((m) => m.ready && !m.court)
      .sort((a, b) => a.round - b.round || a.slot - b.slot);
    return { courtsView, queue, offBoard };
  }, [shownMatches, courts]);

  const nextOpenCourt = useMemo(() => courtsView.find((c) => !c.match)?.court ?? null, [courtsView]);

  const assign = (matchId: string, court: string | null) => post({ action: 'assign', matchId, court });
  const startNextOn = (court: string) => {
    if (!queue.length) return;
    assign(queue[0].id, court);
  };
  // The court set is a hub VIEW setting — change it any time during the day.
  // It never writes the events' saved courts.
  const applyCourtSpec = (spec: string) => {
    setCourtSpec(spec);
    try { localStorage.setItem('deskhub.courts', spec); } catch { /* ignore */ }
    setEditingCourts(false);
  };
  const openCourtEditor = () => { setCourtInput(courtSpec); setEditingCourts(true); };
  const autofill = () => post({ action: 'autofill', eventIds: activeEventIds, courts });

  // Close out an event (mark completed/cancelled). It stops being "running", so
  // the next refetch drops it from the desk and the picker entirely.
  const closeEvent = async (id: string, status: 'completed' | 'cancelled') => {
    setClosingId(null);
    setSelected((prev) => { const n = new Set(prev); n.delete(id); persist(n); return n; });
    await post({ action: 'set_status', eventId: id, status });
  };

  const stats = useMemo(() => ({
    done: shownMatches.filter((m) => m.status === 'completed').length,
    total: shownMatches.length,
    onCourt: shownMatches.filter((m) => m.court && m.status !== 'completed').length,
    waiting: queue.length,
  }), [shownMatches, queue]);

  if (!data) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  }
  if (data.events.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center text-slate-400 px-6">
        <div>
          <p className="text-lg font-semibold text-slate-200">No running tournaments</p>
          <p className="mt-2 text-sm">Start a tournament (set it to running) and it’ll appear here on the shared court board.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#00131c] text-slate-100 px-3 sm:px-5 py-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-xl font-bold">Tournament Desk</h1>
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          {data.events.filter((e) => isOn(e.id)).map((e) => (
            <button key={e.id} onClick={() => toggleDiv(e.id)} title="Remove from this desk"
              className="rounded-full px-2.5 py-1 font-semibold text-[#00131c] inline-flex items-center gap-1"
              style={{ backgroundColor: divColor(e.division) }}>
              {e.division} <X size={11} />
            </button>
          ))}
          <button onClick={() => setPickerOpen(true)}
            className="rounded-full px-2.5 py-1 font-semibold border border-white/20 text-slate-300 hover:bg-white/10 inline-flex items-center gap-1">
            <Plus size={12} /> Events
          </button>
        </div>
        <div className="flex-1" />
        <div className="text-sm text-slate-400 mr-2">
          {stats.done}/{stats.total} done · {stats.onCourt} on court · {stats.waiting} waiting
        </div>
        {/* Courts in use — edit any time (e.g. 5-15, or 1,3,5) */}
        {editingCourts ? (
          <div className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1.5">
            <input autoFocus value={courtInput} onChange={(e) => setCourtInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyCourtSpec(courtInput); if (e.key === 'Escape') setEditingCourts(false); }}
              placeholder="e.g. 5-15 or 1,3,5"
              className="w-40 rounded bg-white/10 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none" />
            <button onClick={() => applyCourtSpec(courtInput)} className="text-[#D3FB52] text-xs font-bold px-1.5">Apply</button>
            <button onClick={() => setEditingCourts(false)} className="text-slate-500 hover:text-slate-300 px-0.5"><X size={14} /></button>
          </div>
        ) : (
          <button onClick={openCourtEditor} title="Edit which courts you're using (e.g. 5-15)"
            className="flex items-center gap-2 rounded-lg bg-white/5 hover:bg-white/10 px-3 py-1.5">
            <span className="text-xs text-slate-400 uppercase tracking-wide">Courts</span>
            <span className="text-sm font-bold">{courtsLabel(courts)}</span>
          </button>
        )}
        <button onClick={autofill} disabled={busy || !queue.length}
          className="inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] text-[#00131c] font-bold px-4 py-2 disabled:opacity-40">
          <Zap size={16} /> Fill courts
        </button>
        <button onClick={load} className="rounded-lg bg-white/5 p-2 hover:bg-white/10" title="Refresh">
          <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
        </button>
      </div>

      {err && <div className="mb-3 text-sm text-red-400">{err}</div>}

      {activeEventIds.length === 0 && !pickerOpen && (
        <div className="mb-3 rounded-xl border border-[#D3FB52]/40 bg-[#D3FB52]/10 p-4 text-center">
          <p className="text-slate-100 font-semibold mb-2">Pick the events you’re running on this desk</p>
          <button onClick={() => setPickerOpen(true)} className="rounded-lg bg-[#D3FB52] text-[#00131c] font-bold px-4 py-2">Choose events</button>
        </div>
      )}

      {offBoard.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3">
          <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold mb-2">
            <AlertTriangle size={16} /> {offBoard.length} match{offBoard.length > 1 ? 'es' : ''} on a court that’s not in your current set ({courtsLabel(courts)}) — score or send back:
          </div>
          <div className="flex flex-wrap gap-2">
            {offBoard.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-sm">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-[#00131c]" style={{ backgroundColor: divColor(m.division) }}>{m.division}</span>
                <span className="text-slate-400">Court {m.court}:</span>
                <span>{m.sideA} vs {m.sideB}</span>
                <button onClick={() => setScoring(m)} className="ml-1 rounded bg-[#D3FB52] text-[#00131c] font-bold px-2 py-0.5 text-xs">Score</button>
                <button onClick={() => assign(m.id, null)} title="Send back to queue" className="rounded bg-white/10 hover:bg-white/20 px-1.5 py-0.5"><X size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* Court board */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {courtsView.map(({ court, match }) => (
            <div key={court} className={`rounded-xl border p-3 min-h-[128px] flex flex-col ${match ? 'border-[#D3FB52]/40 bg-[#062733]' : 'border-white/10 bg-white/[0.03]'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg font-bold">Court {court}</span>
                {match ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full text-[#00131c]" style={{ backgroundColor: divColor(match.division) }}>
                    {match.division}
                  </span>
                ) : <span className="text-xs text-slate-500 uppercase tracking-wide">Open</span>}
              </div>
              {match ? (
                <>
                  <div className="flex-1 space-y-1">
                    <div className="font-semibold leading-tight">{match.sideA}</div>
                    <div className="text-xs text-slate-500">vs</div>
                    <div className="font-semibold leading-tight">{match.sideB}</div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => setScoring(match)}
                      className="flex-1 rounded-lg bg-[#D3FB52] text-[#00131c] font-bold py-2 text-sm">
                      Enter score
                    </button>
                    <button onClick={() => assign(match.id, null)} title="Clear court"
                      className="rounded-lg bg-white/5 px-2 text-slate-400 hover:bg-white/10"><X size={16} /></button>
                  </div>
                </>
              ) : (
                <button onClick={() => startNextOn(court)} disabled={!queue.length || busy}
                  className="flex-1 rounded-lg border border-dashed border-white/15 text-slate-400 hover:text-slate-200 hover:border-white/30 disabled:opacity-40 flex items-center justify-center gap-2 text-sm">
                  <Play size={16} /> Start next match
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Up next */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold">Up next</p>
            <span className="text-xs text-slate-500">{queue.length} waiting</span>
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {queue.length === 0 && (
              <p className="text-sm text-slate-500 py-6 text-center">
                <Trophy size={18} className="inline mr-1 opacity-60" /> All matches assigned or done.
              </p>
            )}
            {queue.map((m) => (
              <button key={m.id} disabled={!nextOpenCourt || busy}
                onClick={() => nextOpenCourt && assign(m.id, nextOpenCourt)}
                className="w-full text-left rounded-lg bg-white/5 hover:bg-white/10 p-2.5 disabled:opacity-50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-[#00131c]" style={{ backgroundColor: divColor(m.division) }}>{m.division}</span>
                  <span className="text-[10px] text-slate-500">R{m.round}</span>
                </div>
                <div className="text-sm font-medium leading-tight">{m.sideA} <span className="text-slate-500">vs</span> {m.sideB}</div>
                {nextOpenCourt && <div className="text-[11px] text-[#D3FB52] mt-0.5">→ tap to put on Court {nextOpenCourt}</div>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-[#062733] border border-white/10 rounded-2xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <p className="font-bold text-slate-100">Choose events to run</p>
              <button onClick={() => setPickerOpen(false)} className="text-slate-400 hover:text-slate-200"><X size={18} /></button>
            </div>
            <p className="text-xs text-slate-400 mb-3">Pick the divisions you’re running. Registration-only events (no draw yet) don’t appear here.</p>

            {(['today', 'week', 'older'] as const).map((key) => {
              const list = pickerGroups[key];
              if (!list.length) return null;
              const label = key === 'today' ? 'Today' : key === 'week' ? 'This week' : 'Older';
              const open = openGroups[key];
              const selCount = list.filter((e) => isOn(e.id)).length;
              return (
                <div key={key} className="mb-1.5">
                  <button onClick={() => setOpenGroups((g) => ({ ...g, [key]: !g[key] }))}
                    className="w-full flex items-center gap-2 py-1.5 text-slate-200 font-semibold text-sm hover:text-white">
                    <span className="text-slate-500 w-3 inline-block">{open ? '▾' : '▸'}</span>
                    {label}
                    <span className="text-xs text-slate-500 font-normal">{list.length}{selCount ? ` · ${selCount} selected` : ''}</span>
                  </button>
                  {open && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-5 pb-1">
                      {list.map((e) => {
                        const on = isOn(e.id);
                        return (
                          <div key={e.id}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 border min-h-[46px] ${on ? 'bg-[#D3FB52]/15 border-[#D3FB52]/50' : 'bg-white/5 border-white/10'}`}>
                            {closingId === e.id ? (
                              <>
                                <span className="text-[11px] text-slate-400 mr-auto truncate">Close “{e.division}”?</span>
                                <button onClick={() => closeEvent(e.id, 'completed')} className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 font-medium text-[11px] shrink-0">Completed</button>
                                <button onClick={() => closeEvent(e.id, 'cancelled')} className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 font-medium text-[11px] shrink-0">Cancelled</button>
                                <button onClick={() => setClosingId(null)} className="text-slate-500 hover:text-slate-300 p-0.5 shrink-0"><X size={12} /></button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => toggleDiv(e.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: divColor(e.division) }} />
                                  <span className="min-w-0">
                                    <span className="block font-medium text-slate-100 text-sm leading-tight">{e.division}</span>
                                    <span className="block text-[11px] text-slate-500 truncate leading-tight">{e.name}</span>
                                  </span>
                                </button>
                                {on && <Check size={16} className="text-[#D3FB52] shrink-0" />}
                                <button onClick={() => setClosingId(e.id)} title="Close out this event (mark completed/cancelled)" className="text-slate-500 hover:text-slate-300 p-1 shrink-0"><MoreHorizontal size={16} /></button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {pickerGroups.today.length + pickerGroups.week.length + pickerGroups.older.length === 0 && (
              <p className="text-sm text-slate-500 py-4 text-center">No tournaments with a draw yet — generate a draw and it’ll show up here.</p>
            )}

            <button onClick={() => setPickerOpen(false)} className="w-full mt-4 rounded-xl bg-[#D3FB52] text-[#00131c] font-bold py-2.5">Done</button>
          </div>
        </div>
      )}

      {scoring && (
        <ScoreModal match={scoring} onClose={() => setScoring(null)} onSaved={async () => { setScoring(null); await load(); }} />
      )}
    </div>
  );
}

function ScoreModal({ match, onClose, onSaved }: { match: DeskMatch; onClose: () => void; onSaved: () => void }) {
  const [winner, setWinner] = useState<'a' | 'b' | null>(null);
  const [score, setScore] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!winner) { setErr('Pick a winner.'); return; }
    if (!score.trim()) { setErr('Enter a score (e.g. 4-2).'); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/tournaments/match/${match.score_token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner_side: winner, score: score.trim(), reported_by_name: 'Desk' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error || 'Could not save score.'); return; }
      onSaved();
    } catch { setErr('Could not save — check your connection.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#062733] border border-white/10 rounded-2xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="font-bold text-slate-100">Enter score · Court {match.court}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={18} /></button>
        </div>
        <p className="text-xs text-slate-400 mb-3">Tap the winner, type the score.</p>
        <div className="space-y-2 mb-3">
          {(['a', 'b'] as const).map((s) => (
            <button key={s} onClick={() => setWinner(s)}
              className={`w-full rounded-xl px-4 py-3 text-left font-semibold border ${winner === s ? 'bg-[#D3FB52] text-[#00131c] border-[#D3FB52]' : 'bg-white/5 text-slate-100 border-white/10 hover:bg-white/10'}`}>
              {s === 'a' ? match.sideA : match.sideB}
            </button>
          ))}
        </div>
        <input value={score} onChange={(e) => setScore(e.target.value)} placeholder="Score, e.g. 4-2"
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-slate-100 placeholder:text-slate-500 mb-3 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]/50" />
        {err && <p className="text-sm text-red-400 mb-2">{err}</p>}
        <button onClick={save} disabled={saving}
          className="w-full rounded-xl bg-[#D3FB52] text-[#00131c] font-bold py-3 disabled:opacity-50 inline-flex items-center justify-center gap-2">
          {saving && <Loader2 size={16} className="animate-spin" />} Save score
        </button>
      </div>
    </div>
  );
}
