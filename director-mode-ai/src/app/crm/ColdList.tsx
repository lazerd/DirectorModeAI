'use client';

/**
 * The cold list — 519 clubs, and never one endless scroll.
 *
 * That scroll was the complaint: "it's just a never ending vertical list of
 * people". So this is a table, not a feed. Fifty rows a page, a search box
 * that also matches the people at a club, three filters that answer the
 * questions a rep actually has ("the West ones", "the ones with nobody on
 * file", "the ones I already queued"), and one bulk action.
 *
 * Everything filters in the browser over rows the page already sent — see
 * lib/crm/coldList.ts for why. The only round trip is the queue button.
 *
 * The chosen filters are remembered per browser, which at two reps means per
 * rep. Wrapped in try/catch both ways: a blocked localStorage costs the memory
 * of a filter, not the list.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ageLabel, type ISODate } from '@/lib/crm/dates';
import {
  DEFAULT_FILTERS,
  coerceFilters,
  coldSummary,
  filterCold,
  PAGE_SIZE,
  type ColdFilters,
} from '@/lib/crm/coldList';
import { STAGES, STAGE_LABEL } from '@/lib/crm/stages';
import type { ColdRow } from '@/lib/crm/types';

const FILTER_KEY = 'crm:cold-filters';

const CONTROL =
  'rounded-lg border border-white/10 bg-[#001820] px-2.5 py-1.5 text-xs text-white focus:border-[#D3FB52]/50 focus:outline-none';

export default function ColdList({
  rows,
  regions,
  today,
}: {
  rows: ColdRow[];
  regions: string[];
  today: ISODate;
}) {
  const router = useRouter();
  // null until the saved filters are read, so the server HTML and the first
  // client render agree.
  const [filters, setFilters] = useState<ColdFilters | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Queue state is echoed here so a press shows immediately; the server copy
  // arrives on the next refresh.
  const [queuedNow, setQueuedNow] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    let saved: unknown = null;
    try {
      const raw = window.localStorage.getItem(FILTER_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      // Blocked or corrupt — the defaults below are a fine list.
    }
    setFilters(saved ? coerceFilters(saved) : { ...DEFAULT_FILTERS });
  }, []);

  const update = useCallback((patch: Partial<ColdFilters>) => {
    setFilters((f) => {
      const base = f ?? DEFAULT_FILTERS;
      // Any change but a page change goes back to page one: page 7 of a new
      // filter is almost always an empty screen.
      const next: ColdFilters = { ...base, ...patch, page: 'page' in patch ? (patch.page as number) : 0 };
      try {
        window.localStorage.setItem(FILTER_KEY, JSON.stringify(next));
      } catch {
        // Not remembering it is survivable; not applying it is not.
      }
      return next;
    });
  }, []);

  const page = useMemo(() => filterCold(rows, filters ?? DEFAULT_FILTERS), [rows, filters]);

  const isQueued = useCallback(
    (r: ColdRow) => queuedNow.get(r.id) ?? !!r.queued_at,
    [queuedNow],
  );

  async function queue(unqueue: boolean) {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/crm/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_ids: ids, unqueue }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setNote(String(j.error ?? 'That did not work.'));
        return;
      }
      setQueuedNow((m) => {
        const next = new Map(m);
        for (const id of ids) next.set(id, !unqueue);
        return next;
      });
      setSelected(new Set());
      setNote(String(j.message ?? 'Done.'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!filters) return <div className="h-64" aria-hidden />;

  const pageIds = page.rows.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedQueued = [...selected].filter((id) => {
    const r = rows.find((x) => x.id === id);
    return r ? isQueued(r) : false;
  }).length;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div id="cold">
      {/* ------------------------------------------------------- controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Search a club, a name, an address"
          aria-label="Search the cold list"
          className={`${CONTROL} min-w-0 flex-1 basis-full py-2 sm:basis-64`}
        />
        <select
          value={filters.region}
          onChange={(e) => update({ region: e.target.value })}
          aria-label="Region"
          className={CONTROL}
        >
          <option value="">Any region</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={filters.hasContact}
          onChange={(e) => update({ hasContact: e.target.value as ColdFilters['hasContact'] })}
          aria-label="Contacts"
          className={CONTROL}
        >
          <option value="any">Anyone or nobody</option>
          <option value="yes">Has a contact</option>
          <option value="no">Nobody on file</option>
        </select>
        <select
          value={filters.stage}
          onChange={(e) => update({ stage: e.target.value as ColdFilters['stage'] })}
          aria-label="Stage"
          className={CONTROL}
        >
          <option value="">Any stage</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          value={filters.sort}
          onChange={(e) => update({ sort: e.target.value as ColdFilters['sort'] })}
          aria-label="Sort"
          className={CONTROL}
        >
          <option value="name">By name</option>
          <option value="contacts">Most contacts</option>
          <option value="touched">Last touched</option>
        </select>
        {(filters.q || filters.region || filters.hasContact !== 'any' || filters.stage) && (
          <button
            type="button"
            onClick={() => update({ q: '', region: '', hasContact: 'any', stage: '' })}
            className="text-xs text-white/40 underline-offset-2 hover:text-white hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/35">
        <span>{coldSummary(page.total, rows.length)}</span>
        {page.pageCount > 1 && (
          <span>
            Page {page.page + 1} of {page.pageCount}
          </span>
        )}
      </div>

      {/* --------------------------------------------------- bulk action */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#D3FB52]/25 bg-[#002838] p-2.5">
          <span className="text-xs font-semibold text-white">
            {selected.size} selected
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => queue(false)}
            className="rounded-lg bg-[#D3FB52] px-3 py-1.5 text-xs font-semibold text-[#001820] disabled:opacity-40"
          >
            {busy ? 'Queueing…' : 'Add to the outreach queue'}
          </button>
          {selectedQueued > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => queue(true)}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white"
            >
              Take out
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-white/40 hover:text-white"
          >
            Clear
          </button>
          {page.total > pageIds.length && (
            <button
              type="button"
              onClick={() => setSelected(new Set(page.matchedIds))}
              className="ml-auto text-xs text-white/40 hover:text-white"
            >
              Select all {page.total} that match
            </button>
          )}
        </div>
      )}
      {note && <p className="mt-2 text-xs text-[#D3FB52]">{note}</p>}

      {/* ------------------------------------------------------ the table */}
      {page.total === 0 ? (
        <p className="mt-8 text-sm text-white/35">Nothing matches that. Try clearing a filter.</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.08] bg-[#002838]">
          {/* Header row. Hidden on a phone, where each row is its own block. */}
          <div className="hidden items-center gap-3 border-b border-white/[0.06] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/30 sm:flex">
            <input
              type="checkbox"
              checked={allOnPageSelected}
              onChange={() =>
                setSelected((s) => {
                  const next = new Set(s);
                  if (allOnPageSelected) for (const id of pageIds) next.delete(id);
                  else for (const id of pageIds) next.add(id);
                  return next;
                })
              }
              aria-label="Select this page"
              className="accent-[#D3FB52]"
            />
            <span className="flex-1">Club</span>
            <span className="w-24">Region</span>
            <span className="w-16 text-right">Contacts</span>
            <span className="w-28">Last touch</span>
            <span className="w-24">Stage</span>
          </div>

          <ul className="divide-y divide-white/[0.05]">
            {page.rows.map((r) => {
              const queued = isQueued(r);
              return (
                <li
                  key={r.id}
                  className={`flex items-start gap-3 px-3 py-2.5 text-sm sm:items-center ${
                    selected.has(r.id) ? 'bg-[#D3FB52]/[0.05]' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    aria-label={`Select ${r.name}`}
                    className="mt-1 accent-[#D3FB52] sm:mt-0"
                  />
                  <div className="min-w-0 flex-1">
                    <Link href={`/crm/${r.id}`} className="font-medium text-white hover:text-[#D3FB52]">
                      {r.name}
                    </Link>
                    {queued && (
                      <span className="ml-2 rounded bg-[#D3FB52]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#D3FB52]">
                        Queued
                      </span>
                    )}
                    {r.contact_count === 0 && (
                      <span className="ml-2 text-[11px] text-amber-300/70">no contact</span>
                    )}
                    {/* The same facts, stacked, on a phone. */}
                    <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11px] text-white/35 sm:hidden">
                      <span>{r.region ?? 'no region'}</span>
                      {r.state && <span>{r.state}</span>}
                      <span>
                        {r.contact_count} contact{r.contact_count === 1 ? '' : 's'}
                      </span>
                      <span>{ageLabel(r.last_activity_at, today) ?? 'never touched'}</span>
                      <span>{STAGE_LABEL[r.stage]}</span>
                    </div>
                  </div>
                  <span className="hidden w-24 text-xs text-white/45 sm:block">{r.region ?? '—'}</span>
                  <span className="hidden w-16 text-right text-xs text-white/45 sm:block">{r.contact_count}</span>
                  <span className="hidden w-28 text-xs text-white/35 sm:block">
                    {ageLabel(r.last_activity_at, today) ?? 'never'}
                  </span>
                  <span className="hidden w-24 text-xs text-white/45 sm:block">{STAGE_LABEL[r.stage]}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------------- paging */}
      {page.pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={page.page === 0}
            onClick={() => update({ page: page.page - 1 })}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white disabled:opacity-25"
          >
            ← Back
          </button>
          <span className="text-[11px] text-white/30">
            {page.page * PAGE_SIZE + 1}–{Math.min(page.total, (page.page + 1) * PAGE_SIZE)} of {page.total}
          </span>
          <button
            type="button"
            disabled={page.page >= page.pageCount - 1}
            onClick={() => update({ page: page.page + 1 })}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white disabled:opacity-25"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
