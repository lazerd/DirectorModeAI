'use client';

/**
 * The confirm step for promotion and relegation.
 *
 * Deliberately two-stage, with the consequence spelled out. This is the one
 * commissioner control whose mistake is public and permanent — a team told they
 * were relegated when they weren't will remember it — so it shows the record
 * each decision rests on, warns loudly when the season isn't finished, and
 * makes overriding that warning a separate, differently-coloured click.
 */

import { useState } from 'react';
import { toast } from 'sonner';

type Row = {
  teamId: string;
  teamName: string;
  direction: 'promoted' | 'relegated';
  from: string;
  to: string;
  record: string;
  rank: string;
};

export default function MovementsPanel({
  seasonId,
  seasonSlug,
  rows,
  unplayed,
  alreadyRecorded,
}: {
  seasonId: string;
  seasonSlug: string;
  rows: Row[];
  unplayed: number;
  alreadyRecorded: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [needsForce, setNeedsForce] = useState(false);
  const [done, setDone] = useState(alreadyRecorded);

  async function confirm(force = false) {
    setBusy(true);
    try {
      const res = await fetch('/api/ptl/admin/movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonId, action: 'confirm', force }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.needsForce) setNeedsForce(true);
        toast.error(body.error || 'That did not work.');
        return;
      }
      toast.success(`${body.recorded} movements recorded. Season closed.`);
      setDone(true);
    } catch {
      toast.error('Lost the connection.');
    } finally {
      setBusy(false);
    }
  }

  if (!rows.length) {
    return (
      <p className="mt-10 rounded-sm border border-white/10 bg-white/[0.03] px-6 py-8 text-white/55">
        Nothing to move yet — divisions need at least two teams and a played table.
      </p>
    );
  }

  return (
    <div className="mt-10">
      {unplayed > 0 && (
        <p className="mb-6 rounded-sm border border-amber-400/40 bg-amber-400/10 px-5 py-4 text-sm text-amber-100">
          <strong className="font-bold">
            {unplayed} meeting{unplayed === 1 ? '' : 's'} still unplayed.
          </strong>{' '}
          These standings are not final. Finish the season first unless you have a reason not to.
        </p>
      )}

      <ul className="space-y-px">
        {rows.map((r) => (
          <li
            key={r.teamId}
            className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/[0.07] py-4 pl-4 ${
              r.direction === 'promoted'
                ? 'border-l-2 border-l-teal-400'
                : 'border-l-2 border-l-amber-400'
            }`}
          >
            <span
              className={`text-[11px] font-bold uppercase tracking-wider ${
                r.direction === 'promoted' ? 'text-teal-300' : 'text-amber-300'
              }`}
            >
              {r.direction === 'promoted' ? 'Up' : 'Down'}
            </span>
            <span className="font-bold">{r.teamName}</span>
            <span className="text-sm text-white/55">
              {r.from} &rarr; <span className="text-white/80">{r.to}</span>
            </span>
            <span className="ml-auto text-sm tabular-nums text-white/45">
              finished {r.rank} · {r.record}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-8">
        {done ? (
          <p className="text-sm font-semibold text-teal-300">Recorded. {seasonSlug} is closed.</p>
        ) : (
          <button
            onClick={() => confirm(needsForce)}
            disabled={busy}
            className={`rounded-sm px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35 ${
              needsForce
                ? 'bg-amber-300 text-[#2a1e00] hover:bg-amber-200'
                : 'bg-teal-400 text-[#06231F] hover:bg-teal-300'
            }`}
          >
            {busy
              ? 'Recording…'
              : needsForce
                ? 'Confirm anyway — season is unfinished'
                : 'Confirm and close the season'}
          </button>
        )}
      </div>
    </div>
  );
}
