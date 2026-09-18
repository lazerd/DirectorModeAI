'use client';

/**
 * The draft board — the screen on the wall.
 *
 * Read from across a room by people who are not touching it, so it is built to
 * different rules than the captain's room: no controls, big type, and the two
 * things the room actually shouts about (who is picking, how long they have)
 * given the whole top of the screen.
 *
 * The grid is teams across and rounds down, which is how a fantasy draft board
 * has always been drawn. The snake is visible in it: round one fills left to
 * right, round two right to left, and you can see the turn coming.
 */

import { useEffect, useMemo, useRef } from 'react';
import { formatClock, useLiveDraft, type DraftSnapshot } from './useLiveDraft';

export default function DraftBoard({
  draftId,
  seasonName,
  initial,
}: {
  draftId: string;
  seasonName: string;
  initial: DraftSnapshot;
}) {
  const { snap, pulse, remaining } = useLiveDraft({ draftId, initial });

  const teams = useMemo(
    () => [...snap.teams].sort((a, b) => (a.draftSlot ?? 0) - (b.draftSlot ?? 0)),
    [snap.teams],
  );

  /** pick lookup by team and round, so each cell is O(1). */
  const cells = useMemo(() => {
    const m = new Map<string, (typeof snap.picks)[number]>();
    for (const p of snap.picks) m.set(`${p.team_id}:${p.round_no}`, p);
    return m;
  }, [snap.picks]);

  const onClock = snap.state.on_the_clock_team_id;
  const currentRound = snap.state.current_round_no;
  const clockLow = remaining != null && remaining <= 15;
  const latest = snap.picks.length ? snap.picks[snap.picks.length - 1] : null;

  // Keep the round being picked in view. A board that stops scrolling at round
  // three is a board nobody looks at by round six.
  const activeRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentRound]);

  return (
    <div className="px-5 pb-16 pt-6">
      {/* ---------- the shouty part ---------- */}
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-400">
            {seasonName} · Draft board
            {pulse && <span className="ml-3 text-teal-300">● live</span>}
          </p>
          {snap.state.status === 'complete' ? (
            <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">
              Draft complete.
            </h1>
          ) : snap.state.status === 'live' && onClock ? (
            <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">
              <span className="text-teal-300">
                {teams.find((t) => t.id === onClock)?.name}
              </span>
              <span className="text-white/45"> on the clock</span>
            </h1>
          ) : (
            <h1 className="mt-2 text-4xl font-black tracking-tight text-white/60 sm:text-5xl">
              {snap.state.status === 'paused' ? 'Paused' : 'Waiting to start'}
            </h1>
          )}
          {snap.state.status === 'live' && (
            <p className="mt-2 text-lg text-white/50">
              Pick {snap.state.current_pick_no} of {snap.state.teams * snap.state.rounds} · Round{' '}
              {currentRound}
            </p>
          )}
        </div>

        {snap.state.status === 'live' && (
          <div
            className={`rounded-sm border px-8 py-5 text-center ${
              clockLow ? 'border-red-400/60 bg-red-400/10' : 'border-teal-400/40 bg-teal-400/[0.07]'
            }`}
          >
            <div
              className={`text-6xl font-black tabular-nums sm:text-7xl ${
                clockLow ? 'text-red-300' : 'text-teal-300'
              }`}
            >
              {formatClock(remaining)}
            </div>
          </div>
        )}
      </div>

      {latest && (
        <p className="mx-auto mt-5 max-w-[1600px] text-lg text-white/55">
          Last pick&nbsp;
          <span className="font-bold text-white">{latest.player_name}</span>
          &nbsp;to&nbsp;
          <span className="font-semibold text-teal-300">
            {teams.find((t) => t.id === latest.team_id)?.name}
          </span>
          {latest.is_auto && <span className="ml-2 text-sm text-amber-300/80">(auto-pick)</span>}
        </p>
      )}

      {/* ---------- the grid ---------- */}
      <div className="mx-auto mt-8 max-w-[1600px] overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#0B0F14] pb-3 pr-3 text-left text-xs uppercase tracking-[0.14em] text-white/35">
                Rd
              </th>
              {teams.map((t) => (
                <th
                  key={t.id}
                  className={`pb-3 text-left text-sm font-bold tracking-tight ${
                    t.id === onClock ? 'text-teal-300' : 'text-white/75'
                  }`}
                >
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                    style={{ background: t.color || '#64748B' }}
                    aria-hidden="true"
                  />
                  {t.shortCode}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: snap.state.rounds }, (_, i) => i + 1).map((round) => (
              <tr
                key={round}
                ref={round === currentRound ? activeRow : undefined}
                className="border-t border-white/[0.07]"
              >
                <td className="sticky left-0 z-10 bg-[#0B0F14] py-2.5 pr-3 text-sm tabular-nums text-white/35">
                  {round}
                </td>
                {teams.map((t) => {
                  const pick = cells.get(`${t.id}:${round}`);
                  const isNow =
                    snap.state.status === 'live' && t.id === onClock && round === currentRound;
                  return (
                    <td key={t.id} className="py-2.5 pr-4 align-top">
                      {pick ? (
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white/90">
                            {pick.player_name}
                          </div>
                          <div className="text-[11px] tabular-nums text-white/30">
                            {pick.composite?.toFixed(1) ?? '—'}
                            {pick.is_auto && <span className="ml-1.5 text-amber-300/70">auto</span>}
                          </div>
                        </div>
                      ) : isNow ? (
                        <div className="motion-safe:animate-pulse text-sm font-bold text-teal-300">
                          on the clock
                        </div>
                      ) : (
                        <div className="text-sm text-white/12">—</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
