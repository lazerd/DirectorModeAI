'use client';

/**
 * NextMatchCard — the headline element on the player scoring page.
 *
 * Finds the player's next pending match (sorted by date+time), and renders
 * a big card with countdown clock, opponent, court, time. Auto-refreshes
 * the countdown every minute. If no upcoming match, shows "All matches
 * complete" or "Awaiting bracket placement" depending on state.
 */

import { useEffect, useState } from 'react';
import { Clock, MapPin, Users } from 'lucide-react';
import { formatTimeDisplay } from '@/lib/quads';

type Match = {
  id: string;
  bracket: 'main' | 'consolation';
  round: number;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  status: string;
  court: string | null;
  scheduled_at: string | null;
  scheduled_date: string | null;
};

type EntryLite = { id: string; player_name: string; partner_name: string | null };

function parseScheduled(date: string | null, time: string | null): Date | null {
  if (!date || !time) return null;
  const t = time.slice(0, 5);
  const iso = `${date}T${t}:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatDateNice(d: Date): string {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Starting now';
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return `In ${days}d ${remH}h`;
  }
  if (hours > 0) return `In ${hours}h ${mins}m`;
  return `In ${mins}m`;
}

export default function NextMatchCard({
  entryId,
  matches,
  entries,
}: {
  entryId: string;
  matches: Match[];
  entries: EntryLite[];
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const labelEntry = (id: string | null): string => {
    if (!id) return 'TBD';
    const e = entries.find((x) => x.id === id);
    if (!e) return 'TBD';
    return e.partner_name ? `${e.player_name} + ${e.partner_name}` : e.player_name;
  };

  // Player's pending matches with a real (date, time) assigned, sorted ascending
  const upcoming = matches
    .filter((m) => m.status !== 'completed' && m.status !== 'cancelled')
    .filter(
      (m) =>
        m.player1_id === entryId ||
        m.player2_id === entryId ||
        m.player3_id === entryId ||
        m.player4_id === entryId
    )
    .map((m) => ({ m, when: parseScheduled(m.scheduled_date, m.scheduled_at) }))
    .filter((x) => x.when && x.when.getTime() > now.getTime() - 30 * 60_000) // include up to 30 min in the past (in-progress)
    .sort((a, b) => (a.when!.getTime() - b.when!.getTime()));

  if (upcoming.length === 0) {
    // Check if they have any unscheduled pending matches
    const pendingUnscheduled = matches.some(
      (m) =>
        m.status !== 'completed' &&
        m.status !== 'cancelled' &&
        (m.player1_id === entryId ||
          m.player2_id === entryId ||
          m.player3_id === entryId ||
          m.player4_id === entryId)
    );
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4 text-center">
        <Clock size={32} className="mx-auto text-white/40 mb-2" />
        <div className="text-white/80 font-semibold">
          {pendingUnscheduled
            ? 'Awaiting schedule'
            : 'All your matches are complete'}
        </div>
        <div className="text-xs text-white/50 mt-1">
          {pendingUnscheduled
            ? 'Director will set match times soon. Refresh to check.'
            : 'Nice work — see standings below.'}
        </div>
      </div>
    );
  }

  const next = upcoming[0]!;
  const m = next.m;
  const when = next.when!;
  const youOnA = m.player1_id === entryId || m.player2_id === entryId;
  const isDoubles = !!(m.player2_id || m.player4_id);

  const sideA = isDoubles ? labelEntry(m.player1_id) : labelEntry(m.player1_id);
  const sideB = isDoubles ? labelEntry(m.player3_id) : labelEntry(m.player3_id);
  const opponentLabel = youOnA ? sideB : sideA;
  const partnerLabel = isDoubles
    ? youOnA
      ? labelEntry(m.player2_id === entryId ? m.player1_id : m.player2_id)
      : labelEntry(m.player4_id === entryId ? m.player3_id : m.player4_id)
    : null;

  const ms = when.getTime() - now.getTime();
  const isStartingSoon = ms <= 15 * 60_000 && ms > -30 * 60_000;
  const isInProgress = ms <= 0;

  return (
    <div
      className={`rounded-2xl p-5 mb-4 border-2 ${
        isInProgress
          ? 'bg-emerald-500/20 border-emerald-400'
          : isStartingSoon
            ? 'bg-orange-500/20 border-orange-400'
            : 'bg-[#D3FB52]/10 border-[#D3FB52]/40'
      }`}
    >
      <div className="text-xs uppercase tracking-widest font-bold mb-2 text-white/70">
        {isInProgress ? '🟢 On court now' : isStartingSoon ? '⚡ Starting soon' : 'Your next match'}
      </div>

      <div className="text-3xl font-bold text-white mb-1">
        {formatCountdown(ms)}
      </div>
      <div className="text-sm text-white/70 mb-4">
        {formatDateNice(when)} · {formatTimeDisplay(when.toTimeString().slice(0, 5))}
      </div>

      <div className="bg-white/5 rounded-xl p-3 space-y-2 text-sm">
        <div className="flex items-center gap-2 text-white">
          <Users size={14} className="text-white/50" />
          <span className="text-white/60">vs</span>
          <span className="font-semibold">{opponentLabel}</span>
          {partnerLabel && (
            <span className="text-white/50 text-xs">(w/ {partnerLabel})</span>
          )}
        </div>
        {m.court && (
          <div className="flex items-center gap-2 text-white">
            <MapPin size={14} className="text-white/50" />
            <span className="font-semibold">Court {m.court}</span>
          </div>
        )}
        <div className="text-xs text-white/50">
          {m.bracket === 'main' ? 'Main bracket' : 'Consolation'} · Round {m.round}
        </div>
      </div>

      {upcoming.length > 1 && (
        <div className="mt-3 text-xs text-white/50">
          + {upcoming.length - 1} more match{upcoming.length - 1 === 1 ? '' : 'es'} after this
        </div>
      )}
    </div>
  );
}
