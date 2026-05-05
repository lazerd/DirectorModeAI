'use client';

/**
 * Live Director Console — TV-friendly all-courts view.
 *
 * Designed to be cast to a TV in the tournament office. Shows every court
 * with the current match in progress and what's on deck. Director can
 * click a match to mark it complete (which triggers downstream auto-reflow
 * via the existing score-submission endpoint).
 *
 * Auto-refreshes every 30 seconds.
 *
 * URL: /mixer/events/[id]/console
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, RefreshCw, Tv } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatTimeDisplay, resolveCourtList } from '@/lib/quads';

type Event = {
  id: string;
  name: string;
  match_format: string;
  num_courts: number;
  court_names: string[] | null;
};

type Entry = {
  id: string;
  player_name: string;
  partner_name: string | null;
};

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

const TOURNAMENT_FORMATS = new Set([
  'rr-singles', 'rr-doubles',
  'single-elim-singles', 'single-elim-doubles',
  'fmlc-singles', 'fmlc-doubles',
  'ffic-singles', 'ffic-doubles',
]);

export default function LiveConsolePage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  const [event, setEvent] = useState<Event | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const { data: ev } = await supabase
      .from('events')
      .select('id, name, match_format, num_courts, court_names')
      .eq('id', id)
      .maybeSingle();
    setEvent(ev as Event);
    if (!ev) {
      setLoading(false);
      return;
    }

    const isQuads = (ev as any).match_format === 'quads';
    const isTournament = TOURNAMENT_FORMATS.has((ev as any).match_format);

    if (isTournament) {
      const [eRes, mRes] = await Promise.all([
        supabase
          .from('tournament_entries')
          .select('id, player_name, partner_name')
          .eq('event_id', id),
        supabase
          .from('tournament_matches')
          .select('id, bracket, round, player1_id, player2_id, player3_id, player4_id, status, court, scheduled_at, scheduled_date')
          .eq('event_id', id),
      ]);
      setEntries((eRes.data as Entry[]) || []);
      setMatches((mRes.data as Match[]) || []);
    } else if (isQuads) {
      // Quads uses different tables; pull from there
      const [eRes, fRes] = await Promise.all([
        supabase.from('quad_entries').select('id, player_name').eq('event_id', id),
        supabase.from('quad_flights').select('id').eq('event_id', id),
      ]);
      const flightIds = ((fRes.data as any[]) || []).map((f) => f.id);
      const { data: mRes } = flightIds.length
        ? await supabase
            .from('quad_matches')
            .select('id, round, match_type, player1_id, player2_id, player3_id, player4_id, status, court, scheduled_at, scheduled_date, flight_id')
            .in('flight_id', flightIds)
        : { data: [] as any[] };
      setEntries(((eRes.data as any[]) || []).map((e) => ({ id: e.id, player_name: e.player_name, partner_name: null })));
      setMatches(
        ((mRes as any[]) || []).map((m) => ({
          id: m.id,
          bracket: 'main' as const,
          round: m.round,
          player1_id: m.player1_id,
          player2_id: m.player2_id,
          player3_id: m.player3_id,
          player4_id: m.player4_id,
          status: m.status,
          court: m.court,
          scheduled_at: m.scheduled_at,
          scheduled_date: m.scheduled_date,
        }))
      );
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 30_000); // refresh every 30s
    return () => clearInterval(t);
  }, [fetchAll]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const courts = useMemo(() => {
    if (!event) return [];
    return resolveCourtList({
      courtNames: event.court_names,
      numCourts: event.num_courts,
    });
  }, [event]);

  const labelEntry = (id: string | null): string => {
    if (!id) return 'TBD';
    const e = entries.find((x) => x.id === id);
    if (!e) return '—';
    return e.partner_name ? `${e.player_name} + ${e.partner_name}` : e.player_name;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center p-8">
        <div>Event not found.</div>
      </div>
    );
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  // For each court, find:
  //   - Current match: in progress / scheduled to be playing now
  //   - Next match: next scheduled match on this court that hasn't happened
  const courtState = courts.map((court) => {
    const courtMatches = matches
      .filter((m) => m.court === court && m.scheduled_at)
      .sort((a, b) => {
        const ad = (a.scheduled_date ?? todayStr) + 'T' + (a.scheduled_at ?? '00:00');
        const bd = (b.scheduled_date ?? todayStr) + 'T' + (b.scheduled_at ?? '00:00');
        return ad.localeCompare(bd);
      });

    // Current = first non-completed match whose start time has passed (within last 3 hours)
    const current = courtMatches.find((m) => {
      if (m.status === 'completed' || m.status === 'cancelled') return false;
      if (!m.scheduled_date || !m.scheduled_at) return false;
      const startMs = new Date(`${m.scheduled_date}T${m.scheduled_at.slice(0, 5)}:00`).getTime();
      return startMs <= now.getTime() && now.getTime() - startMs < 3 * 60 * 60 * 1000;
    });

    // Next = first non-completed match starting after `now`
    const next = courtMatches.find((m) => {
      if (m.status === 'completed' || m.status === 'cancelled') return false;
      if (m === current) return false;
      if (!m.scheduled_date || !m.scheduled_at) return false;
      const startMs = new Date(`${m.scheduled_date}T${m.scheduled_at.slice(0, 5)}:00`).getTime();
      return startMs > now.getTime();
    });

    return { court, current, next };
  });

  return (
    <div className="min-h-screen bg-[#001820] text-white p-4 sm:p-6 lg:p-8">
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/mixer/events/${id}`}
            className="p-2 hover:bg-white/10 rounded-lg"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="text-xs text-white/40 uppercase tracking-wide flex items-center gap-1">
              <Tv size={12} /> Live Console
            </div>
            <h1 className="text-2xl font-bold">{event.name}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/50">
          <RefreshCw size={12} /> Auto-refresh 30s · {now.toLocaleTimeString()}
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {courtState.map(({ court, current, next }) => (
          <div
            key={court}
            className={`rounded-2xl p-5 border-2 ${
              current
                ? 'bg-emerald-500/10 border-emerald-400/50'
                : 'bg-white/5 border-white/10'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-3xl font-bold">{court}</div>
              <div
                className={`text-xs uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${
                  current ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/50'
                }`}
              >
                {current ? '● Live' : 'Open'}
              </div>
            </div>

            {current ? (
              <div className="space-y-2 mb-3">
                <div className="text-xs text-white/50 uppercase">In progress</div>
                <div className="font-semibold">{labelEntry(current.player1_id)}</div>
                <div className="text-xs text-white/40">vs</div>
                <div className="font-semibold">{labelEntry(current.player3_id)}</div>
                {current.scheduled_at && (
                  <div className="text-xs text-white/50">
                    Started: {formatTimeDisplay(current.scheduled_at)}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-white/40 text-sm mb-3 italic">No active match</div>
            )}

            {next && (
              <div className="border-t border-white/10 pt-3 space-y-1">
                <div className="text-xs text-white/50 uppercase">Up next</div>
                <div className="text-sm">
                  {labelEntry(next.player1_id)}{' '}
                  <span className="text-white/40">vs</span>{' '}
                  {labelEntry(next.player3_id)}
                </div>
                {next.scheduled_at && (
                  <div className="text-xs text-white/40">
                    {next.scheduled_date && next.scheduled_date !== todayStr
                      ? new Date(next.scheduled_date + 'T00:00:00').toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        }) + ' · '
                      : ''}
                    {formatTimeDisplay(next.scheduled_at)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {courts.length === 0 && (
        <div className="bg-white/5 rounded-xl p-8 text-center text-white/60">
          No courts configured. Add courts in Settings.
        </div>
      )}

      <div className="mt-6 text-xs text-white/40 text-center">
        Tip: cast this page to a TV in the tournament office for an at-a-glance view.
      </div>
    </div>
  );
}
