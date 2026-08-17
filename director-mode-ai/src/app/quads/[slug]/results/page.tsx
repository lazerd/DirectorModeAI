import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Trophy, ArrowLeft, Crown, Gift } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  computeQuadFinalStandings,
  isFlightComplete,
  type QuadMatchView,
} from '@/lib/quads';
import { getSponsor } from '@/config/sponsors';
import SponsorWordmark from '@/components/quads/SponsorWordmark';
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
    .select('id, name, slug, public_status, event_scoring_format, event_date, sponsor_id')
    .eq('slug', slug)
    .maybeSingle();
  if (!ev) return notFound();
  const e = ev as any;
  const sponsor = getSponsor(e.sponsor_id);

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

  // Per-flight overall standings: most games won across all four rounds.
  // A flight is only "decided" once the round-4 doubles has been scored.
  const flightStandings = flightList.map((flight) => {
    const flightEntries = entriesList
      .filter((x) => x.flight_id === flight.id)
      .map((x) => ({ id: x.id, flight_seed: x.flight_seed }));
    const flightMatches = (matchesList.filter(
      (m) => m.flight_id === flight.id
    ) as QuadMatchView[]);
    const standings = computeQuadFinalStandings(flightEntries, flightMatches);
    const doubles = flightMatches.find((m) => m.match_type === 'doubles') as any;
    const decided = isFlightComplete(flightMatches);
    return { flight, standings, doubles, decided };
  });

  const anyDecided = flightStandings.some((f) => f.decided);
  const allDecided = flightStandings.length > 0 && flightStandings.every((f) => f.decided);
  const headerLabel = allDecided ? 'Final standings' : 'Live standings';

  return (
    <>
      <div className="min-h-screen bg-[#001820] text-white print:bg-white print:text-black">
        {sponsor && (
          <div
            className="w-full flex items-center justify-center gap-3 py-2.5 print:border-b print:border-gray-300"
            style={{ backgroundColor: '#FFFFFF' }}
          >
            <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-black/45">
              {sponsor.presentedBy}
            </span>
            <SponsorWordmark sponsor={sponsor} size="sm" />
          </div>
        )}

        <header className="border-b border-white/10 print:border-gray-300">
          <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
            <Link
              href={`/quads/${slug}`}
              className="p-2 hover:bg-white/10 rounded-lg print:hidden"
            >
              <ArrowLeft size={18} />
            </Link>
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: sponsor?.colors.primary ?? '#D3FB52' }}
            >
              <Trophy size={22} style={{ color: sponsor ? '#FFFFFF' : '#002838' }} />
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

          {/* How the winner is decided */}
          {flightList.length > 0 && (
            <div className="bg-white/5 rounded-xl px-4 py-3 text-xs text-white/60 print:bg-gray-100 print:text-gray-700">
              <span className="font-semibold text-white/85 print:text-black">
                Winner = most games won across all four rounds.
              </span>{' '}
              Doubles games count in full for both partners. Ties break on matches won, then
              head-to-head, then fewest games lost.
            </div>
          )}

          {/* Champions banner — as soon as a flight's doubles is in */}
          {anyDecided && (
            <div className="bg-gradient-to-br from-yellow-400/20 to-orange-400/20 border-2 border-yellow-400/40 rounded-2xl p-6 text-center print:bg-yellow-50 print:border-yellow-400">
              <Crown size={32} className="mx-auto text-yellow-400 mb-2 print:text-yellow-600" />
              <div className="text-xs uppercase tracking-widest text-yellow-300 font-bold mb-3 print:text-yellow-700">
                {allDecided ? 'Champions' : 'Champions so far'}
              </div>
              <div className="space-y-1">
                {flightStandings.map(({ flight, standings, decided }) => {
                  if (!decided) return null;
                  const champ = standings[0];
                  if (!champ) return null;
                  return (
                    <div key={flight.id} className="text-lg">
                      <span className="text-white/70 print:text-gray-700">{flight.name}:</span>{' '}
                      <span className="font-bold text-white print:text-black">
                        {entryById.get(champ.entry_id)?.player_name ?? '—'}
                      </span>{' '}
                      <span className="text-sm text-yellow-200 print:text-yellow-700">
                        {champ.games_won} games
                      </span>
                    </div>
                  );
                })}
              </div>
              {sponsor && (
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-full bg-white print:border print:border-gray-300">
                  <Gift size={15} style={{ color: sponsor.colors.secondary }} />
                  <span style={{ color: sponsor.colors.ink }}>
                    {sponsor.name} gift card — see the desk
                  </span>
                </div>
              )}
            </div>
          )}

          {flightList.length === 0 ? (
            <div className="bg-white/5 rounded-xl p-8 text-center text-white/60 print:bg-gray-100 print:text-gray-700">
              Flights haven&rsquo;t been generated yet — check back closer to the start.
            </div>
          ) : (
            flightStandings.map(({ flight, standings, doubles, decided }) => (
              <div
                key={flight.id}
                className="bg-white text-gray-900 rounded-2xl p-5 print:rounded-lg print:border print:border-gray-300"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Trophy
                    size={18}
                    style={{ color: sponsor?.colors.primary ?? '#F97316' }}
                  />
                  <h2 className="font-semibold text-lg" style={{ color: '#000000' }}>
                    {flight.name}
                  </h2>
                  {flight.tier_label && (
                    <span className="text-xs text-gray-500">· {flight.tier_label}</span>
                  )}
                  <span className="ml-auto text-xs font-semibold text-gray-500">
                    {decided ? 'Final' : 'In progress'}
                  </span>
                </div>

                <div className="space-y-2 mb-4">
                  {standings.map((s) => {
                    const ent = entryById.get(s.entry_id);
                    const partner = s.doubles_partner_id
                      ? entryById.get(s.doubles_partner_id)?.player_name
                      : null;
                    return (
                      <div
                        key={s.entry_id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${RANK_COLORS[s.rank] ?? 'border-gray-200'}`}
                      >
                        <div
                          className="text-2xl font-bold w-10 text-center"
                          style={{ color: '#000000' }}
                        >
                          {decided && s.rank === 1
                            ? '🥇'
                            : decided && s.rank === 2
                              ? '🥈'
                              : decided && s.rank === 3
                                ? '🥉'
                                : `${s.rank}`}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate" style={{ color: '#000000' }}>
                            {ent?.player_name ?? '—'}
                          </div>
                          <div className="text-xs text-gray-600">
                            {decided ? `${ORDINAL[s.rank] ?? `${s.rank}th`} place` : 'Running total'}{' '}
                            · {s.match_wins}-{s.match_losses} matches · singles ladder #
                            {s.singles_rank}
                            {partner && ` · doubles with ${partner}`}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-xl font-bold leading-none" style={{ color: '#000000' }}>
                            {s.games_won}
                          </div>
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">
                            games
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {doubles && (
                  <div
                    className="rounded-lg p-3 text-sm border"
                    style={{
                      backgroundColor: sponsor ? sponsor.colors.cream : '#FFF7ED',
                      borderColor: sponsor ? sponsor.colors.primary : '#FED7AA',
                    }}
                  >
                    <div
                      className="text-xs uppercase font-semibold mb-1"
                      style={{ color: sponsor?.colors.secondary ?? '#C2410C' }}
                    >
                      Round 4 Doubles — 1st + 4th vs 2nd + 3rd
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        className={
                          doubles.winner_side === 'a'
                            ? 'font-semibold text-emerald-700'
                            : 'text-gray-900'
                        }
                        style={doubles.winner_side !== 'a' ? { color: '#000000' } : undefined}
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
                        style={doubles.winner_side !== 'b' ? { color: '#000000' } : undefined}
                      >
                        {entryById.get(doubles.player3_id)?.player_name ?? '?'} +{' '}
                        {entryById.get(doubles.player4_id)?.player_name ?? '?'}
                      </div>
                    </div>
                    {doubles.score ? (
                      <div className="text-xs mt-1 font-mono" style={{ color: '#000000' }}>
                        {doubles.score}
                      </div>
                    ) : (
                      <div className="text-xs mt-1 text-gray-600">
                        Not yet played — the quad isn&rsquo;t decided until this one is in.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {sponsor && (
            <p className="text-center text-[11px] text-white/35 print:text-gray-500">
              {sponsor.legal}
            </p>
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
