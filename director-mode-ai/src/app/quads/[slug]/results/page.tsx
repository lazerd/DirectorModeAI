import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Trophy, ArrowLeft, Crown } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computeFlightStandings, type QuadMatchView } from '@/lib/quads';
import ShareBar from './ShareBar';

export const dynamic = 'force-dynamic';

const ORDINAL = ['', '1st', '2nd', '3rd', '4th'];

const RANK_COLORS = [
  '', // 0 unused
  'bg-yellow-50 border-yellow-300', // 1st
  'bg-gray-50 border-gray-300', // 2nd
  'bg-amber-50 border-amber-300', // 3rd
  'bg-white border-gray-200', // 4th
];

export default async function PublicResultsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  const { data: ev } = await supabase
    .from('events')
    .select('id, name, slug, public_status, event_scoring_format, event_date')
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

  const isComplete = e.public_status === 'completed';
  const headerLabel = isComplete ? 'Final standings' : 'Live results';

  // Build per-flight standings + identify champions for the banner
  const flightStandings = flightList.map((flight) => {
    const flightEntries = entriesList
      .filter((x) => x.flight_id === flight.id)
      .map((x) => ({ id: x.id, flight_seed: x.flight_seed }));
    const flightMatches = matchesList.filter((m) => m.flight_id === flight.id);
    const standings = computeFlightStandings(flightEntries, flightMatches as QuadMatchView[]);
    const doubles = flightMatches.find((m) => m.match_type === 'doubles');
    return { flight, standings, doubles };
  });

  return (
    <>
      <div className="min-h-screen bg-[#001820] text-white print:bg-white print:text-black">
        <header className="border-b border-white/10 print:border-gray-300">
          <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
            <Link
              href={`/quads/${slug}`}
              className="p-2 hover:bg-white/10 rounded-lg print:hidden"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
              <Trophy size={22} className="text-[#002838]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white/40 print:text-gray-500">{headerLabel}</div>
              <h1 className="text-xl font-semibold truncate">{e.name}</h1>
              {e.event_date && (
                <div className="text-xs text-white/50 print:text-gray-500">{e.event_date}</div>
              )}
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-8 space-y-6 print:py-4">
          {/* Share/Print bar */}
          <ShareBar
            tournamentName={e.name}
            results={flightStandings.map(({ flight, standings }) => ({
              flightName: flight.name,
              players: standings.map((s) => ({
                rank: s.rank,
                name: entryById.get(s.entry_id)?.player_name ?? '—',
              })),
            }))}
          />

          {/* Champions banner — only when tournament is completed */}
          {isComplete && flightStandings.length > 0 && (
            <div className="bg-gradient-to-br from-yellow-400/20 to-orange-400/20 border-2 border-yellow-400/40 rounded-2xl p-6 text-center print:bg-yellow-50 print:border-yellow-400">
              <Crown
                size={32}
                className="mx-auto text-yellow-400 mb-2 print:text-yellow-600"
              />
              <div className="text-xs uppercase tracking-widest text-yellow-300 font-bold mb-3 print:text-yellow-700">
                Champions
              </div>
              <div className="space-y-1">
                {flightStandings.map(({ flight, standings }) => {
                  const champ = standings.find((s) => s.rank === 1);
                  if (!champ) return null;
                  return (
                    <div key={flight.id} className="text-lg">
                      <span className="text-white/70 print:text-gray-700">{flight.name}:</span>{' '}
                      <span className="font-bold text-white print:text-black">
                        {entryById.get(champ.entry_id)?.player_name ?? '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {flightList.length === 0 ? (
            <div className="bg-white/5 rounded-xl p-8 text-center text-white/60 print:bg-gray-100 print:text-gray-700">
              Flights haven't been generated yet — check back closer to the start.
            </div>
          ) : (
            flightStandings.map(({ flight, standings, doubles }) => (
              <div
                key={flight.id}
                className="bg-white text-gray-900 rounded-2xl p-5 print:rounded-lg print:border print:border-gray-300"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Trophy size={18} className="text-orange-500" />
                  <h2 className="font-semibold text-lg" style={{ color: '#000000' }}>
                    {flight.name}
                  </h2>
                  {flight.tier_label && (
                    <span className="text-xs text-gray-500">· {flight.tier_label}</span>
                  )}
                </div>

                <div className="space-y-2 mb-4">
                  {standings.map((s) => {
                    const ent = entryById.get(s.entry_id);
                    return (
                      <div
                        key={s.entry_id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${RANK_COLORS[s.rank] ?? 'border-gray-200'}`}
                      >
                        <div
                          className="text-2xl font-bold w-10 text-center"
                          style={{ color: '#000000' }}
                        >
                          {s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : `${s.rank}`}
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold" style={{ color: '#000000' }}>
                            {ent?.player_name ?? '—'}
                          </div>
                          <div className="text-xs text-gray-600">
                            {ORDINAL[s.rank] ?? `${s.rank}th`} place · {s.match_wins}-{s.match_losses} ·
                            {' '}
                            {s.games_won}-{s.games_lost} games
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {doubles && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm">
                    <div className="text-xs uppercase text-orange-700 font-semibold mb-1">
                      Round 4 Doubles
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        className={
                          doubles.winner_side === 'a'
                            ? 'font-semibold text-emerald-700'
                            : 'text-gray-900'
                        }
                        style={
                          doubles.winner_side !== 'a' ? { color: '#000000' } : undefined
                        }
                      >
                        {entryById.get(doubles.player1_id)?.player_name ?? '?'} +{' '}
                        {entryById.get(doubles.player2_id)?.player_name ?? '?'}
                      </div>
                      <div
                        className={
                          doubles.winner_side === 'b'
                            ? 'font-semibold text-emerald-700'
                            : 'text-gray-900'
                        }
                        style={
                          doubles.winner_side !== 'b' ? { color: '#000000' } : undefined
                        }
                      >
                        {entryById.get(doubles.player3_id)?.player_name ?? '?'} +{' '}
                        {entryById.get(doubles.player4_id)?.player_name ?? '?'}
                      </div>
                    </div>
                    {doubles.score && (
                      <div
                        className="text-xs mt-1 font-mono"
                        style={{ color: '#000000' }}
                      >
                        {doubles.score}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          <div className="text-center text-xs text-white/40 print:text-gray-500">
            <Link href={`/quads/${slug}`} className="hover:text-white/60 print:hidden">
              ← Back to tournament
            </Link>
            <div className="mt-2 hidden print:block">Powered by CoachMode</div>
          </div>
        </main>
      </div>
      {/* Print-specific overrides */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </>
  );
}
