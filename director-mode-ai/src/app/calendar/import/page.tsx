'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Upload, FileText, Image as ImageIcon, Loader2, Check, X, Trash2,
  AlertTriangle, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { CALENDAR_KINDS, type CalendarKind } from '@/lib/calendar/classify';

// Feed the planner the real world: the school district's calendar, the swim
// team's meet schedule, the USTA league grid, the golf and dining calendar,
// the facility's closure list — and the club's own ClubMode events.
//
// Every path is two-step — parse, review, then commit. Nothing is written until
// the director has looked at it, because an automatic import that misreads a
// school calendar quietly poisons every date the engine picks afterwards.

type Proposed = {
  title: string;
  starts_on: string;
  ends_on: string;
  impact: 'blocking' | 'heavy' | 'light' | 'favorable';
  audience_tags: string[];
  note: string;
  ignore: boolean;
};

type ImportRow = {
  id: string; kind: string; label: string | null; filename: string | null;
  item_count: number; created_at: string;
};

const IMPACTS: Array<{ value: Proposed['impact']; label: string; color: string; hint: string }> = [
  { value: 'blocking', label: 'Blocks', color: '#fca5a5', hint: 'Nothing can be scheduled here' },
  { value: 'heavy', label: 'Heavy', color: '#fcd34d', hint: 'Members will be away or busy' },
  { value: 'light', label: 'Light', color: '#93c5fd', hint: 'Worth noting, small effect' },
  { value: 'favorable', label: 'Good', color: '#86efac', hint: 'Members are MORE available' },
];

