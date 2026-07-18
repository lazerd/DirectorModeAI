'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Trophy, X, Zap, RefreshCw, Minus, Plus, AlertTriangle } from 'lucide-react';

type DeskEvent = { id: string; name: string; division: string; num_courts: number; match_format: string; public_status: string };
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

export default function DeskHub({ initialEvents }: { initialEvents: string[] }) {
  const eventsParam = initialEvents.length ? `?events=${initialEvents.join(',')}` : '';
  const [data, setData] = useState<DeskData | null>(null);
  const [courtCount, setCourtCount] = useState<number>(8);
  const [busy, setBusy] = useState(false);
  const [scoring, setScoring] = useState<DeskMatch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const courtOverride = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments/desk${eventsParam}`, { cache: 'no-store' });
      if (!res.ok) return;
      const d: DeskData = await res.json();
      setData(d);
      if (courtOverride.current == null) setCourtCount(d.courtCount);
    } catch { /* keep last */ }
  }, [eventsParam]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  // Which divisions (events) are shown. Defaults to all; a director can deselect
  // to focus on just their own venue's draws (divisions can be at different sites).
  const [selected, setSelected] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (data && selected === null) setSelected(new Set(data.events.map((e) => e.id)));
  }, [data, selected]);
  const isOn = useCallback((id: string) => !selected || selected.has(id), [selected]);
  const toggleDiv = (id: string) => setSelected((prev) => {
    const next = new Set(prev ?? (data?.events || []).map((e) => e.id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const activeEventIds = useMemo(
    () => (data?.events || []).filter((e) => isOn(e.id)).map((e) => e.id),
    [data, isOn],
  );
  const shownMatches = useMemo(
    () => (data?.matches || []).filter((m) => isOn(m.event_id)),
    [data, isOn],
  );

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
    const occByCourt = new Map<string, DeskMatch>();
    const offBoard: DeskMatch[] = [];
    for (const m of shownMatches) {
      if (m.status === 'completed' || !m.court) continue;
      const n = parseInt(String(m.court), 10);
      if (Number.isFinite(n) && n >= 1 && n <= courtCount) occByCourt.set(String(n), m);
      else offBoard.push(m);
    }
    const courtsView = Array.from({ length: courtCount }, (_, i) => {
      const n = String(i + 1);
      return { court: n, match: occByCourt.get(n) || null };
    });
    const queue = shownMatches
      .filter((m) => m.ready && !m.court)
      .sort((a, b) => a.round - b.round || a.slot - b.slot);
    return { courtsView, queue, offBoard };
  }, [shownMatches, courtCount]);

  const nextOpenCourt = useMemo(() => courtsView.find((c) => !c.match)?.court ?? null, [courtsView]);

  const assign = (matchId: string, court: string | null) => post({ action: 'assign', matchId, court });
  const startNextOn = (court: string) => {
    if (!queue.length) return;
    assign(queue[0].id, court);
  };
  // Court count is a hub VIEW setting — change it any time during the day. It
  // never writes the events' saved num_courts.
  const setCourts = (num: number) => {
    const clamped = Math.max(1, Math.min(24, num));
    courtOverride.current = clamped; setCourtCount(clamped);
  };
  const autofill = () => post({ action: 'autofill', eventIds: activeEventIds, courtCount });

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
          {data.events.map((e) => {
            const on = isOn(e.id);
            return (
              <button key={e.id} onClick={() => toggleDiv(e.id)}
                title={on ? 'Showing — tap to hide this division' : 'Hidden — tap to show'}
                className={`rounded-full px-2.5 py-1 font-semibold transition ${on ? 'text-[#00131c]' : 'text-slate-500 bg-white/5 line-through'}`}
                style={on ? { backgroundColor: divColor(e.division) } : undefined}>
                {e.division}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <div className="text-sm text-slate-400 mr-2">
          {stats.done}/{stats.total} done · {stats.onCourt} on court · {stats.waiting} waiting
        </div>
        {/* Courts — change any time during the event */}
        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5">
          <span className="text-xs text-slate-400 uppercase tracking-wide">Courts</span>
          <button onClick={() => setCourts(courtCount - 1)} className="rounded-md bg-white/10 hover:bg-white/20 p-1.5" aria-label="Fewer courts"><Minus size={14} /></button>
          <span className="text-lg font-bold w-7 text-center tabular-nums">{courtCount}</span>
          <button onClick={() => setCourts(courtCount + 1)} className="rounded-md bg-white/10 hover:bg-white/20 p-1.5" aria-label="More courts"><Plus size={14} /></button>
        </div>
        <button onClick={autofill} disabled={busy || !queue.length}
          className="inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] text-[#00131c] font-bold px-4 py-2 disabled:opacity-40">
          <Zap size={16} /> Fill courts
        </button>
        <button onClick={load} className="rounded-lg bg-white/5 p-2 hover:bg-white/10" title="Refresh">
          <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
        </button>
      </div>

      {err && <div className="mb-3 text-sm text-red-400">{err}</div>}

      {offBoard.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3">
          <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold mb-2">
            <AlertTriangle size={16} /> {offBoard.length} match{offBoard.length > 1 ? 'es' : ''} on a court above your current {courtCount}-court setup — score or send back:
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
