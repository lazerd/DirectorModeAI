'use client';

/**
 * /crm — three things, in this order: Today, Live deals, the cold list.
 *
 * The order is the argument. Today is the work; Live deals is the handful of
 * real ones; the cold list is 519 clubs you go looking through, not something
 * that should be the first thing you see. Before this, all 522 rows were one
 * board and one scroll, which is what Darrin was complaining about.
 *
 * Which view a rep had open is remembered, so someone who lives in the cold
 * list does not land on Today every morning — but Today is the default the
 * first time, because it is the answer to "what now".
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ISODate } from '@/lib/crm/dates';
import type { TodayList } from '@/lib/crm/today';
import type { Stage } from '@/lib/crm/stages';
import type { ColdRow, OrgCard } from '@/lib/crm/types';
import AskBox from './AskBox';
import ColdList from './ColdList';
import PipelineBoard, { type Rep } from './PipelineBoard';

const VIEW_KEY = 'crm:workspace-view';

type View = 'today' | 'live' | 'cold';

export default function CrmWorkspace({
  today,
  todayDate,
  live,
  cold,
  regions,
  reps,
  byStage,
}: {
  today: TodayList;
  todayDate: ISODate;
  live: OrgCard[];
  cold: ColdRow[];
  regions: string[];
  reps: Rep[];
  byStage: { stage: Stage; count: number }[];
}) {
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(VIEW_KEY);
    } catch {
      // Private browsing or blocked storage. Today is a fine default.
    }
    setView(saved === 'live' || saved === 'cold' ? saved : 'today');
  }, []);

  function pick(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Forgetting the choice is survivable; not switching is not.
    }
  }

  const tabs: { id: View; label: string; count: number | null }[] = [
    { id: 'today', label: 'Today', count: today.items.length || null },
    { id: 'live', label: 'Live deals', count: live.length },
    { id: 'cold', label: 'Cold list', count: cold.length },
  ];

  return (
    <div>
      {/* The ask box is above the tabs on purpose: it answers across all
          three, and a question is usually faster than finding the view. */}
      <div className="mt-5">
        <AskBox />
      </div>

      <nav
        className="mt-6 flex gap-1 overflow-x-auto border-b border-white/[0.08]"
        role="tablist"
        aria-label="Pipeline views"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={view === t.id}
            onClick={() => pick(t.id)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${
              view === t.id
                ? 'border-[#D3FB52] text-white'
                : 'border-transparent text-white/40 hover:text-white/70'
            }`}
          >
            {t.label}
            {t.count != null && <span className="ml-1.5 text-xs text-white/30">{t.count}</span>}
          </button>
        ))}
      </nav>

      {view === null ? (
        <div className="h-64" aria-hidden />
      ) : view === 'today' ? (
        <Today list={today} />
      ) : view === 'live' ? (
        <div id="live" className="mt-5">
          {live.length === 0 ? (
            <p className="text-sm text-white/35">
              No live deals yet. A club becomes one the moment you log something against it or move it off
              Researching.
            </p>
          ) : (
            <PipelineBoard orgs={live} reps={reps} today={todayDate} byStage={byStage} />
          )}
        </div>
      ) : (
        <div className="mt-5">
          <ColdList rows={cold} regions={regions} today={todayDate} />
        </div>
      )}
    </div>
  );
}

/**
 * Today — sentences with one tap each.
 *
 * Every line names a club and carries the one obvious move. Nothing here is a
 * chart or a count for its own sake: if there is nothing to do, it says so in
 * one line rather than drawing an empty dashboard.
 */
function Today({ list }: { list: TodayList }) {
  if (!list.items.length) {
    return (
      <div className="mt-6 rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
        <p className="text-sm text-white/70">Nothing is late and nothing is due.</p>
        <p className="mt-1 text-sm text-white/35">
          Good time to work the cold list — pick a region and find the racquets director at a few clubs.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-5 space-y-2">
      {list.items.map((item, i) => {
        const tone =
          item.tone === 'late'
            ? 'border-red-400/25 bg-red-400/[0.04]'
            : item.tone === 'today'
              ? 'border-[#D3FB52]/25 bg-[#D3FB52]/[0.04]'
              : 'border-white/[0.08] bg-[#002838]';
        const dot =
          item.tone === 'late'
            ? 'bg-red-400'
            : item.tone === 'today'
              ? 'bg-[#D3FB52]'
              : item.tone === 'info'
                ? 'bg-sky-300/60'
                : 'bg-white/25';
        return (
          <li
            key={i}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3 ${tone}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
            <span className="min-w-0 flex-1 text-sm leading-snug text-white/85">{item.text}</span>
            <Link
              href={item.href}
              className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-[#D3FB52]/50 hover:text-white"
            >
              {item.actionLabel}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
