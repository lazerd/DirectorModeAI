'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type MatchPlayer = {
  id: string;
  name: string;
  rating: number | null;
  isSub: boolean;
  hasEmail: boolean;
  availability: 'yes' | 'no' | 'maybe' | null;
};

type Court = {
  id?: string;
  courtNumber: number;
  courtType: 'singles' | 'doubles';
  player1Id: string | null;
  player2Id: string | null;
  player1Confirmed?: boolean;
  player2Confirmed?: boolean;
  notes?: string[];
};

const btn = 'px-4 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 transition';
const primary = `${btn} bg-[#D3FB52] text-[#001820] hover:brightness-95`;
const ghost = `${btn} border border-white/10 text-white/70 hover:text-white hover:border-white/25`;

export default function MatchWorkspace({
  teamId,
  matchId,
  players,
  initialLineup,
  singlesCourts,
  doublesCourts,
  lineupSent,
  status,
  initialResults,
}: {
  teamId: string;
  matchId: string;
  players: MatchPlayer[];
  initialLineup: Court[];
  singlesCourts: number;
  doublesCourts: number;
  lineupSent: boolean;
  matchAt: string;
  status: string;
  initialResults: { courtNumber: number; score: string | null; won: boolean | null }[];
}) {
  const router = useRouter();
  const [courts, setCourts] = useState<Court[]>(initialLineup);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [scoring, setScoring] = useState(status === 'played');
  const [scores, setScores] = useState<Record<number, { score: string; won: boolean | null }>>(
    Object.fromEntries(
      initialResults.map((r) => [r.courtNumber, { score: r.score ?? '', won: r.won }]),
    ),
  );

  const yes = players.filter((p) => p.availability === 'yes');
  const no = players.filter((p) => p.availability === 'no');
  const maybe = players.filter((p) => p.availability === 'maybe');
  const silent = players.filter((p) => !p.isSub && p.availability === null);
  const needed = singlesCourts + doublesCourts * 2;

  const nameOf = (id: string | null) => (id ? players.find((p) => p.id === id)?.name ?? '—' : '—');

  async function call(
    action: string,
    url: string,
    body: Record<string, unknown>,
    onOk?: (j: Record<string, unknown>) => void,
  ) {
    setBusy(action);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError((j.error as string) || 'Something went wrong.');
        return;
      }
      onOk?.(j);
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(null);
    }
  }

  const sendPoll = (onlyMissing: boolean) =>
    call(
      onlyMissing ? 'nudge' : 'poll',
      '/api/captain/poll',
      { team_id: teamId, match_id: matchId, only_missing: onlyMissing },
      (j) => setNote(`Asked ${j.sent as number} ${(j.sent as number) === 1 ? 'player' : 'players'}.`),
    );

  const generate = () =>
    call('generate', '/api/captain/lineup', { action: 'generate', team_id: teamId, match_id: matchId }, (j) => {
      setCourts((j.courts as Court[]) || []);
      setWarnings((j.warnings as string[]) || []);
      setDirty(true);
      setNote('Lineup proposed — review it, then save.');
    });

  const save = () =>
    call(
      'save',
      '/api/captain/lineup',
      {
        action: 'save',
        team_id: teamId,
        match_id: matchId,
        courts: courts.map((c) => ({
          courtNumber: c.courtNumber,
          courtType: c.courtType,
          player1Id: c.player1Id,
          player2Id: c.player2Id,
        })),
      },
      () => {
        setDirty(false);
        setNote('Lineup saved.');
        router.refresh();
      },
    );

  const send = () =>
    call('send', '/api/captain/lineup', { action: 'send', team_id: teamId, match_id: matchId }, (j) => {
      setNote(`Lineup emailed to ${j.sent as number} players.`);
      router.refresh();
    });

  const findSub = (court: Court, slot: 1 | 2) => {
    const dropped = slot === 1 ? court.player1Id : court.player2Id;
    return call(
      `sub-${court.courtNumber}-${slot}`,
      '/api/captain/subs',
      {
        team_id: teamId,
        match_id: matchId,
        lineup_id: court.id,
        slot,
        dropped_player_id: dropped,
      },
      (j) => {
        setNote(`Asked ${j.asked as number} subs — first to claim gets the spot.`);
        router.refresh();
      },
    );
  };

  const saveResults = (markPlayed: boolean) =>
    call(
      markPlayed ? 'play' : 'scores',
      '/api/captain/results',
      {
        team_id: teamId,
        match_id: matchId,
        mark_played: markPlayed,
        results: courts.map((c) => ({
          court_number: c.courtNumber,
          score: scores[c.courtNumber]?.score ?? null,
          won: scores[c.courtNumber]?.won ?? null,
        })),
      },
      (j) => {
        setNote(
          markPlayed
            ? `Match recorded${j.teamResult ? ` — ${j.teamResult as string}` : ''}. Eligibility and partnership records updated.`
            : 'Scores saved.',
        );
        router.refresh();
      },
    );

  function setScore(courtNumber: number, patch: Partial<{ score: string; won: boolean | null }>) {
    setScores((s) => ({
      ...s,
      [courtNumber]: { ...{ score: '', won: null }, ...s[courtNumber], ...patch },
    }));
  }

  function setSlot(courtNumber: number, slot: 1 | 2, playerId: string | null) {
    setCourts((cs) =>
      cs.map((c) =>
        c.courtNumber === courtNumber
          ? { ...c, [slot === 1 ? 'player1Id' : 'player2Id']: playerId }
          : c,
      ),
    );
    setDirty(true);
  }

  /** Players not already placed elsewhere in the lineup. */
  const optionsFor = (court: Court, slot: 1 | 2) => {
    const current = slot === 1 ? court.player1Id : court.player2Id;
    const used = new Set(
      courts
        .flatMap((c) => [
          c.courtNumber === court.courtNumber && slot === 1 ? null : c.player1Id,
          c.courtNumber === court.courtNumber && slot === 2 ? null : c.player2Id,
        ])
        .filter(Boolean) as string[],
    );
    return players.filter((p) => p.id === current || !used.has(p.id));
  };

  return (
    <div className="mt-8 space-y-8">
      {/* ---------------------------------------------------------- availability */}
      <section>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-display text-white">Availability</h2>
          <div className="flex gap-2">
            <button onClick={() => sendPoll(false)} disabled={!!busy} className={ghost}>
              {busy === 'poll' ? 'Sending…' : 'Ask the team'}
            </button>
            {silent.length > 0 && (
              <button onClick={() => sendPoll(true)} disabled={!!busy} className={ghost}>
                {busy === 'nudge' ? 'Sending…' : `Nudge ${silent.length} silent`}
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Available', n: yes.length, tone: 'text-[#D3FB52]' },
            { label: 'Out', n: no.length, tone: 'text-red-300' },
            { label: 'Maybe', n: maybe.length, tone: 'text-amber-300' },
            { label: 'No answer', n: silent.length, tone: 'text-white/40' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-white/[0.08] bg-[#002838] p-4">
              <div className={`text-2xl font-semibold ${s.tone}`}>{s.n}</div>
              <div className="text-white/40 text-xs uppercase tracking-wide mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        <p className="text-white/40 text-sm mt-3">
          {yes.length >= needed
            ? `Enough to field a lineup (${needed} spots).`
            : `Need ${needed - yes.length} more for a full lineup of ${needed}.`}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {players
            .filter((p) => p.availability)
            .map((p) => (
              <span
                key={p.id}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  p.availability === 'yes'
                    ? 'border-[#D3FB52]/40 text-[#D3FB52]'
                    : p.availability === 'no'
                      ? 'border-red-400/30 text-red-300'
                      : 'border-amber-400/30 text-amber-300'
                }`}
              >
                {p.name}
                {p.isSub ? ' (sub)' : ''}
              </span>
            ))}
        </div>

        {players.some((p) => !p.hasEmail) && (
          <p className="text-amber-300/70 text-xs mt-3">
            {players.filter((p) => !p.hasEmail).length} player(s) have no email and can&rsquo;t be
            polled — add one on the roster.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- lineup */}
      <section>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-display text-white">Lineup</h2>
          <div className="flex gap-2 flex-wrap">
            <button onClick={generate} disabled={!!busy} className={primary}>
              {busy === 'generate' ? 'Building…' : 'Generate lineup'}
            </button>
            {courts.length > 0 && (
              <>
                <button onClick={save} disabled={!!busy || !dirty} className={ghost}>
                  {busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                </button>
                <button onClick={send} disabled={!!busy || dirty} className={ghost}>
                  {busy === 'send' ? 'Sending…' : lineupSent ? 'Resend to team' : 'Send to team'}
                </button>
              </>
            )}
          </div>
        </div>

        {warnings.length > 0 && (
          <ul className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-4 space-y-1 text-sm text-amber-100/85">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}

        {courts.length === 0 && (
          <p className="text-white/40 text-sm mt-3">
            No lineup yet. Collect availability, then hit Generate.
          </p>
        )}

        <div className="mt-3 space-y-2">
          {courts.map((c) => (
            <div key={c.courtNumber} className="rounded-xl border border-white/[0.08] bg-[#002838] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-white/50 text-xs uppercase tracking-wide">
                  {c.courtType === 'singles' ? 'Singles' : 'Doubles'} {c.courtNumber}
                </div>
                {c.notes && c.notes.length > 0 && (
                  <div className="text-white/35 text-xs text-right">{c.notes.join(' · ')}</div>
                )}
              </div>

              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([1, 2] as const)
                  .filter((slot) => slot === 1 || c.courtType === 'doubles')
                  .map((slot) => {
                    const pid = slot === 1 ? c.player1Id : c.player2Id;
                    const confirmed = slot === 1 ? c.player1Confirmed : c.player2Confirmed;
                    return (
                      <div key={slot}>
                        <div className="flex items-center gap-2">
                          <select
                            value={pid ?? ''}
                            onChange={(e) => setSlot(c.courtNumber, slot, e.target.value || null)}
                            aria-label={`Court ${c.courtNumber} player ${slot}`}
                            className="flex-1 px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-white text-sm focus:border-[#D3FB52]/50 focus:outline-none"
                          >
                            <option value="">— empty —</option>
                            {optionsFor(c, slot).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.rating != null ? ` (${p.rating})` : ''}
                                {p.availability === 'yes' ? ' ✓' : p.availability === 'no' ? ' ✗' : ''}
                              </option>
                            ))}
                          </select>
                          {confirmed && (
                            <span className="text-[#D3FB52] text-xs shrink-0" title="Confirmed">
                              confirmed
                            </span>
                          )}
                        </div>
                        {c.id && pid && (
                          <button
                            onClick={() => findSub(c, slot)}
                            disabled={!!busy}
                            className="text-white/35 hover:text-white text-xs mt-1.5"
                          >
                            {busy === `sub-${c.courtNumber}-${slot}`
                              ? 'Asking subs…'
                              : `${nameOf(pid)} bailed — find a sub`}
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>

        {dirty && courts.length > 0 && (
          <p className="text-amber-300/70 text-xs mt-3">
            Unsaved changes — save before sending to the team.
          </p>
        )}
      </section>

      {/* --------------------------------------------------------------- results */}
      {courts.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-xl font-display text-white">
              Results
              {status === 'played' && (
                <span className="ml-2 text-sm text-[#D3FB52] font-sans">recorded</span>
              )}
            </h2>
            {!scoring ? (
              <button onClick={() => setScoring(true)} disabled={!!busy} className={ghost}>
                Enter scores
              </button>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => saveResults(false)} disabled={!!busy} className={ghost}>
                  {busy === 'scores' ? 'Saving…' : 'Save scores'}
                </button>
                <button onClick={() => saveResults(true)} disabled={!!busy} className={primary}>
                  {busy === 'play'
                    ? 'Recording…'
                    : status === 'played'
                      ? 'Update result'
                      : 'Save & mark played'}
                </button>
              </div>
            )}
          </div>

          {scoring && (
            <>
              <p className="text-white/40 text-sm mt-1">
                Marking a match played is what counts it toward playoff eligibility and play-time.
                Win/loss per court also teaches the generator which pairings work.
              </p>

              <div className="mt-3 space-y-2">
                {courts.map((c) => {
                  const s = scores[c.courtNumber] ?? { score: '', won: null };
                  return (
                    <div
                      key={c.courtNumber}
                      className="flex items-center gap-3 flex-wrap rounded-xl border border-white/[0.08] bg-[#002838] p-3"
                    >
                      <div className="text-white/50 text-xs uppercase tracking-wide w-24 shrink-0">
                        {c.courtType === 'singles' ? 'Singles' : 'Doubles'} {c.courtNumber}
                      </div>
                      <div className="text-white text-sm flex-1 min-w-[10rem]">
                        {nameOf(c.player1Id)}
                        {c.courtType === 'doubles' ? ` / ${nameOf(c.player2Id)}` : ''}
                      </div>
                      <input
                        value={s.score}
                        onChange={(e) => setScore(c.courtNumber, { score: e.target.value })}
                        placeholder="6-4, 6-3"
                        aria-label={`Score for court ${c.courtNumber}`}
                        className="w-32 px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-white placeholder-white/25 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
                      />
                      <div className="flex gap-1">
                        {[
                          { label: 'W', val: true },
                          { label: 'L', val: false },
                        ].map((o) => (
                          <button
                            key={o.label}
                            onClick={() =>
                              setScore(c.courtNumber, { won: s.won === o.val ? null : o.val })
                            }
                            aria-pressed={s.won === o.val}
                            className={`w-10 py-2 rounded-lg text-sm font-semibold border ${
                              s.won === o.val
                                ? o.val
                                  ? 'bg-[#D3FB52] text-[#001820] border-[#D3FB52]'
                                  : 'bg-red-400/20 text-red-200 border-red-400/40'
                                : 'border-white/10 text-white/40 hover:text-white'
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 border border-red-400/30 text-red-200 p-3 text-sm">
          {error}
        </p>
      )}
      {note && (
        <p className="rounded-xl bg-[#D3FB52]/10 border border-[#D3FB52]/30 text-[#D3FB52] p-3 text-sm">
          {note}
        </p>
      )}
    </div>
  );
}
