'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Upload, Loader2, Check, Sparkles, ArrowRight, RefreshCw, X, Trash2, CalendarCheck, History, Repeat,
} from 'lucide-react';

// Building a year has an order to it, and the order matters:
//
//   1. What's already booked?  School calendar, swim meets, league play, the
//      club's own events. Until the planner knows these, every date it
//      suggests is a guess.
//   2. What do you want to run?  A checklist of suggestions — tick the ones
//      you're interested in. Nothing is placed until you've chosen.
//   3. Where does it go?  Now the engine can place them for real, against a
//      calendar that reflects reality.
//
// The first version of this jumped straight to step 3 and handed back a
// finished year, which is why it felt like being handed someone else's plan.

type RepeatCandidate = {
  key: string;
  title: string;
  occurrences: number;
  sourceDates: string[];
  proposedDates: string[];
  isSeries: boolean;
  note: string;
  match_format: string | null;
  entry_fee_cents: number | null;
  num_courts: number | null;
  start_time: string | null;
};

type Suggestion = {
  index: number;
  title: string;
  catalogKey: string | null;
  department: string;
  audience: string[];
  effort: string;
  why: string | null;
  date: string | null;
  score: number | null;
  reasons: Array<{ detail: string }>;
  unplaced: string | null;
};

const DEPT_COLOR: Record<string, string> = {
  tennis: '#eab308', pickleball: '#22d3ee', swim: '#38bdf8',
  fitness: '#a78bfa', social: '#fb923c', other: '#94a3b8',
};

