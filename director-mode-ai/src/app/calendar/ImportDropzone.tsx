'use client';

import { useRef, useState } from 'react';
import { UploadCloud, Loader2, Check, X, FileText, Image as ImageIcon } from 'lucide-react';
import { CALENDAR_KINDS, type CalendarKind } from '@/lib/calendar/classify';

// Tier 1's centerpiece: a drag-and-drop box a first-timer understands without
// being told. Drop a calendar → say what kind it is → confirm the dates it
// found → they become "already booked" so nothing gets planned on top of them.
//
// Everything happens inline here. The old flow sent people to a separate
// /calendar/import page behind an ambiguous "Upload" button, which is exactly
// the "upload what? why?" confusion this replaces.

type Proposed = {
  title: string;
  starts_on: string;
  ends_on: string;
  impact: 'blocking' | 'heavy' | 'light' | 'favorable';
  audience_tags: string[];
  note: string;
  ignore: boolean;
};

const IMPACTS: Array<{ value: Proposed['impact']; label: string; color: string; hint: string }> = [
  { value: 'blocking', label: 'Blocks', color: '#fca5a5', hint: 'Nothing can be scheduled here' },
  { value: 'heavy', label: 'Busy', color: '#fcd34d', hint: 'Members will be away or occupied' },
  { value: 'light', label: 'Minor', color: '#93c5fd', hint: 'Worth noting, small effect' },
  { value: 'favorable', label: 'Good', color: '#86efac', hint: 'Members are MORE available' },
];

/** Best guess at the calendar kind from the file name, so the picker starts right. */
function guessKind(filename: string): CalendarKind {
  const f = filename.toLowerCase();
  if (/swim|meet|aquatic|otter|dolphin|marlin|seal/.test(f)) return 'swim';
  if (/usta|league|jtt|interclub|tri.?level|flight/.test(f)) return 'usta';
  if (/school|district|usd|unified|isd|academic/.test(f)) return 'school';
  if (/golf|dining|social|member|club/.test(f)) return 'club';
  if (/closure|maintenance|resurfac|facility|rental/.test(f)) return 'facility';
  return 'school';
}

