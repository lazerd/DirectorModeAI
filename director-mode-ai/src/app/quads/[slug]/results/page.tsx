import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Trophy, ArrowLeft } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computeFlightStandings, type QuadMatchView } from '@/lib/quads';

export const dynamic = 'force-dynamic';

const ORDINAL = ['', '1st', '2nd', '3rd', '4th'];

export default async function PublicResultsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  const { data: ev } = await supabase
    .from('events')
    .select('id, name, slug, public_status, event_scoring_format')
    .eq('slug', slug)
    .maybeSingle();
  if (!ev) return notFound();
  const e = ev as any;

  const { data: flights } = await supabase
    .from('quad_flights')
    .select('*')
    .eq('event_id', e.id)
    .order('sort_order');

  const flightList = (flights as any[]) || [];

  const flightIds = flightList.map((f) => f.id);
  const [{ data: entries }, { data: matches }] = await Promise.all([
    supabase
      .from('quad_entries')
      .select('id, flight_id, flight_seed, player_name')
      .in('flight_id', flightIds.length > 0 ? flightIds : ['00000000-0000-0000-0000-000000000000']),
    supabase
      .from('quad_matches')
      .select('*')
      .in('flight_id', flightIds.length > 0 ? flightIds : ['00000000-0000-0000-0000-000000000000']),
  ]);

  const entriesList = (entries as any[]) || [];
  const matchesList = (matches as any[]) || [];

  const entryById = new Map(entriesList.map((x) => [x.id, x]));

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <Link href={`/quads/${slug}`} className="p-2 hover:bg-white/10 rounded-lg">
            <ArrowLeft size={18} />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/40">Live results</div>
            <h1 className="text-xl font-semibold truncate">{e.name}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {flightList.length === 0 ? (
          <div className="bg-white/5 rounded-xl p-8 text-center text-white/60">
            Flights haven't been generated yet — check back closer to the start.
          </div>
        ) : (
          flightList.map((flight) => {
            const flightEntries = entriesList
              .filter((x) => x.flight_id === flight.id)
              .map((x) => ({ id: x.id, flight_seed: x.flight_seed }));
            const flightMatches = matchesList.filter((m) => m.flight_id === flight.id);

            const standings = computeFlightStandings(flightEntries, flightMatches as QuadMatchView[]);

            const doubles = flightMatches.find((m) => m.match_type === 'doubles');

            return (
              <div key={flight.id} className="bg-white text-gray-900 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Trophy size={18} className="text-orange-500" />
                  <h2 className="font-semibold text-lg">{flight.name}</h2>
                  {flight.tier_label && (
                    <span className="text-xs text-gray-500">· {flight.tier_label}</span>
                  )}
                </div>

                <div className="overflow-hidden border border-gray-200 rounded-lg mb-4">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left px-3 py-1.5 w-12">#</th>
                        <th className="text-left px-3 py-1.5">Player</th>
                        <th className="text-right px-3 py-1.5">W-L</th>
                        <th className="text-right px-3 py-1.5">Sets</th>
                        <th className="text-right px-3 py-1.5">Games</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((s) => {
                        const e = entryById.get(s.entry_id);
                        return (
                          <tr key={s.entry_id} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 font-semibold text-gray-900">
                              {ORDINAL[s.rank] ?? `${s.rank}th`}
                            </td>
                            <td className="px-3 py-1.5 text-gray-900">{e?.player_name ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right text-gray-700">
                              {s.match_wins}-{s.match_losses}
                            </td>
                            <td className="px-3 py-1.5 text-right text-gray-700">
                              {s.sets_won}-{s.sets_lost}
                            </td>
                            <td className="px-3 py-1.5 text-right text-gray-700">
                              {s.games_won}-{s.games_lost}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {doubles && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm">
                    <div className="text-xs uppercase text-orange-700 font-semibold mb-1">
                      Round 4 Doubles
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        className={
                          doubles.winner_side === 'a' ? 'font-semibold text-emerald-700' : ''
                        }
                      >
                        {entryById.get(doubles.player1_id)?.player_name ?? '?'} +{' '}
                        {entryById.get(doubles.player2_id)?.player_name ?? '?'}
                      </div>
                      <div
                        className={
                          doubles.winner_side === 'b' ? 'font-semibold text-emerald-700' : ''
                        }
                      >
                        {entryById.get(doubles.player3_id)?.player_name ?? '?'} +{' '}
                        {entryById.get(doubles.player4_id)?.player_name ?? '?'}
                      </div>
                    </div>
                    {doubles.score && (
                      <div className="text-xs text-gray-600 mt-1 font-mono">{doubles.score}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        <div className="text-center text-xs text-white/40">
          <Link href={`/quads/${slug}`} className="hover:text-white/60">
            ← Back to tournament
          </Link>
        </div>
      </main>
    </div>
  );
}
