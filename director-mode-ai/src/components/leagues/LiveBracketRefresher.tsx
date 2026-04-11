'use client';

/**
 * Live-updating wrapper for the public compass / single-elim / round-robin
 * bracket pages.
 *
 * The parent server component loads the initial flights / entries / matches
 * from Supabase (via service role, bypassing RLS) for a fast first paint.
 * This client component takes that initial snapshot as props, renders it
 * immediately so hydration is seamless, and then subscribes to Supabase
 * Realtime postgres_changes on league_matches (filtered per flight_id) and
 * league_flights (filtered by league_id).
 *
 * When a change fires, a 400ms-debounced refetch pulls a fresh snapshot via
 * the browser anon client (relies on RLS allowing public reads for running /
 * completed leagues) and updates state. React reconciliation keeps
 * FlightBracketView mounted across refetches, which means the PanZoomCanvas
 * pan/zoom state (transform refs) is preserved — viewers watching a live
 * league night don't lose their scroll position when a score comes in.
 *
 * Display includes a small pulsing "Live" indicator near the top that flashes
 * brighter for ~1.2s every time data updates, giving viewers visual
 * confirmation that the page is actually updating in real time.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import FlightBracketView, {
  type BracketEntry,
  type BracketMatch,
  type BracketFlight,
} from './FlightBracketView';
import { CATEGORY_LABELS, CATEGORY_ORDER, type CategoryKey } from '@/lib/leagueUtils';

type FlightRow = BracketFlight & { category_id: string; category_key: CategoryKey };

type Props = {
  leagueId: string;
  leagueType: 'compass' | 'round_robin' | 'single_elimination';
  initialFlights: FlightRow[];
  initialEntriesByFlightId: Record<string, BracketEntry[]>;
  initialMatchesByFlightId: Record<string, BracketMatch[]>;
};

export default function LiveBracketRefresher({
  leagueId,
  leagueType,
  initialFlights,
  initialEntriesByFlightId,
  initialMatchesByFlightId,
}: Props) {
  const [flights, setFlights] = useState<FlightRow[]>(initialFlights);
  const [entriesByFlightId, setEntriesByFlightId] = useState<Record<string, BracketEntry[]>>(
    initialEntriesByFlightId
  );
  const [matchesByFlightId, setMatchesByFlightId] = useState<Record<string, BracketMatch[]>>(
    initialMatchesByFlightId
  );
  // Flashes bright for ~1.2s every time an update lands, so viewers see
  // the page actually updating live.
  const [justUpdated, setJustUpdated] = useState(false);
  const [lastUpdateTs, setLastUpdateTs] = useState<number | null>(null);

  // The server component already captures the category_id → category_key
  // mapping inside initialFlights. Categories don't change during live play,
  // so we reuse it on refetch instead of re-querying league_categories.
  const categoryKeyByIdRef = useRef(
    new Map<string, CategoryKey>(initialFlights.map(f => [f.category_id, f.category_key]))
  );

  const refetch = useCallback(async () => {
    const supabase = createClient();

    const [flightsRes, entriesRes] = await Promise.all([
      supabase
        .from('league_flights')
        .select('id, flight_name, size, num_rounds, status, category_id')
        .eq('league_id', leagueId),
      supabase
        .from('league_entries')
        .select('id, flight_id, captain_name, partner_name, seed_in_flight, category_id')
        .eq('league_id', leagueId),
    ]);

    const newFlightsRaw = ((flightsRes.data as any[]) || []);
    const flightIds = newFlightsRaw.map(f => f.id);

    // Fetch matches in a second round-trip so we can constrain by flight_id.
    const matchesRes = flightIds.length
      ? await supabase
          .from('league_matches')
          .select(
            'id, flight_id, round, match_index, bracket_position, entry_a_id, entry_b_id, score, winner_entry_id, status, deadline'
          )
          .in('flight_id', flightIds)
      : { data: [] as any[] };

    const catMap = categoryKeyByIdRef.current;
    const newFlights: FlightRow[] = newFlightsRaw.map(f => ({
      id: f.id,
      flight_name: f.flight_name,
      size: f.size,
      num_rounds: f.num_rounds,
      status: f.status,
      category_id: f.category_id,
      category_key: catMap.get(f.category_id) || 'men_singles',
    }));

    const newEntries: Record<string, BracketEntry[]> = {};
    for (const e of ((entriesRes.data as any[]) || [])) {
      if (!e.flight_id) continue;
      const list = newEntries[e.flight_id] || [];
      list.push({
        id: e.id,
        captain_name: e.captain_name,
        partner_name: e.partner_name,
        seed_in_flight: e.seed_in_flight,
      });
      newEntries[e.flight_id] = list;
    }

    const newMatches: Record<string, BracketMatch[]> = {};
    for (const m of ((matchesRes.data as any[]) || [])) {
      const list = newMatches[m.flight_id] || [];
      list.push(m as BracketMatch);
      newMatches[m.flight_id] = list;
    }

    // Safety guard: if RLS unexpectedly blocks the anon client from reading
    // these tables (it shouldn't for running leagues, but if a director
    // changes the league back to draft mid-play the policy might kick in),
    // the refetch would return empty arrays and wipe out the known-good
    // SSR data. Only commit the update if we actually got flights back.
    // The SSR initial snapshot remains displayed in that case.
    if (newFlights.length === 0 && initialFlights.length > 0) {
      return;
    }

    setFlights(newFlights);
    setEntriesByFlightId(newEntries);
    setMatchesByFlightId(newMatches);
    setLastUpdateTs(Date.now());
    setJustUpdated(true);
    setTimeout(() => setJustUpdated(false), 1200);
  }, [leagueId, initialFlights.length]);

  useEffect(() => {
    const supabase = createClient();

    // Fresh fetch on mount, regardless of whether Supabase Realtime is
    // configured yet. The server-rendered initial snapshot can be stale if
    // Next.js / Vercel edge cached it, and without this call the client
    // would keep showing that stale data until a realtime event finally
    // fired (which never happens if the publication migration hasn't been
    // applied). Refetching on mount guarantees viewers see current scores
    // within ~100ms of landing on the page.
    refetch();

    // Debounce bursts of updates so one progressMatchOnConfirm transaction
    // that creates + updates several rows only triggers one refetch.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refetch();
      }, 400);
    };

    // Build one channel with a per-flight filter for league_matches so the
    // Realtime server only pushes events for rows we actually care about,
    // plus a league-level filter on league_flights.
    let channel = supabase.channel(`public-bracket:${leagueId}`);
    const initialFlightIds = initialFlights.map(f => f.id);
    for (const flightId of initialFlightIds) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'league_matches',
          filter: `flight_id=eq.${flightId}`,
        },
        scheduleRefetch
      );
    }
    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'league_flights',
        filter: `league_id=eq.${leagueId}`,
      },
      scheduleRefetch
    );
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // We deliberately only re-subscribe when the league or the initial flight
    // set changes. During a normal live viewing session neither does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, initialFlights.length]);

  // Group flights by category for rendering.
  const flightsByCategory = new Map<CategoryKey, FlightRow[]>();
  for (const f of flights) {
    if (!flightsByCategory.has(f.category_key)) flightsByCategory.set(f.category_key, []);
    flightsByCategory.get(f.category_key)!.push(f);
  }
  for (const [, list] of flightsByCategory) {
    list.sort((a, b) => a.flight_name.localeCompare(b.flight_name));
  }

  return (
    <>
      {/* Live indicator — a small green dot + "Live" label that pulses
          whenever data actually updates so viewers can tell the page is
          really running in real time (not just claiming to). */}
      <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
        <span className="relative flex h-2 w-2">
          {justUpdated && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          )}
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span>
          Live — updates automatically as scores come in
          {lastUpdateTs && (
            <span className="ml-1 text-gray-400">
              (last update {new Date(lastUpdateTs).toLocaleTimeString()})
            </span>
          )}
        </span>
      </div>

      {flights.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
          Draws haven&apos;t been generated yet.
        </div>
      ) : (
        CATEGORY_ORDER.filter(k => flightsByCategory.has(k)).map(catKey => (
          <section key={catKey} className="mb-10">
            <h2 className="font-semibold text-xl mb-4 text-gray-900">{CATEGORY_LABELS[catKey]}</h2>
            <div className="space-y-8">
              {(flightsByCategory.get(catKey) || []).map(flight => (
                <div key={flight.id} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6">
                  <FlightBracketView
                    flight={flight}
                    entries={entriesByFlightId[flight.id] || []}
                    matches={matchesByFlightId[flight.id] || []}
                    leagueType={leagueType}
                  />
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
