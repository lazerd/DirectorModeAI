'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays, Loader2, Check, X, Trash2, RefreshCw, Sparkles, Lightbulb,
  History, Repeat, ChevronDown, ChevronRight, FileText, Globe, Inbox,
} from 'lucide-react';
import ImportDropzone from './ImportDropzone';
import EventList, { type ListItem, type ListConstraint } from './EventList';

// The whole /calendar surface, as three numbered tiers you read top to bottom:
//
//   1  Add what's already booked   → import calendars so we plan around them
//   2  Pick the events you want     → repeat last year, or add from the library
//   3  Your calendar                → the year, editable
//
// This replaces a header full of ambiguous buttons ("Upload"?) and a hidden
// setup wizard. Every tier says, in plain words, what it is and why it's there.
// Tiers 1 and 2 collapse once the calendar has events so the list (tier 3) is
// what you land on day to day — but the 1-2-3 spine is always visible.

type ImportRow = {
  id: string; kind: string; label: string | null; filename: string | null;
  item_count: number; created_at: string;
};
type RepeatRow = {
  key: string; title: string; occurrences: number; isSeries: boolean;
  note: string; proposedDates: string[];
  match_format: string | null; entry_fee_cents: number | null;
  num_courts: number | null; start_time: string | null;
};
type Plan = { id: string; year: number; name: string; status: string };
type Summary = {
  total: number; projectedRevenueCents: number; flagshipCount: number;
  emptyMonths: number[];
};

const KIND_LABEL: Record<string, string> = {
  school: 'School', swim: 'Swim', usta: 'League', club: 'Club',
  facility: 'Facility', clubmode: 'ClubMode', holiday: 'Holidays', manual: 'Calendar',
};

