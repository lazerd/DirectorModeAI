'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Plus, Loader2, Check, Lightbulb, X } from 'lucide-react';
import type { CatalogEntry } from '@/lib/calendar/types';

// The idea browser. Filter the library, read the detail a director actually
// needs (courts, staffing, food, prizes, and the tips that usually only live in
// the head of whoever ran it last year), and add it to the plan — at which
// point the engine proposes a date.

const DEPT_COLOR: Record<string, string> = {
  tennis: '#eab308', pickleball: '#22d3ee', swim: '#38bdf8',
  fitness: '#a78bfa', social: '#fb923c', other: '#94a3b8',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AUDIENCES = ['adult', 'junior', 'family', 'ladies', 'men', 'mixed', 'member-guest', 'senior'];
const DEPARTMENTS = ['tennis', 'pickleball', 'swim', 'fitness', 'social', 'other'];

export default function IdeasClient({
  catalog, groups,
}: { catalog: CatalogEntry[]; groups: Array<{ label: string; keys: string[] }> }) {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState<string>('');
  const [aud, setAud] = useState<string>('');
  const [month, setMonth] = useState<number>(0);
  const [detail, setDetail] = useState<CatalogEntry | null>(null);

  const [planId, setPlanId] = useState<string | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear() + 1);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the current plan so "add to plan" has somewhere to go. Failing
  // quietly is correct here: a signed-out visitor should still get the library.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/calendar/plan?year=${year}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        setPlanId(json.plan?.id ?? null);
        setAdded(new Set((json.items ?? []).map((i: any) => i.catalog_key).filter(Boolean)));
      } catch { /* browsing works without a plan */ }
    })();
  }, [year]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.filter((c) => {
      if (dept && c.department !== dept) return false;
      if (aud && !c.audience.includes(aud as any) && !c.audience.includes('all')) return false;
      if (month && c.idealMonths.length > 0 && !c.idealMonths.includes(month)) return false;
      if (needle && !`${c.title} ${c.tagline} ${c.description}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [catalog, q, dept, aud, month]);

  const byKey = useMemo(() => new Map(catalog.map((c) => [c.key, c])), [catalog]);
  const visible = useMemo(() => new Set(filtered.map((c) => c.key)), [filtered]);

  async function add(key: string) {
    if (!planId) { setError('Open the calendar first so there is a plan to add to.'); return; }
    setAdding(key); setError(null);
    try {
      const res = await fetch('/api/calendar/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, catalogKey: key }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setAdded((s) => new Set(s).add(key));
    } catch (e: any) { setError(e.message); } finally { setAdding(null); }
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#001820', color: '#e6f0f3' }}>
      <div className="sticky top-0 z-20 border-b" style={{ background: '#001820e6', backdropFilter: 'blur(8px)', borderColor: '#0d3d4d' }}>
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/calendar" className="opacity-70 hover:opacity-100"><ArrowLeft className="w-5 h-5" /></Link>
            <Lightbulb className="w-5 h-5" style={{ color: '#D3FB52' }} />
            <h1 className="text-lg font-semibold mr-auto">Event ideas</h1>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                    className="px-2 py-1.5 rounded-lg text-sm border"
                    style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }}>
              {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder="Search 70+ event concepts…"
                     className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm"
                     style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }} />
            </div>
            <Pills value={dept} onChange={setDept} options={DEPARTMENTS} label="Any department" />
            <Pills value={aud} onChange={setAud} options={AUDIENCES} label="Anyone" />
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                    className="px-3 py-2 rounded-lg border text-sm"
                    style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }}>
              <option value={0}>Any month</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>

          <div className="text-xs opacity-50 mt-2">
            {filtered.length} of {catalog.length} ideas
          </div>
        </div>
      </div>

      {error && (
        <div className="max-w-6xl mx-auto px-4 pt-3">
          <div className="px-3 py-2 rounded-lg text-sm flex items-center justify-between"
               style={{ background: '#4c1d1d', color: '#fecaca' }}>
            {error}<button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 pt-5 space-y-7">
        {groups.map((g) => {
          const entries = g.keys.map((k) => byKey.get(k)!).filter((c) => c && visible.has(c.key));
          if (entries.length === 0) return null;
          return (
            <section key={g.label}>
              <h2 className="text-sm uppercase tracking-wide opacity-50 mb-2">{g.label}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {entries.map((c) => (
                  <IdeaCard key={c.key} entry={c} added={added.has(c.key)}
                            adding={adding === c.key} onAdd={() => add(c.key)} onOpen={() => setDetail(c)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {detail && (
        <DetailPanel entry={detail} added={added.has(detail.key)} adding={adding === detail.key}
                     onAdd={() => add(detail.key)} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

function Pills({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm capitalize"
            style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function IdeaCard({ entry, added, adding, onAdd, onOpen }: {
  entry: CatalogEntry; added: boolean; adding: boolean; onAdd: () => void; onOpen: () => void;
}) {
  const color = DEPT_COLOR[entry.department] ?? DEPT_COLOR.other;
  return (
    <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ background: '#002838', borderColor: '#0d3d4d' }}>
      <button onClick={onOpen} className="text-left">
        <div className="flex items-start gap-2">
          <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
          <div>
            <h3 className="font-semibold leading-tight">{entry.title}</h3>
            <p className="text-xs opacity-60 mt-0.5">{entry.tagline}</p>
          </div>
        </div>
      </button>

      <div className="flex flex-wrap gap-1 text-[10px]">
        {entry.audience.slice(0, 3).map((a) => (
          <span key={a} className="px-1.5 py-0.5 rounded" style={{ background: '#0d3d4d' }}>{a}</span>
        ))}
        {entry.idealMonths.length > 0 && (
          <span className="px-1.5 py-0.5 rounded" style={{ background: '#0d3d4d' }}>
            {entry.idealMonths.map((m) => MONTHS[m - 1]).join('/')}
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded capitalize" style={{ background: '#0d3d4d' }}>{entry.effort}</span>
      </div>

      <button onClick={onAdd} disabled={added || adding}
              className="mt-auto px-2.5 py-1.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
              style={added ? { background: '#14532d', color: '#86efac' } : { background: '#D3FB52', color: '#001820' }}>
        {adding ? <Loader2 className="w-4 h-4 animate-spin" />
          : added ? <><Check className="w-4 h-4" /> On the calendar</>
          : <><Plus className="w-4 h-4" /> Add to plan</>}
      </button>
    </div>
  );
}

function DetailPanel({ entry, added, adding, onAdd, onClose }: {
  entry: CatalogEntry; added: boolean; adding: boolean; onAdd: () => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: '#00121899' }} onClick={onClose}>
      <div className="w-full max-w-md h-full overflow-y-auto border-l"
           style={{ background: '#002838', borderColor: '#0d3d4d' }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 p-4 border-b flex items-start gap-3"
             style={{ background: '#002838', borderColor: '#0d3d4d' }}>
          <div className="flex-1">
            <h3 className="font-semibold">{entry.title}</h3>
            <p className="text-xs opacity-60">{entry.tagline}</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 opacity-60" /></button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          <p className="opacity-85">{entry.description}</p>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <Fact label="Department" value={entry.department} />
            <Fact label="For" value={entry.audience.join(', ')} />
            <Fact label="Courts" value={String(entry.courtsNeeded)} />
            <Fact label="Staff" value={String(entry.staffNeeded)} />
            <Fact label="Runs" value={`${Math.round(entry.durationMinutes / 60)} hrs`} />
            <Fact label="Effort" value={entry.effort} />
            <Fact label="Typical fee" value={entry.typicalFeeCents ? `$${(entry.typicalFeeCents / 100).toFixed(0)}` : 'free'} />
            <Fact label="Expect" value={`${entry.typicalAttendance} people`} />
          </div>

          {entry.fb && <Section title="Food & drink" body={entry.fb} />}
          {entry.prize && <Section title="Prizes" body={entry.prize} />}

          {entry.tips.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide opacity-50 mb-1.5">Running it well</div>
              <ul className="space-y-1.5">
                {entry.tips.map((t, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span style={{ color: '#D3FB52' }}>·</span>
                    <span className="opacity-85">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="p-4 border-t" style={{ borderColor: '#0d3d4d' }}>
          <button onClick={onAdd} disabled={added || adding}
                  className="w-full px-3 py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                  style={added ? { background: '#14532d', color: '#86efac' } : { background: '#D3FB52', color: '#001820' }}>
            {adding ? <Loader2 className="w-4 h-4 animate-spin" />
              : added ? <><Check className="w-4 h-4" /> Already on the calendar</>
              : <><Plus className="w-4 h-4" /> Add to the plan</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-lg" style={{ background: '#001820' }}>
      <div className="opacity-50">{label}</div>
      <div className="capitalize">{value}</div>
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide opacity-50 mb-1">{title}</div>
      <p className="opacity-85">{body}</p>
    </div>
  );
}