export default function SetupFlow({
  planId, year, importCount, onDone,
}: {
  planId: string;
  year: number;
  importCount: number;
  onDone: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(importCount > 0 ? 2 : 1);
  const [imports, setImports] = useState<number>(importCount);
  const [constraintCount, setConstraintCount] = useState<number | null>(null);

  const [brief, setBrief] = useState('');
  const [count, setCount] = useState(15);
  const [narrative, setNarrative] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());

  // Last year's proven events — offered before any AI suggestion, because a
  // director's own calendar beats anything a catalog can propose.
  const [repeats, setRepeats] = useState<RepeatCandidate[] | null>(null);
  const [repeatPicks, setRepeatPicks] = useState<Set<string>>(new Set());
  const [sourceYear, setSourceYear] = useState(year - 1);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshImports = useCallback(async () => {
    const res = await fetch(`/api/calendar/plan?year=${year}`, { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    setImports((json.imports ?? []).length);
    setConstraintCount((json.constraints ?? []).length);
  }, [year]);

  async function sweepClubMode() {
    setBusy('sweep'); setError(null);
    try {
      const parse = await fetch('/api/calendar/import/clubmode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'parse', year }),
      });
      const pj = await parse.json();
      if (!parse.ok) throw new Error(pj.error);
      if ((pj.proposed ?? []).length === 0) {
        setError(`Nothing found in ClubMode for ${year} — that's fine, you can upload files instead.`);
        return;
      }
      const commit = await fetch('/api/calendar/import/clubmode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commit', year, planId, rows: pj.proposed }),
      });
      const cj = await commit.json();
      if (!commit.ok) throw new Error(cj.error);
      await refreshImports();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  const loadRepeats = useCallback(async () => {
    try {
      const res = await fetch(`/api/calendar/repeat?year=${year}&from=${year - 1}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      setRepeats(json.candidates ?? []);
      setSourceYear(json.sourceYear ?? year - 1);
      // Series are the backbone of a club year, so they start ticked; one-offs
      // are a judgement call and start unticked.
      setRepeatPicks(new Set((json.candidates ?? []).filter((c: RepeatCandidate) => c.isSeries).map((c: RepeatCandidate) => c.key)));
    } catch { /* no history is a fine outcome */ }
  }, [year]);

  useEffect(() => { refreshImports(); loadRepeats(); }, [refreshImports, loadRepeats]);

  async function addRepeats() {
    if (!repeats) return;
    const picked = repeats.filter((c) => repeatPicks.has(c.key));
    if (picked.length === 0) { setError('Tick at least one.'); return; }
    setBusy('repeat'); setError(null);
    try {
      const res = await fetch('/api/calendar/repeat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, candidates: picked }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onDone();
    } catch (e: any) { setError(e.message); setBusy(null); }
  }

  async function suggest() {
    setBusy('suggest'); setError(null);
    try {
      const res = await fetch('/api/calendar/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, targetCount: count, brief }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSuggestions(json.proposed ?? []);
      setRows(json.rows ?? []);
      setNarrative(json.narrative ?? '');
      // Everything ticked by default — it's faster to remove two than add twelve.
      setChosen(new Set((json.proposed ?? []).map((p: Suggestion) => p.index)));
      setStep(3);
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  async function add() {
    if (!suggestions) return;
    const picked = rows.filter((_, i) => chosen.has(i));
    if (picked.length === 0) { setError('Tick at least one event.'); return; }
    setBusy('add'); setError(null);
    try {
      const res = await fetch('/api/calendar/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, items: picked }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onDone();
    } catch (e: any) { setError(e.message); setBusy(null); }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-6">
        {([1, 2, 3] as const).map((n) => (
          <div key={n} className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full grid place-items-center text-xs font-semibold"
                 style={step >= n
                   ? { background: '#D3FB52', color: '#001820' }
                   : { background: '#0d3d4d', color: '#7f9aa5' }}>
              {step > n ? <Check className="w-3.5 h-3.5" /> : n}
            </div>
            <span className="text-sm" style={{ color: step >= n ? '#e6f0f3' : '#7f9aa5' }}>
              {n === 1 ? "What's already booked" : n === 2 ? 'Pick your events' : 'Review'}
            </span>
            {n < 3 && <div className="w-6 h-px" style={{ background: '#0d3d4d' }} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-sm mb-4 flex items-center justify-between"
             style={{ background: '#4c1d1d', color: '#fecaca' }}>
          {error}<button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ---- Step 1: import what exists ---- */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">First, what&apos;s already on the books?</h2>
            <p className="text-sm opacity-70 mt-1">
              School calendars, swim meets, league play, the golf and dining calendar, court closures —
              anything that would make a weekend a bad choice. Every date suggested after this is
              planned around them.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/calendar/import"
                  className="rounded-xl border-2 border-dashed p-5 block"
                  style={{ borderColor: '#0d3d4d', background: '#002838' }}>
              <div className="flex items-center gap-2 mb-1">
                <Upload className="w-5 h-5" style={{ color: '#D3FB52' }} />
                <span className="font-semibold">Upload calendars</span>
              </div>
              <p className="text-sm opacity-70">
                .ics, CSV, or a photo or PDF of the schedule on the fridge. Tell us which kind it is and
                we&apos;ll read it — school, swim, league, club, or facility.
              </p>
            </Link>

            <button onClick={sweepClubMode} disabled={!!busy}
                    className="rounded-xl border p-5 text-left"
                    style={{ borderColor: '#0d3d4d', background: '#002838' }}>
              <div className="flex items-center gap-2 mb-1">
                {busy === 'sweep' ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" style={{ color: '#22d3ee' }} />}
                <span className="font-semibold">Pull in your ClubMode events</span>
              </div>
              <p className="text-sm opacity-70">
                One click. Tournaments, leagues and JTT match days already in ClubMode for {year}.
              </p>
            </button>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-sm opacity-70">
              {imports === 0
                ? 'Nothing imported yet.'
                : `${imports} calendar${imports === 1 ? '' : 's'} imported${constraintCount ? ` · ${constraintCount} conflicts known` : ''}`}
            </div>
            <button onClick={() => setStep(2)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
                    style={{ background: '#D3FB52', color: '#001820' }}>
              {imports === 0 ? 'Skip for now' : 'Next'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ---- Step 2: what do you want to run ---- */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">What do you want to run?</h2>
            <p className="text-sm opacity-70 mt-1">
              Start with what worked last year, then fill the gaps. Nothing gets added until you say so.
            </p>
          </div>

          {/* Last year first — proven events beat suggested ones. */}
          {repeats && repeats.length > 0 && (
            <div className="rounded-xl border p-3" style={{ background: '#002838', borderColor: '#0d3d4d' }}>
              <div className="flex items-center gap-2 mb-1">
                <History className="w-4 h-4" style={{ color: '#D3FB52' }} />
                <span className="font-semibold text-sm">What you ran in {sourceYear}</span>
                <span className="ml-auto text-xs opacity-50">{repeatPicks.size} selected</span>
              </div>
              <p className="text-xs opacity-60 mb-2">
                Dates moved to the equivalent weekend next year. Recurring events keep their cadence.
              </p>

              <div className="space-y-1">
                {repeats.map((c) => {
                  const on = repeatPicks.has(c.key);
                  return (
                    <label key={c.key} className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer"
                           style={{ background: on ? '#0d3d4d55' : 'transparent', opacity: on ? 1 : 0.55 }}>
                      <input type="checkbox" checked={on} className="mt-1 w-4 h-4"
                             onChange={(e) => setRepeatPicks((cur) => {
                               const next = new Set(cur);
                               if (e.target.checked) next.add(c.key); else next.delete(c.key);
                               return next;
                             })} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-medium text-sm">{c.title}</span>
                          {c.isSeries && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
                                  style={{ background: '#0d3d4d', color: '#9fc0cb' }}>
                              <Repeat className="w-2.5 h-2.5" />×{c.occurrences}
                            </span>
                          )}
                        </div>
                        <div className="text-xs opacity-55">
                          {c.note} · now {c.proposedDates.length === 1
                            ? longDate(c.proposedDates[0])
                            : `${longDate(c.proposedDates[0])} → ${longDate(c.proposedDates[c.proposedDates.length - 1])}`}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 mt-2 pt-2 border-t" style={{ borderColor: '#0d3d4d' }}>
                <button onClick={() => setRepeatPicks(new Set(repeats.map((c) => c.key)))}
                        className="text-xs opacity-70 hover:opacity-100">Select all</button>
                <button onClick={() => setRepeatPicks(new Set())}
                        className="text-xs opacity-70 hover:opacity-100">Clear</button>
                <button onClick={addRepeats} disabled={!!busy || repeatPicks.size === 0}
                        className="ml-auto px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40"
                        style={{ background: '#D3FB52', color: '#001820' }}>
                  {busy === 'repeat' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Repeat className="w-3.5 h-3.5" />}
                  Add these
                </button>
              </div>
            </div>
          )}

          <div className="text-xs uppercase tracking-wide opacity-40 text-center">
            {repeats && repeats.length > 0 ? 'or fill the gaps with something new' : ''}
          </div>

          <div className="grid sm:grid-cols-[120px_1fr] gap-3">
            <label className="block text-sm">
              <span className="opacity-60">How many?</span>
              <input type="number" min={4} max={40} value={count}
                     onChange={(e) => setCount(Number(e.target.value))}
                     className="mt-1 w-full px-3 py-2 rounded-lg border"
                     style={{ background: '#001820', borderColor: '#0d3d4d', color: '#e6f0f3' }} />
            </label>
            <label className="block text-sm">
              <span className="opacity-60">Anything we should know? (optional)</span>
              <input value={brief} onChange={(e) => setBrief(e.target.value)}
                     placeholder="More junior programming this year; the ladies want a second invitational."
                     className="mt-1 w-full px-3 py-2 rounded-lg border"
                     style={{ background: '#001820', borderColor: '#0d3d4d', color: '#e6f0f3' }} />
            </label>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button onClick={() => setStep(1)} className="text-sm opacity-60 hover:opacity-100">Back</button>
            <div className="flex gap-2">
              <Link href="/calendar/ideas" className="px-3 py-2 rounded-lg text-sm border"
                    style={{ borderColor: '#0d3d4d' }}>
                Browse all ideas
              </Link>
              <button onClick={suggest} disabled={!!busy}
                      className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
                      style={{ background: '#D3FB52', color: '#001820' }}>
                {busy === 'suggest' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Suggest events
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Step 3: tick and place ---- */}
      {step === 3 && suggestions && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Tick the ones you want</h2>
            {narrative && <p className="text-sm opacity-70 mt-1 italic">{narrative}</p>}
          </div>

          <div className="flex items-center gap-3 text-sm">
            <button onClick={() => setChosen(new Set(suggestions.map((s) => s.index)))}
                    className="opacity-70 hover:opacity-100">Select all</button>
            <button onClick={() => setChosen(new Set())}
                    className="opacity-70 hover:opacity-100">Clear</button>
            <span className="ml-auto opacity-60">{chosen.size} of {suggestions.length} selected</span>
          </div>

          <div className="rounded-xl border divide-y" style={{ borderColor: '#0d3d4d', background: '#002838' }}>
            {suggestions.map((s) => {
              const on = chosen.has(s.index);
              return (
                <label key={s.index} className="flex items-start gap-3 p-3 cursor-pointer"
                       style={{ borderColor: '#0d3d4d', opacity: on ? 1 : 0.45 }}>
                  <input type="checkbox" checked={on} className="mt-1 w-4 h-4"
                         onChange={(e) => setChosen((cur) => {
                           const next = new Set(cur);
                           if (e.target.checked) next.add(s.index); else next.delete(s.index);
                           return next;
                         })} />
                  <span className="w-2 h-2 rounded-full mt-2 shrink-0"
                        style={{ background: DEPT_COLOR[s.department] ?? DEPT_COLOR.other }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium">{s.title}</span>
                      <span className="text-xs" style={{ color: s.date ? '#D3FB52' : '#fca5a5' }}>
                        {s.date ? longDate(s.date) : 'no date found'}
                      </span>
                      <span className="text-[11px] opacity-50">{s.audience.join(', ')}</span>
                    </div>
                    {s.why && <div className="text-xs opacity-70 mt-0.5">{s.why}</div>}
                    {s.reasons?.[0] && <div className="text-xs opacity-45 mt-0.5">{s.reasons[0].detail}</div>}
                    {s.unplaced && <div className="text-xs mt-0.5" style={{ color: '#fca5a5' }}>{s.unplaced}</div>}
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => { setSuggestions(null); setStep(2); }}
                    className="text-sm opacity-60 hover:opacity-100 flex items-center gap-1">
              <Trash2 className="w-3.5 h-3.5" /> Start over
            </button>
            <button onClick={add} disabled={!!busy || chosen.size === 0}
                    className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
                    style={{ background: '#D3FB52', color: '#001820' }}>
              {busy === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
              Add {chosen.size} to the calendar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]}, ${MON[m - 1]} ${d}`;
}