export default function ImportDropzone({
  planId, year, onImported,
}: {
  planId: string;
  year: number;
  onImported: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [kind, setKind] = useState<CalendarKind>('school');
  const [filename, setFilename] = useState<string | null>(null);
  const [fileFormat, setFileFormat] = useState<string>('ics');
  const [proposed, setProposed] = useState<Proposed[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File, forcedKind?: CalendarKind) {
    setError(null);
    setProposed(null);
    setFilename(file.name);
    setLabel(file.name.replace(/\.[^.]+$/, ''));
    const k = forcedKind ?? guessKind(file.name);
    setKind(k);
    setBusy('read');

    try {
      const isText = /\.(ics|csv|txt|tsv)$/i.test(file.name);
      if (isText) {
        const content = await file.text();
        const fmt = /\.ics$/i.test(file.name) ? 'ics' : 'csv';
        setFileFormat(fmt);
        const res = await fetch('/api/calendar/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'parse', kind: fmt, content, source: k }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setProposed(json.proposed);
      } else {
        // PDF or photo → Claude reads it.
        const b64 = await toBase64(file);
        setFileFormat(file.type === 'application/pdf' ? 'pdf' : 'image');
        const res = await fetch('/api/calendar/import/vision', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaType: file.type, data: b64, year, kind: k }),
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

  // Re-read the same file when the director corrects the kind, so the
  // classification updates without a fresh upload.
  async function changeKind(next: CalendarKind) {
    setKind(next);
    const f = fileRef.current?.files?.[0];
    if (f && proposed) await handleFile(f, next);
  }

  async function commit() {
    if (!proposed) return;
    setBusy('commit');
    setError(null);
    try {
      const res = await fetch('/api/calendar/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commit', kind: fileFormat, label, filename, rows: proposed, source: kind, planId, year }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      reset();
      onImported();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  function reset() {
    setProposed(null);
    setFilename(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  const keeping = proposed?.filter((p) => !p.ignore).length ?? 0;

  // ---- Review state: the dates it found, confirm before they're saved ----
  if (proposed) {
    return (
      <div className="rounded-2xl border p-4" style={{ background: '#002838', borderColor: '#c084fc55' }}>
        <div className="flex items-center gap-2 mb-1">
          <Check className="w-4 h-4" style={{ color: '#86efac' }} />
          <span className="font-semibold text-sm">Found {proposed.length} dates in {filename}</span>
          <button onClick={reset} className="ml-auto text-xs opacity-60 hover:opacity-100 flex items-center gap-1">
            <X className="w-3.5 h-3.5" /> cancel
          </button>
        </div>
        <p className="text-xs opacity-60 mb-3">
          Untick anything that shouldn&apos;t affect your scheduling. <strong>Good</strong> means members are
          MORE free — a no-school day is a great clinic date, not a conflict.
        </p>

        <div className="max-h-72 overflow-y-auto rounded-xl border divide-y" style={{ borderColor: '#0d3d4d' }}>
          {proposed.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-2"
                 style={{ background: p.ignore ? '#001820' : 'transparent', opacity: p.ignore ? 0.45 : 1 }}>
              <input type="checkbox" checked={!p.ignore}
                     onChange={(e) => setProposed((cur) => cur!.map((x, j) => (j === i ? { ...x, ignore: !e.target.checked } : x)))}
                     className="w-4 h-4" />
              <div className="flex-1 min-w-[150px]">
                <div className="text-sm font-medium">{p.title}</div>
                <div className="text-[11px] opacity-50">{p.note}</div>
              </div>
              <div className="text-[11px] opacity-70 tabular-nums">
                {p.starts_on}{p.ends_on !== p.starts_on && ` → ${p.ends_on}`}
              </div>
              <div className="flex gap-1">
                {IMPACTS.map((im) => (
                  <button key={im.value} title={im.hint}
                          onClick={() => setProposed((cur) => cur!.map((x, j) => (j === i ? { ...x, impact: im.value } : x)))}
                          className="px-1.5 py-1 rounded text-[10px] border"
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

        {error && <div className="text-xs mt-2" style={{ color: '#fca5a5' }}>{error}</div>}

        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs opacity-60 mr-auto">Keeping {keeping} of {proposed.length}</span>
          <button onClick={reset} className="px-3 py-2 rounded-lg text-sm border" style={{ borderColor: '#0d3d4d' }}>
            Cancel
          </button>
          <button onClick={commit} disabled={busy === 'commit' || keeping === 0}
                  className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
                  style={{ background: '#D3FB52', color: '#001820' }}>
            {busy === 'commit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Add {keeping} to my calendar
          </button>
        </div>
      </div>
    );
  }

  // ---- Idle / dragging / reading state ----
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        onClick={() => !busy && fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) fileRef.current?.click(); }}
        className="rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors"
        style={{
          borderColor: dragging ? '#D3FB52' : '#2a5563',
          background: dragging ? '#0d3d4d' : '#00212c',
        }}
      >
        {busy === 'read' ? (
          <>
            <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin" style={{ color: '#D3FB52' }} />
            <p className="font-semibold">Reading {filename}…</p>
            <p className="text-xs opacity-60 mt-1">
              {fileFormat === 'pdf' || fileFormat === 'image' ? 'Claude is reading the dates off it.' : 'Pulling out the dates.'}
            </p>
          </>
        ) : (
          <>
            <UploadCloud className="w-9 h-9 mx-auto mb-2" style={{ color: dragging ? '#D3FB52' : '#5a8a99' }} />
            <p className="font-semibold text-base">
              {dragging ? 'Drop it!' : 'Drag a calendar here, or click to browse'}
            </p>
            <p className="text-sm opacity-60 mt-1 max-w-md mx-auto">
              Your school district&apos;s calendar, a USTA league schedule, the swim team&apos;s meets,
              another club&apos;s events — anything with dates on it.
            </p>
            <div className="flex items-center justify-center gap-3 mt-3 text-[11px] opacity-40">
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> .ics · .csv</span>
              <span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> PDF · photo</span>
            </div>
          </>
        )}
      </div>

      <input ref={fileRef} type="file" hidden
             accept=".ics,.csv,.txt,.tsv,application/pdf,image/*"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

      {/* Kind picker — only relevant once a file is in flight; shown after a read
          so the director can correct a wrong guess and re-read. */}
      {filename && !busy && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="opacity-50">This is a:</span>
          {CALENDAR_KINDS.map((k) => (
            <button key={k.value} onClick={() => changeKind(k.value)}
                    className="px-2 py-1 rounded-lg border"
                    style={kind === k.value
                      ? { borderColor: '#c084fc', color: '#c084fc', background: '#c084fc12' }
                      : { borderColor: '#0d3d4d', color: '#7f9aa5' }}>
              {k.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-2 px-3 py-2 rounded-lg text-sm flex items-center justify-between"
             style={{ background: '#4c1d1d', color: '#fecaca' }}>
          {error}<button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
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