export default function ImportPage() {
  const [year, setYear] = useState(new Date().getFullYear() + 1);
  const [planId, setPlanId] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);

  const [proposed, setProposed] = useState<Proposed[] | null>(null);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<string>('ics');
  const [filename, setFilename] = useState<string | null>(null);
  const [source, setSource] = useState<CalendarKind>('school');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const res = await fetch(`/api/calendar/plan?year=${year}`, { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    setPlanId(json.plan?.id ?? null);
    setImports(json.imports ?? []);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year]);

  async function handleFile(file: File) {
    setError(null); setDone(null); setProposed(null);
    setFilename(file.name);
    setLabel(file.name.replace(/\.[^.]+$/, ''));

    const isText = /\.(ics|csv|txt|tsv)$/i.test(file.name);
    setBusy('parse');

    try {
      if (isText) {
        const content = await file.text();
        const k = /\.ics$/i.test(file.name) ? 'ics' : 'csv';
        setKind(k);
        const res = await fetch('/api/calendar/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'parse', kind: k, content, source }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setProposed(json.proposed);
      } else {
        // PDF or photo → Claude reads it.
        const b64 = await toBase64(file);
        setKind(file.type === 'application/pdf' ? 'pdf' : 'image');
        const res = await fetch('/api/calendar/import/vision', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaType: file.type, data: b64, year, kind: source }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setProposed(json.proposed);
        if (json.label) setLabel(json.label);
      }
    } catch (e: any) {
      setError(e.message || 'Could not read that file.');
    } finally { setBusy(null); }
  }

  async function sweepClubMode() {
    setError(null); setDone(null); setProposed(null);
    setBusy('clubmode');
    try {
      const res = await fetch('/api/calendar/import/clubmode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'parse', year }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if ((json.proposed ?? []).length === 0) {
        setError(`No ClubMode events found for ${year}.`);
        return;
      }
      setProposed(json.proposed);
      setLabel(json.label);
      setKind('clubmode');
      setSource('clubmode');
      setFilename(null);
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  async function commit() {
    if (!proposed) return;
    setBusy('commit'); setError(null);
    try {
      const endpoint = kind === 'clubmode' ? '/api/calendar/import/clubmode' : '/api/calendar/import';
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commit', kind, label, filename, rows: proposed, source, planId, year }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDone(`Added ${json.count} conflicts to the planner.`);
      setProposed(null);
      refresh();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  async function undo(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/calendar/import/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDone(`Removed ${json.removed} entries.`);
      refresh();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  const keeping = proposed?.filter((p) => !p.ignore).length ?? 0;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#001820', color: '#e6f0f3' }}>
      <div className="border-b" style={{ borderColor: '#0d3d4d' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/calendar" className="opacity-70 hover:opacity-100"><ArrowLeft className="w-5 h-5" /></Link>
          <Upload className="w-5 h-5" style={{ color: '#c084fc' }} />
          <h1 className="text-lg font-semibold mr-auto">Import calendars</h1>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg text-sm border"
                  style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }}>
            {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-5">
        {error && (
          <div className="px-3 py-2 rounded-lg text-sm flex items-center justify-between"
               style={{ background: '#4c1d1d', color: '#fecaca' }}>
            {error}<button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}
        {done && (
          <div className="px-3 py-2 rounded-lg text-sm flex items-center justify-between"
               style={{ background: '#14532d', color: '#86efac' }}>
            {done}<button onClick={() => setDone(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {!proposed && (
          <>
            {/* Which calendar is this? Naming the type is what lets the reader
                pull "Divisionals" off a swim grid instead of ignoring it, and
                what stops a league match being filed as a light note. */}
            <div>
              <div className="text-sm font-medium mb-1">What are you uploading?</div>
              <p className="text-xs opacity-60 mb-2">
                Each kind of calendar speaks its own language. Telling us which one you have is the
                difference between reading &ldquo;Divisionals&rdquo; as a club-wide blackout and filing it as a note.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CALENDAR_KINDS.map((k) => (
                  <button key={k.value} onClick={() => setSource(k.value)}
                          className="text-left p-2.5 rounded-lg border"
                          style={source === k.value
                            ? { borderColor: '#c084fc', background: '#c084fc12' }
                            : { borderColor: '#0d3d4d', background: '#002838' }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{k.label}</span>
                      {source === k.value && <Check className="w-3.5 h-3.5" style={{ color: '#c084fc' }} />}
                    </div>
                    <div className="text-[11px] opacity-60 mt-0.5">{k.hint}</div>
                    <div className="text-[11px] opacity-40 mt-0.5 italic">e.g. {k.examples}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={!!busy}
                className="rounded-xl border-2 border-dashed p-6 text-left"
                style={{ borderColor: '#0d3d4d', background: '#002838' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  {busy === 'parse' ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" style={{ color: '#D3FB52' }} />}
                  <span className="font-semibold">Upload a calendar</span>
                </div>
                <p className="text-sm opacity-70">
                  An <code>.ics</code> export, a CSV or spreadsheet paste, or a photo or PDF of the schedule
                  stuck to the fridge. Claude reads the picture ones.
                </p>
                <div className="flex gap-2 mt-2 text-[11px] opacity-50">
                  <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> .ics .csv</span>
                  <span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> .pdf .jpg .png</span>
                </div>
              </button>

              <button
                onClick={sweepClubMode}
                disabled={!!busy}
                className="rounded-xl border p-6 text-left"
                style={{ borderColor: '#0d3d4d', background: '#002838' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  {busy === 'clubmode' ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" style={{ color: '#22d3ee' }} />}
                  <span className="font-semibold">Pull in your ClubMode events</span>
                </div>
                <p className="text-sm opacity-70">
                  No upload needed. Sweeps the tournaments, leagues and JTT match days already in ClubMode
                  for {year} so the planner never books over them.
                </p>
              </button>
            </div>

            <input ref={fileRef} type="file" hidden
                   accept=".ics,.csv,.txt,.tsv,application/pdf,image/*"
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

            <div>
              <h2 className="text-sm uppercase tracking-wide opacity-50 mb-2">What you've imported</h2>
              {imports.length === 0 ? (
                <p className="text-sm opacity-60">Nothing yet. The planner is working from holidays and weather alone.</p>
              ) : (
                <div className="space-y-2">
                  {imports.map((i) => (
                    <div key={i.id} className="flex items-center gap-3 p-3 rounded-lg border"
                         style={{ background: '#002838', borderColor: '#0d3d4d' }}>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{i.label || i.filename || i.kind}</div>
                        <div className="text-xs opacity-50">
                          {i.item_count} entries · {i.kind} · {new Date(i.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <button onClick={() => undo(i.id)} disabled={busy === i.id}
                              className="px-2 py-1 rounded-lg text-xs border flex items-center gap-1"
                              style={{ borderColor: '#7f1d1d', color: '#fca5a5' }}>
                        {busy === i.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        Undo
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {proposed && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                     placeholder="Name this import"
                     className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border text-sm"
                     style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }} />
              <span className="text-sm opacity-60">
                Keeping {keeping} of {proposed.length}
              </span>
              <button onClick={() => setProposed(null)} className="px-3 py-2 rounded-lg border text-sm"
                      style={{ borderColor: '#0d3d4d' }}>Cancel</button>
              <button onClick={commit} disabled={busy === 'commit' || keeping === 0}
                      className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
                      style={{ background: '#D3FB52', color: '#001820' }}>
                {busy === 'commit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Import {keeping}
              </button>
            </div>

            <p className="text-sm opacity-60">
              Everything below is a guess you can change. <strong>Good</strong> means members are MORE available —
              a no-school day is the best junior-camp date of the month, not a conflict.
            </p>

            <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#0d3d4d' }}>
              {proposed.map((p, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 p-3 border-b last:border-0"
                     style={{ borderColor: '#0d3d4d', background: p.ignore ? '#001820' : '#002838', opacity: p.ignore ? 0.45 : 1 }}>
                  <input type="checkbox" checked={!p.ignore}
                         onChange={(e) => setProposed((cur) => cur!.map((x, j) => (j === i ? { ...x, ignore: !e.target.checked } : x)))}
                         className="w-4 h-4" />
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-sm font-medium">{p.title}</div>
                    <div className="text-xs opacity-50">{p.note}</div>
                  </div>
                  <div className="text-xs opacity-70 tabular-nums">
                    {p.starts_on}{p.ends_on !== p.starts_on && ` → ${p.ends_on}`}
                  </div>
                  <div className="flex gap-1">
                    {IMPACTS.map((im) => (
                      <button key={im.value} title={im.hint}
                              onClick={() => setProposed((cur) => cur!.map((x, j) => (j === i ? { ...x, impact: im.value } : x)))}
                              className="px-2 py-1 rounded text-[11px] border"
                              style={p.impact === im.value
                                ? { borderColor: im.color, color: im.color, background: `${im.color}18` }
                                : { borderColor: '#0d3d4d', color: '#7f9aa5' }}>
                        {im.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
