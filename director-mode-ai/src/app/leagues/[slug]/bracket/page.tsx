/**
 * Public bracket / standings view for a league.
 *
 * Shows all flights grouped by category with match results, current state,
 * and final placements once rounds are complete. Uses the same dark theme
 * as the public signup page so a player can share the URL for spectators.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Trophy, Calendar, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORY_LABELS, CATEGORY_ORDER, type CategoryKey } from '@/lib/leagueUtils';
import { totalRounds } from '@/lib/compassBracket';

export const dynamic = 'force-dynamic';

type FlightRow = {
  id: string;
  flight_name: string;
  size: number;
  num_rounds: number;
  status: string;
  category_id: string;
  category_key: CategoryKey;
};

type EntryRow = {
  id: string;
  captain_name: string;
  partner_name: string | null;
  seed_in_flight: number | null;
  flight_id: string | null;
};

type MatchRow = {
  id: string;
  flight_id: string;
  round: number;
  match_index: number;
  bracket_position: string | null;
  entry_a_id: string | null;
  entry_b_id: string | null;
  score: string | null;
  winner_entry_id: string | null;
  status: string;
  deadline: string | null;
};

export default async function PublicBracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  const { data: league } = await supabase
    .from('leagues')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (!league) return notFound();

  const l = league as any;

  const [{ data: categories }, { data: flightsRaw }, { data: entries }, { data: matches }] = await Promise.all([
    supabase.from('league_categories').select('id, category_key').eq('league_id', l.id),
    supabase.from('league_flights').select('*').eq('league_id', l.id),
    supabase.from('league_entries').select('id, captain_name, partner_name, seed_in_flight, flight_id').eq('league_id', l.id),
    supabase
      .from('league_matches')
      .select('*')
      .in('flight_id', (await supabase.from('league_flights').select('id').eq('league_id', l.id)).data?.map((f: any) => f.id) || [''])
      .order('round', { ascending: true }),
  ]);

  const categoryKeyById = new Map(
    ((categories as any[]) || []).map(c => [c.id, c.category_key as CategoryKey])
  );

  const flights: FlightRow[] = ((flightsRaw as any[]) || []).map(f => ({
    id: f.id,
    flight_name: f.flight_name,
    size: f.size,
    num_rounds: f.num_rounds,
    status: f.status,
    category_id: f.category_id,
    category_key: categoryKeyById.get(f.category_id) || 'men_singles',
  }));

  const entryById = new Map<string, EntryRow>(
    ((entries as any[]) || []).map(e => [e.id, e as EntryRow])
  );

  const matchesByFlight = new Map<string, MatchRow[]>();
  for (const m of (matches as any[]) || []) {
    if (!matchesByFlight.has(m.flight_id)) matchesByFlight.set(m.flight_id, []);
    matchesByFlight.get(m.flight_id)!.push(m as MatchRow);
  }

  // Group flights by category and order by category + flight name
  const flightsByCategory = new Map<CategoryKey, FlightRow[]>();
  for (const f of flights) {
    if (!flightsByCategory.has(f.category_key)) flightsByCategory.set(f.category_key, []);
    flightsByCategory.get(f.category_key)!.push(f);
  }
  for (const [, list] of flightsByCategory) {
    list.sort((a, b) => a.flight_name.localeCompare(b.flight_name));
  }

  const teamLabel = (e: EntryRow | undefined) =>
    !e ? '?' : e.partner_name ? `${e.captain_name} / ${e.partner_name}` : e.captain_name;

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/40">Brackets &amp; Results</div>
            <h1 className="font-display text-xl truncate">{l.name}</h1>
          </div>
          <Link href={`/leagues/${l.slug}`} className="text-xs text-white/60 hover:text-white inline-flex items-center gap-1">
            <ArrowLeft size={12} />
            Signup
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-start gap-2 text-sm text-white/60 mb-6">
          <Calendar size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            {format(new Date(l.start_date), 'MMMM d, yyyy')} –{' '}
            {format(new Date(l.end_date), 'MMMM d, yyyy')}
          </span>
        </div>

        {flights.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center text-sm text-white/50">
            Draws haven&apos;t been generated yet.
          </div>
        ) : (
          CATEGORY_ORDER.filter(k => flightsByCategory.has(k)).map(catKey => (
            <section key={catKey} className="mb-8">
              <h2 className="font-semibold text-lg mb-3">{CATEGORY_LABELS[catKey]}</h2>
              <div className="space-y-4">
                {(flightsByCategory.get(catKey) || []).map(flight => {
                  const flightMatches = matchesByFlight.get(flight.id) || [];
                  const flightEntries = Array.from(entryById.values())
                    .filter(e => e.flight_id === flight.id)
                    .sort((a, b) => (a.seed_in_flight || 99) - (b.seed_in_flight || 99));

                  const matchesByRound = new Map<number, MatchRow[]>();
                  for (const m of flightMatches) {
                    if (!matchesByRound.has(m.round)) matchesByRound.set(m.round, []);
                    matchesByRound.get(m.round)!.push(m);
                  }

                  const isCompleted = flight.status === 'completed';

                  return (
                    <div key={flight.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <div className="font-semibold">
                            Flight {flight.flight_name}{' '}
                            <span className="text-white/40 text-sm">({flight.size}-player)</span>
                          </div>
                          <div className="text-xs text-white/40">
                            {totalRounds(flight.size as 8 | 16)} rounds
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          isCompleted
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-blue-500/20 text-blue-300'
                        }`}>
                          {flight.status}
                        </span>
                      </div>

                      {/* Seeded entries list */}
                      <div className="mb-4">
                        <div className="text-xs uppercase text-white/40 mb-2">Seeds</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          {flightEntries.map(e => (
                            <div key={e.id} className="text-white/70">
                              <span className="text-white/40 w-5 inline-block">{e.seed_in_flight}.</span>
                              {teamLabel(e)}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Rounds */}
                      {Array.from(matchesByRound.entries())
                        .sort(([a], [b]) => a - b)
                        .map(([round, roundMatches]) => (
                          <div key={round} className="mt-4 pt-4 border-t border-white/10">
                            <div className="text-xs uppercase text-white/40 mb-2">Round {round}</div>
                            <div className="space-y-1">
                              {roundMatches.map(m => {
                                const a = entryById.get(m.entry_a_id || '');
                                const b = entryById.get(m.entry_b_id || '');
                                const aWon = m.winner_entry_id === m.entry_a_id;
                                const bWon = m.winner_entry_id === m.entry_b_id;
                                return (
                                  <div key={m.id} className="flex items-center gap-2 text-xs font-mono">
                                    <span className="text-white/30 w-16 flex-shrink-0">{m.bracket_position}</span>
                                    <span className={`flex-1 truncate ${aWon ? 'text-white font-semibold' : 'text-white/60'}`}>
                                      {teamLabel(a)}
                                    </span>
                                    <span className="text-white/40">vs</span>
                                    <span className={`flex-1 truncate text-right ${bWon ? 'text-white font-semibold' : 'text-white/60'}`}>
                                      {teamLabel(b)}
                                    </span>
                                    <span className="w-24 text-right text-white/50 flex-shrink-0">
                                      {m.status === 'confirmed'
                                        ? m.score
                                        : m.status === 'reported'
                                          ? `${m.score} (pending)`
                                          : m.status}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}

        <div className="text-center text-xs text-white/30 mt-8 py-6 border-t border-white/10">
          Powered by <Link href="/" className="text-[#D3FB52] hover:underline">CoachMode AI</Link>
        </div>
      </main>
    </div>
  );
}
