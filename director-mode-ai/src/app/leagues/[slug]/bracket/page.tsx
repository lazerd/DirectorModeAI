import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Trophy, Calendar, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { type CategoryKey } from '@/lib/leagueUtils';
import {
  type BracketEntry,
  type BracketMatch,
  type BracketFlight,
} from '@/components/leagues/FlightBracketView';
import LiveBracketRefresher from '@/components/leagues/LiveBracketRefresher';
import BracketShareButton from '@/components/leagues/BracketShareButton';

export const dynamic = 'force-dynamic';

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
  const leagueType = (l.league_type || 'compass') as 'compass' | 'round_robin' | 'single_elimination';

  const [{ data: categories }, { data: flightsRaw }, { data: entries }] = await Promise.all([
    supabase.from('league_categories').select('id, category_key').eq('league_id', l.id),
    supabase.from('league_flights').select('*').eq('league_id', l.id),
    supabase
      .from('league_entries')
      .select('id, flight_id, captain_name, partner_name, seed_in_flight, category_id')
      .eq('league_id', l.id),
  ]);

  const flightIds = ((flightsRaw as any[]) || []).map(f => f.id);
  const { data: matches } = flightIds.length
    ? await supabase
        .from('league_matches')
        .select('id, flight_id, round, match_index, bracket_position, entry_a_id, entry_b_id, score, winner_entry_id, status, deadline')
        .in('flight_id', flightIds)
    : { data: [] as any[] };

  const categoryKeyById = new Map(
    ((categories as any[]) || []).map(c => [c.id, c.category_key as CategoryKey])
  );

  type FlightRow = BracketFlight & { category_id: string; category_key: CategoryKey };

  const flights: FlightRow[] = ((flightsRaw as any[]) || []).map(f => ({
    id: f.id,
    flight_name: f.flight_name,
    size: f.size,
    num_rounds: f.num_rounds,
    status: f.status,
    category_id: f.category_id,
    category_key: categoryKeyById.get(f.category_id) || 'men_singles',
  }));

  // Shape entries + matches into plain Record<flightId, T[]> so they survive
  // the server → client boundary (Maps don't serialize across that edge).
  const entriesByFlightId: Record<string, BracketEntry[]> = {};
  for (const e of (entries as any[]) || []) {
    if (!e.flight_id) continue;
    const list = entriesByFlightId[e.flight_id] || [];
    list.push({
      id: e.id,
      captain_name: e.captain_name,
      partner_name: e.partner_name,
      seed_in_flight: e.seed_in_flight,
    });
    entriesByFlightId[e.flight_id] = list;
  }

  const matchesByFlightId: Record<string, BracketMatch[]> = {};
  for (const m of (matches as any[]) || []) {
    const list = matchesByFlightId[m.flight_id] || [];
    list.push(m as BracketMatch);
    matchesByFlightId[m.flight_id] = list;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center flex-shrink-0">
            <Trophy size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-500">Brackets &amp; Results</div>
            <h1 className="font-semibold text-lg truncate">{l.name}</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <BracketShareButton leagueName={l.name} leagueSlug={l.slug} />
            <Link
              href={`/leagues/${l.slug}`}
              className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-lg"
            >
              <ArrowLeft size={12} />
              <span className="hidden sm:inline">Back to signup</span>
              <span className="sm:hidden">Back</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-start gap-2 text-sm text-gray-500 mb-6">
          <Calendar size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            {format(new Date(l.start_date), 'MMMM d, yyyy')} –{' '}
            {format(new Date(l.end_date), 'MMMM d, yyyy')}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 ml-2">
            {leagueType === 'compass' ? 'Compass Draw' : leagueType === 'round_robin' ? 'Round Robin' : 'Single Elimination'}
          </span>
        </div>

        <LiveBracketRefresher
          leagueId={l.id}
          leagueType={leagueType}
          initialFlights={flights}
          initialEntriesByFlightId={entriesByFlightId}
          initialMatchesByFlightId={matchesByFlightId}
        />

        <div className="text-center text-xs text-gray-400 mt-8 py-6 border-t border-gray-200">
          Powered by <Link href="/" className="text-orange-600 hover:underline">CoachMode AI</Link>
        </div>
      </main>
    </div>
  );
}
