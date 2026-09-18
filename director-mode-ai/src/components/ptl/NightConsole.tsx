'use client';

/**
 * Match night, run from a phone at the side of a court.
 *
 * The thing this screen exists to do is the thing most league software gets
 * wrong: when a meeting will not resolve, it has to say so OUT LOUD, name the
 * tiebreak that has to be played, and then wait. The alternative — silently
 * picking a winner on some hidden rule — is how you end up with two pairs
 * standing on court at 9:40pm asking whether they're still playing.
 *
 * So an unresolved meeting turns amber and states its instruction as a
 * sentence: "Split 1-1 and games are level at 11-11 — both courts play a
 * 7-point tiebreak." Then it shows exactly the point boxes it needs, and
 * nothing else.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import type { NightView } from '@/lib/ptl/scoring';

type Props = { night: NightView; origin: string };

const KIND_LABEL: Record<string, string> = {
  tb7_singles: 'Singles tiebreak (to 7)',
  tb7_doubles: 'Doubles tiebreak (to 7)',
  points23: 'Singles decider (2 of 3 points)',
};

const LEVEL_LABEL: Record<number, string> = {
  1: 'Both lines',
  2: 'Total games',
  3: 'Tiebreaks',
  4: 'Combined points',
  5: 'Decider',
};

export default function NightConsole({ night: initial, origin }: Props) {
  const [night, setNight] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const teamName = (id: string) => night.teams.find((t) => t.id === id)?.name || '—';
  const teamCode = (id: string) => night.teams.find((t) => t.id === id)?.short_code || '—';

  async function post(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/ptl/night/${night.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || 'That did not save.');
        return false;
      }
      // Re-render from the server rather than patching state by hand: the
      // cascade can change a meeting's whole shape (new tiebreak needed, or a
      // result appearing) and guessing at that client-side is how the two
      // drift apart.
      const fresh = await fetch(`${origin}/api/ptl/night/${night.token}/view`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (fresh?.night) setNight(fresh.night);
      else window.location.reload();
      return true;
    } catch {
      toast.error('Lost the connection.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const done = night.meetings.filter((m) => m.status === 'complete').length;

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
        {night.seasonName} · {night.divisionName}
      </p>
      <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
        {night.is_finals ? 'Finals' : `Week ${night.week_no}`}
      </h1>
      <p className="mt-2 text-white/55">
        {night.site_name} · {done} of {night.meetings.length} meetings in
      </p>

      <div className="mt-10 space-y-6">
        {night.meetings.map((m) => {
          /*
           * Narrow the outcome union into two typed locals rather than two
           * booleans. A boolean tells TypeScript nothing about `m.outcome`, so
           * every read of .winner / .needs / .because underneath would be an
           * error — and casting past it would be lying about a value that
           * genuinely has two shapes.
           */
          const decided = m.outcome.state === 'decided' ? m.outcome : null;
          const waiting = m.outcome.state === 'awaiting_shootout' ? m.outcome : null;
          const winnerId = decided
            ? decided.winner === 'home'
              ? m.home_team_id
              : m.away_team_id
            : null;

          return (
            <section
              key={m.id}
              className={`rounded-sm border ${
                waiting
                  ? 'border-amber-400/60 bg-amber-400/[0.07]'
                  : decided
                    ? 'border-white/10 bg-white/[0.02]'
                    : 'border-white/15'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/35">
                    Round {m.round_no}
                  </span>
                  <h2 className="mt-1 text-xl font-black tracking-tight">
                    <span className={winnerId === m.home_team_id ? 'text-teal-300' : ''}>
                      {teamName(m.home_team_id)}
                    </span>
                    <span className="mx-2 text-white/30">v</span>
                    <span className={winnerId === m.away_team_id ? 'text-teal-300' : ''}>
                      {teamName(m.away_team_id)}
                    </span>
                  </h2>
                </div>
                {decided && (
                  <div className="text-right">
                    <div className="text-sm font-bold text-teal-300">
                      {teamCode(winnerId!)} win
                    </div>
                    <div className="text-[11px] uppercase tracking-wider text-white/40">
                      {LEVEL_LABEL[decided.level]}
                    </div>
                  </div>
                )}
              </div>

              {/* ---- the two lines ---- */}
              <div className="divide-y divide-white/[0.07]">
                {(['singles', 'doubles'] as const).map((type) => {
                  const line = m.lines.find((l) => l.line_type === type);
                  if (!line) return null;
                  return (
                    <div key={line.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                      <div className="min-w-[110px]">
                        <div className="text-sm font-semibold capitalize">{type}</div>
                        <div className="text-xs text-white/40">{line.court_label || 'Court TBD'}</div>
                      </div>
                      <input
                        id={`score-${line.id}`}
                        defaultValue={line.score || ''}
                        placeholder="4-2 4-1"
                        aria-label={`${type} score, ${teamCode(m.home_team_id)} first`}
                        className="min-w-0 flex-1 rounded-sm border border-white/15 bg-white/[0.04] px-3 py-2.5 text-white placeholder:text-white/30 focus:border-teal-400/70 focus:outline-none"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v === (line.score || '')) return;
                          post({ action: 'line', lineId: line.id, score: v }, line.id);
                        }}
                      />
                      <span className="w-16 shrink-0 text-right text-sm tabular-nums text-white/55">
                        {busy === line.id
                          ? '…'
                          : line.winner
                            ? `${teamCode(line.winner === 'home' ? m.home_team_id : m.away_team_id)}`
                            : ''}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* ---- scores first, games so far ---- */}
              {(m.home_games > 0 || m.away_games > 0) && (
                <p className="px-5 pb-4 text-xs tabular-nums text-white/40">
                  Games {teamCode(m.home_team_id)} {m.home_games} &ndash; {m.away_games}{' '}
                  {teamCode(m.away_team_id)}
                </p>
              )}

              {/* ---- the part that matters ---- */}
              {waiting && (
                <div className="border-t border-amber-400/30 px-5 py-5">
                  <p className="font-bold text-amber-200">Not decided yet.</p>
                  <p className="mt-1 text-sm leading-relaxed text-amber-100/80">
                    {waiting.because}.
                  </p>

                  <div className="mt-5 space-y-4">
                    {waiting.needs.map((kind) => (
                      <ShootoutRow
                        key={kind}
                        label={KIND_LABEL[kind]}
                        homeCode={teamCode(m.home_team_id)}
                        awayCode={teamCode(m.away_team_id)}
                        busy={busy === `${m.id}:${kind}`}
                        onSave={(h, a) =>
                          post(
                            { action: 'shootout', meetingId: m.id, kind, homePts: h, awayPts: a },
                            `${m.id}:${kind}`,
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {decided && (
                <p className="border-t border-white/10 px-5 py-3 text-sm text-white/50">
                  {decided.because}.
                </p>
              )}
            </section>
          );
        })}
      </div>

      <p className="mt-10 text-xs leading-relaxed text-white/35">
        Enter every score with the home team first. Scores save as you leave the box, and a meeting
        is recalculated from scratch each time — so fixing a typo later fixes the table too.
      </p>
    </div>
  );
}

function ShootoutRow({
  label,
  homeCode,
  awayCode,
  busy,
  onSave,
}: {
  label: string;
  homeCode: string;
  awayCode: string;
  busy: boolean;
  onSave: (home: number, away: number) => void;
}) {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const ready = home !== '' && away !== '' && Number(home) !== Number(away);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[180px] flex-1">
        <span className="block text-sm font-semibold text-white">{label}</span>
      </div>
      <label className="flex items-center gap-2 text-sm text-white/70">
        <span className="w-9 font-semibold">{homeCode}</span>
        <input
          type="number"
          min={0}
          max={99}
          value={home}
          onChange={(e) => setHome(e.target.value)}
          className="w-16 rounded-sm border border-white/20 bg-white/[0.06] px-2 py-2 text-center text-white focus:border-amber-300/80 focus:outline-none"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-white/70">
        <span className="w-9 font-semibold">{awayCode}</span>
        <input
          type="number"
          min={0}
          max={99}
          value={away}
          onChange={(e) => setAway(e.target.value)}
          className="w-16 rounded-sm border border-white/20 bg-white/[0.06] px-2 py-2 text-center text-white focus:border-amber-300/80 focus:outline-none"
        />
      </label>
      <button
        onClick={() => onSave(Number(home), Number(away))}
        disabled={!ready || busy}
        className="rounded-sm bg-amber-300 px-4 py-2 text-sm font-bold text-[#2a1e00] transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
      >
        {busy ? '…' : 'Save'}
      </button>
    </div>
  );
}
