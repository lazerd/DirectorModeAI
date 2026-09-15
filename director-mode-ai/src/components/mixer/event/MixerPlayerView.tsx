'use client';

/**
 * MixerPlayerView — what a player sees on their phone at a rotating-partner
 * mixer (doubles, mixed doubles, maximize-courts).
 *
 * Pick your name once (or open a ?me=<player id> link) and the page answers
 * the only question anyone at the net has: "Round 2: Court 4, you + Carol vs
 * Bill + Ann." Everything is 18px or larger — people read this on a phone,
 * outdoors, often without their glasses. All courts and the standings sit
 * below for anyone who wants them.
 *
 * Data comes from /api/event-board/[eventCode] (service-role read — `matches`
 * isn't readable anonymously) and refreshes every 20 seconds.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Printer, RefreshCw } from 'lucide-react';
import type { EventBoard, BoardPerson } from '@/lib/eventBoard';
import { formatTimeDisplay } from '@/lib/quads';
import PublicRoundTimer from '@/components/mixer/event/PublicRoundTimer';

const REFRESH_MS = 20_000;

const FORMAT_LABELS: Record<string, string> = {
  doubles: 'Doubles mixer',
  'mixed-doubles': 'Mixed doubles mixer',
  'maximize-courts': 'Mixer',
};

export default function MixerPlayerView({ eventCode }: { eventCode: string }) {
  const [board, setBoard] = useState<EventBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string>('');
  const [view, setView] = useState<'mine' | 'all' | 'standings'>('mine');
  const storageKey = `mixer:me:${eventCode.toUpperCase()}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/event-board/${encodeURIComponent(eventCode)}`, { cache: 'no-store' });
      if (!res.ok) {
        setError("We couldn't load this event. Check the code with your organizer.");
        return;
      }
      setBoard(await res.json());
      setError(null);
    } catch {
      setError('No connection — trying again shortly.');
    }
  }, [eventCode]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // A personal link (?me=<player id>) wins; otherwise the name this phone
  // picked last time. Remembering is a convenience, never required.
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get('me');
    if (fromLink) {
      setMe(fromLink);
      return;
    }
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setMe(saved);
    } catch {
      /* private mode */
    }
  }, [storageKey]);

  const choose = (id: string) => {
    setMe(id);
    try {
      if (id) localStorage.setItem(storageKey, id);
      else localStorage.removeItem(storageKey);
    } catch {
      /* private mode */
    }
  };

  // The round to look at right now: the one being played, else the next one.
  const currentRound = useMemo(() => {
    if (!board) return null;
    return (
      board.rounds.find((r) => r.status === 'in_progress')?.round_number ??
      board.rounds.find((r) => r.status === 'upcoming')?.round_number ??
      null
    );
  }, [board]);

  const myRounds = useMemo(() => {
    if (!board || !me) return [];
    return board.rounds.map((round) => {
      const court = round.courts.find((c) => [...c.teamA, ...c.teamB].some((p) => p.id === me));
      if (!court) {
        return { round, sitting: round.sitOuts.some((p) => p.id === me), court: null, partner: [], opponents: [], myScore: null, theirScore: null };
      }
      const onA = court.teamA.some((p) => p.id === me);
      const mine = onA ? court.teamA : court.teamB;
      return {
        round,
        sitting: false,
        court,
        partner: mine.filter((p) => p.id !== me),
        opponents: onA ? court.teamB : court.teamA,
        myScore: onA ? court.scoreA : court.scoreB,
        theirScore: onA ? court.scoreB : court.scoreA,
      };
    });
  }, [board, me]);

  if (error && !board) {
    return (
      <div className="min-h-screen bg-white px-4 py-16">
        <p className="mx-auto max-w-lg text-center text-xl text-gray-900">{error}</p>
      </div>
    );
  }
  if (!board) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="h-10 w-10 animate-spin text-gray-700" />
      </div>
    );
  }

  const { event } = board;
  const myName = board.players.find((p) => p.id === me)?.name;
  const joinNames = (ps: BoardPerson[]) => ps.map((p) => p.name).join(' + ');

  return (
    <div className="min-h-screen bg-white text-gray-900 text-lg">
      <header className="border-b-2 border-gray-900 bg-white">
        <div className="mx-auto max-w-2xl px-4 py-5">
          <p className="text-base font-semibold uppercase tracking-wide text-gray-600">{FORMAT_LABELS[event.match_format] ?? 'Mixer'}</p>
          <h1 className="text-3xl font-black leading-tight">{event.name}</h1>
          <p className="mt-1 text-lg text-gray-700">
            {event.event_date ? format(new Date(event.event_date + 'T00:00:00'), 'EEEE, MMMM d') : ''}
            {event.start_time ? ` · ${formatTimeDisplay(event.start_time)}` : ''}
            {event.venue ? ` · ${event.venue}` : ''}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        {(() => {
          // Timed rounds: the same countdown the old public page showed.
          const live = board.rounds.find((r) => r.status === 'in_progress' && r.start_time);
          return live && event.scoring_format === 'timed' && event.round_length_minutes ? (
            <PublicRoundTimer
              startTime={live.start_time!}
              pausedAt={live.timer_paused_at}
              durationMinutes={event.round_length_minutes}
              roundNumber={live.round_number}
            />
          ) : null;
        })()}
        <div>
          <label htmlFor="wc-me" className="mb-2 block text-xl font-bold">
            Find your name
          </label>
          <select
            id="wc-me"
            value={me}
            onChange={(e) => choose(e.target.value)}
            className="h-14 w-full rounded-xl border-2 border-gray-900 bg-white px-3 text-xl text-gray-900"
          >
            <option value="">— tap to choose —</option>
            {board.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2" role="tablist">
          {(
            [
              ['mine', 'My rounds'],
              ['all', 'All courts'],
              ['standings', 'Standings'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`h-14 rounded-xl border-2 border-gray-900 text-lg font-bold ${
                view === key ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {board.rounds.length === 0 && (
          <p className="rounded-xl border-2 border-dashed border-gray-400 p-5 text-xl">
            The courts haven&apos;t been drawn yet. This page updates on its own.
          </p>
        )}

        {view === 'mine' && board.rounds.length > 0 && (
          !me ? (
            <p className="rounded-xl bg-gray-100 p-5 text-xl">Choose your name above to see your courts and partners.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-xl font-bold">{myName}</p>
              {myRounds.map(({ round, sitting, court, partner, opponents, myScore, theirScore }) => {
                const isNow = round.round_number === currentRound;
                return (
                  <div
                    key={round.round_number}
                    className={`rounded-2xl border-2 p-5 ${isNow ? 'border-gray-900 bg-yellow-50 shadow-md' : 'border-gray-300 bg-white'}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-2xl font-black">
                        Round {round.round_number}
                        {court ? `: Court ${court.court_number}` : ''}
                      </p>
                      {isNow && (
                        <span className="rounded-full bg-gray-900 px-3 py-1 text-base font-bold text-white">
                          {round.status === 'in_progress' ? 'Now' : 'Next'}
                        </span>
                      )}
                    </div>
                    {sitting ? (
                      <p className="mt-2 text-2xl">You&apos;re sitting out this round.</p>
                    ) : court ? (
                      <>
                        <p className="mt-2 text-2xl leading-snug">
                          <span className="font-bold">You{partner.length ? ` + ${joinNames(partner)}` : ''}</span>
                          {!partner.length && opponents.length === 1 && <span className="text-gray-600"> (singles)</span>}
                          <span className="text-gray-600"> vs </span>
                          <span className="font-bold">{joinNames(opponents)}</span>
                        </p>
                        {court.scored && (
                          <p className="mt-2 text-xl">
                            Score: <span className="font-black">{myScore} – {theirScore}</span>
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-2 text-xl text-gray-600">Not in this round.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}

        {view === 'all' &&
          board.rounds.map((round) => (
            <section key={round.round_number} className="space-y-3">
              <h2 className="text-2xl font-black">
                Round {round.round_number}
                {round.round_number === currentRound && (
                  <span className="ml-2 text-lg font-bold text-gray-600">
                    ({round.status === 'in_progress' ? 'now' : 'next'})
                  </span>
                )}
              </h2>
              {round.courts.map((c) => {
                const mineHere = [...c.teamA, ...c.teamB].some((p) => p.id === me);
                return (
                  <div
                    key={c.court_number}
                    className={`rounded-xl border-2 p-4 ${mineHere ? 'border-gray-900 bg-yellow-50' : 'border-gray-300'}`}
                  >
                    <div className="flex items-baseline justify-between">
                      <p className="text-xl font-black">Court {c.court_number}</p>
                      {c.scored && (
                        <p className="text-xl font-black">
                          {c.scoreA} – {c.scoreB}
                        </p>
                      )}
                    </div>
                    <p className="mt-1 text-xl leading-snug">
                      {joinNames(c.teamA)} <span className="text-gray-600">vs</span> {joinNames(c.teamB)}
                    </p>
                  </div>
                );
              })}
              {round.sitOuts.length > 0 && (
                <p className="text-xl">
                  <span className="font-bold">Sitting out:</span> {round.sitOuts.map((p) => p.name).join(', ')}
                </p>
              )}
            </section>
          ))}

        {view === 'standings' &&
          (!board.anyScores ? (
            <p className="rounded-xl bg-gray-100 p-5 text-xl">No scores yet. Standings appear once the first round is scored.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-lg text-gray-700">Ranked on your own: win percentage, then game difference.</p>
              {board.standings.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 rounded-xl border-2 p-3 ${s.id === me ? 'border-gray-900 bg-yellow-50' : 'border-gray-200'}`}
                >
                  <span className="w-14 text-center text-xl font-black">{s.rank}</span>
                  <span className="flex-1 text-xl font-bold">{s.name}</span>
                  <span className="text-right text-lg">
                    <span className="font-black">{s.wins}–{s.losses}</span>
                    <br />
                    <span className="text-gray-600">{s.gamesWon}–{s.gamesLost} games</span>
                  </span>
                </div>
              ))}
            </div>
          ))}

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex h-12 items-center gap-2 rounded-xl border-2 border-gray-900 px-4 text-lg font-bold"
          >
            <RefreshCw className="h-5 w-5" /> Refresh
          </button>
          <a
            href={`/event/${event.event_code}/print`}
            className="inline-flex h-12 items-center gap-2 rounded-xl border-2 border-gray-900 px-4 text-lg font-bold"
          >
            <Printer className="h-5 w-5" /> Printable sheets
          </a>
        </div>
        {error && <p className="text-lg text-red-700">{error}</p>}
      </main>
    </div>
  );
}