export default function CalendarTiers({
  plan, year, years, onYear, club, isPro, items, constraints, imports, repeats,
  summary, busy, error, onError, onReload, onOpenItem, onMoveToMonth, onOpenBuild, onPublish,
}: {
  plan: Plan;
  year: number;
  years: number[];
  onYear: (y: number) => void;
  club: { name: string; slug: string } | null;
  isPro: boolean;
  items: ListItem[];
  constraints: ListConstraint[];
  imports: ImportRow[];
  repeats: RepeatRow[] | null;
  summary: Summary | null;
  busy: string | null;
  error: string | null;
  onError: (e: string | null) => void;
  onReload: () => void;
  onOpenItem: (i: ListItem) => void;
  onMoveToMonth: (id: string, month: number) => void;
  onOpenBuild: () => void;
  onPublish: (next: 'published' | 'draft') => void;
}) {
  const hasEvents = items.length > 0;
  // Once there are events, the build tiers fold up so the list is the landing
  // spot — but they stay one click from open.
  const [open1, setOpen1] = useState(!hasEvents);
  const [open2, setOpen2] = useState(!hasEvents);
  // Local to the tier actions (sweep / undo / repeat). The parent's `busy` is
  // for list-row spinners and would flicker the wrong things if shared.
  const [tierBusy, setTierBusy] = useState<string | null>(null);

  return (
    <div style={{ background: '#001820', color: '#e6f0f3' }} className="min-h-screen pb-24">
      {/* Slim header — no action clutter. Actions live in the tier they belong to. */}
      <div className="sticky top-0 z-20 border-b" style={{ background: '#001820e6', backdropFilter: 'blur(8px)', borderColor: '#0d3d4d' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <CalendarDays className="w-5 h-5" style={{ color: '#c084fc' }} />
          <h1 className="text-lg font-semibold">CalendarMode</h1>
          {club && <span className="text-sm opacity-50 hidden sm:inline">· {club.name}</span>}
          {plan.status === 'published' && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background: '#14532d', color: '#86efac' }}>Published</span>
          )}
          <select value={year} onChange={(e) => onYear(Number(e.target.value))}
                  className="ml-auto px-2 py-1.5 rounded-lg text-sm border"
                  style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="max-w-4xl mx-auto px-4 pt-3">
          <div className="px-3 py-2 rounded-lg text-sm flex items-center justify-between"
               style={{ background: '#4c1d1d', color: '#fecaca' }}>
            {error}<button onClick={() => onError(null)}><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {!isPro && (
        <div className="max-w-4xl mx-auto px-4 pt-3">
          <div className="px-3 py-2 rounded-lg text-sm" style={{ background: '#3b2f0b', color: '#fde68a' }}>
            Planning your year is a Pro feature. Browsing event ideas is free —{' '}
            <Link href="/pricing" className="underline">see plans</Link>.
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        {/* ============ TIER 1 ============ */}
        <Tier
          n={1}
          title="Add what's already booked"
          summary={`${imports.length} calendar${imports.length === 1 ? '' : 's'} imported`}
          open={open1}
          onToggle={() => setOpen1((v) => !v)}
        >
          <p className="text-sm opacity-70 mb-3">
            Before we plan your year, tell us what already owns those weekends — your{' '}
            <strong>school district&apos;s calendar</strong>, <strong>USTA league schedules</strong>,{' '}
            <strong>swim meets</strong>, other <strong>club events</strong>. We plan around them, so nothing
            you schedule lands on a date your members can&apos;t make.
          </p>

          <ImportDropzone planId={plan.id} year={year} onImported={onReload} />

          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => sweepClubMode()} disabled={!!tierBusy}
                    className="text-sm px-3 py-1.5 rounded-lg border flex items-center gap-1.5"
                    style={{ borderColor: '#0d3d4d', color: '#e6f0f3' }}>
              {tierBusy === 'sweep' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" style={{ color: '#22d3ee' }} />}
              No file? Pull your ClubMode events for {year}
            </button>
          </div>

          {imports.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {imports.map((imp) => (
                <span key={imp.id} className="inline-flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-full text-xs"
                      style={{ background: '#0d3d4d' }}>
                  <Check className="w-3 h-3" style={{ color: '#86efac' }} />
                  {imp.label || imp.filename || KIND_LABEL[imp.kind] || 'Calendar'}
                  <span className="opacity-50">{imp.item_count}</span>
                  <button onClick={() => undoImport(imp.id)} disabled={tierBusy === imp.id}
                          className="w-5 h-5 grid place-items-center rounded-full hover:bg-white/10" title="Remove this import">
                    {tierBusy === imp.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                  </button>
                </span>
              ))}
            </div>
          )}
        </Tier>

        {/* ============ TIER 2 ============ */}
        <Tier
          n={2}
          title="Pick the events you want to run"
          summary={`${items.length} event${items.length === 1 ? '' : 's'} on your calendar`}
          open={open2}
          onToggle={() => setOpen2((v) => !v)}
        >
          <p className="text-sm opacity-70 mb-3">
            Start with what worked last year, add from our library of popular club events, or let us suggest a
            full slate. We place each one on its best open weekend. Nothing is added until you say so.
          </p>

          {repeats && repeats.length > 0 && (
            <RepeatBlock repeats={repeats} sourceYear={year - 1} busy={tierBusy}
                         onAdd={(picked) => addRepeats(picked)} />
          )}

          <div className="grid gap-2 sm:grid-cols-2 mt-3">
            <button onClick={onOpenBuild}
                    className="rounded-xl border p-3 text-left flex items-start gap-2"
                    style={{ borderColor: '#0d3d4d', background: '#002838' }}>
              <Sparkles className="w-5 h-5 mt-0.5" style={{ color: '#D3FB52' }} />
              <div>
                <div className="font-semibold text-sm">Suggest a full slate</div>
                <div className="text-xs opacity-60">A balanced year for your club, placed and ready to tweak.</div>
              </div>
            </button>
            <Link href="/calendar/ideas"
                  className="rounded-xl border p-3 text-left flex items-start gap-2"
                  style={{ borderColor: '#0d3d4d', background: '#002838' }}>
              <Lightbulb className="w-5 h-5 mt-0.5" style={{ color: '#c084fc' }} />
              <div>
                <div className="font-semibold text-sm">Browse popular events</div>
                <div className="text-xs opacity-60">70+ ideas — Calcutta, the Slam mixers, parent/child, and more.</div>
              </div>
            </Link>
          </div>
        </Tier>

        {/* ============ TIER 3 ============ */}
        <div className="rounded-2xl border" style={{ borderColor: '#0d3d4d', background: '#00212c' }}>
          <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: '#0d3d4d' }}>
            <span className="w-7 h-7 rounded-full grid place-items-center text-sm font-bold shrink-0"
                  style={{ background: '#D3FB52', color: '#001820' }}>3</span>
            <div className="min-w-0">
              <h2 className="font-semibold">Your {year} calendar</h2>
              <p className="text-xs opacity-55">
                {hasEvents
                  ? 'Tap any event to edit it, set reminders, or promote it to a live event. Drag onto a month to move it.'
                  : 'Empty for now — add events in step 2 and they show up here.'}
              </p>
            </div>
            {hasEvents && summary && (
              <div className="ml-auto hidden sm:flex items-baseline gap-4 text-xs">
                <span><strong>{summary.total}</strong> <span className="opacity-50">events</span></span>
                {summary.projectedRevenueCents > 0 && (
                  <span style={{ color: '#86efac' }}>
                    ~${Math.round(summary.projectedRevenueCents / 100).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>

          {hasEvents ? (
            <>
              <div className="pt-2">
                <EventList items={items} constraints={constraints}
                           onOpen={onOpenItem} onMoveToMonth={onMoveToMonth} busyId={busy} />
              </div>
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t" style={{ borderColor: '#0d3d4d' }}>
                <Link href={`/calendar/board?year=${year}`}
                      className="text-sm px-3 py-1.5 rounded-lg border flex items-center gap-1.5"
                      style={{ borderColor: '#0d3d4d' }}>
                  <FileText className="w-4 h-4" /> Board packet
                </Link>
                {plan.status === 'published' ? (
                  <button onClick={() => onPublish('draft')} disabled={busy === 'publish'}
                          className="text-sm px-3 py-1.5 rounded-lg border" style={{ borderColor: '#0d3d4d' }}>
                    Unpublish
                  </button>
                ) : (
                  <button onClick={() => onPublish('published')} disabled={busy === 'publish'}
                          className="text-sm px-3 py-1.5 rounded-lg border flex items-center gap-1.5 ml-auto"
                          style={{ borderColor: '#c084fc', color: '#c084fc' }}>
                    <Globe className="w-4 h-4" /> Publish to members
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="px-4 py-10 text-center opacity-50">
              <Inbox className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No events yet. Step 2 is where they come from.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ---- tier actions (self-contained; reload after) ----
  async function sweepClubMode() {
    onError(null);
    try {
      // setBusy lives in the parent; signal via a fake id the parent maps.
      await withBusy('sweep', async () => {
        const parse = await fetch('/api/calendar/import/clubmode', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'parse', year }),
        });
        const pj = await parse.json();
        if (!parse.ok) throw new Error(pj.error);
        if ((pj.proposed ?? []).length === 0) {
          onError(`No ClubMode events found for ${year}. Upload a file instead.`);
          return;
        }
        const commit = await fetch('/api/calendar/import/clubmode', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'commit', year, planId: plan.id, rows: pj.proposed }),
        });
        if (!commit.ok) throw new Error((await commit.json()).error);
        onReload();
      });
    } catch (e: any) { onError(e.message); }
  }

  async function undoImport(id: string) {
    try {
      await withBusy(id, async () => {
        const res = await fetch(`/api/calendar/import/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json()).error);
        onReload();
      });
    } catch (e: any) { onError(e.message); }
  }

  async function addRepeats(picked: RepeatRow[]) {
    if (picked.length === 0) return;
    try {
      await withBusy('repeat', async () => {
        const res = await fetch('/api/calendar/repeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: plan.id, candidates: picked }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        onReload();
      });
    } catch (e: any) { onError(e.message); }
  }

  async function withBusy(id: string, fn: () => Promise<void>) {
    setTierBusy(id);
    try { await fn(); } finally { setTierBusy(null); }
  }
}

// ============================================================
// Tier shell — numbered, collapsible, with a one-line summary when closed
// ============================================================
function Tier({
  n, title, summary, open, onToggle, children,
}: {
  n: number; title: string; summary: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border" style={{ borderColor: '#0d3d4d', background: '#00212c' }}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="w-7 h-7 rounded-full grid place-items-center text-sm font-bold shrink-0"
              style={{ background: '#c084fc', color: '#001820' }}>{n}</span>
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {!open && <p className="text-xs opacity-50">{summary}</p>}
        </div>
        <span className="ml-auto opacity-50">
          {open ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ============================================================
// Repeat-last-year block
// ============================================================
function RepeatBlock({
  repeats, sourceYear, busy, onAdd,
}: {
  repeats: RepeatRow[]; sourceYear: number; busy: string | null;
  onAdd: (picked: RepeatRow[]) => void;
}) {
  // Series (the backbone of a year) start ticked; one-offs are a judgement call.
  const [picks, setPicks] = useState<Set<string>>(
    () => new Set(repeats.filter((r) => r.isSeries).map((r) => r.key)),
  );

  return (
    <div className="rounded-xl border p-3 mb-1" style={{ background: '#002838', borderColor: '#0d3d4d' }}>
      <div className="flex items-center gap-2 mb-1">
        <History className="w-4 h-4" style={{ color: '#D3FB52' }} />
        <span className="font-semibold text-sm">Repeat what you ran in {sourceYear}</span>
        <span className="ml-auto text-xs opacity-50">{picks.size} selected</span>
      </div>
      <p className="text-xs opacity-55 mb-2">Dates moved to next year&apos;s matching weekend. Weekly events keep their cadence.</p>

      <div className="space-y-1 max-h-56 overflow-y-auto">
        {repeats.map((r) => {
          const on = picks.has(r.key);
          return (
            <label key={r.key} className="flex items-start gap-2.5 p-1.5 rounded-lg cursor-pointer"
                   style={{ opacity: on ? 1 : 0.55 }}>
              <input type="checkbox" checked={on} className="mt-1 w-4 h-4"
                     onChange={(e) => setPicks((cur) => {
                       const next = new Set(cur);
                       if (e.target.checked) next.add(r.key); else next.delete(r.key);
                       return next;
                     })} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium text-sm">{r.title}</span>
                  {r.isSeries && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
                          style={{ background: '#0d3d4d', color: '#9fc0cb' }}>
                      <Repeat className="w-2.5 h-2.5" />×{r.occurrences}
                    </span>
                  )}
                </div>
                <div className="text-[11px] opacity-50">{r.note}</div>
              </div>
            </label>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-2 pt-2 border-t" style={{ borderColor: '#0d3d4d' }}>
        <button onClick={() => setPicks(new Set(repeats.map((r) => r.key)))}
                className="text-xs opacity-70 hover:opacity-100">Select all</button>
        <button onClick={() => setPicks(new Set())}
                className="text-xs opacity-70 hover:opacity-100">Clear</button>
        <button onClick={() => onAdd(repeats.filter((r) => picks.has(r.key)))}
                disabled={!!busy || picks.size === 0}
                className="ml-auto px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40"
                style={{ background: '#D3FB52', color: '#001820' }}>
          {busy === 'repeat' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Repeat className="w-3.5 h-3.5" />}
          Add {picks.size} to my calendar
        </button>
      </div>
    </div>
  );
}
