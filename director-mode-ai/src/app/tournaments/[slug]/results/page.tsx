import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Trophy, ArrowLeft, Crown } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computeRRStandings } from '@/lib/tournamentFormats';
import ShareBar from './ShareBar';

export const dynamic = 'force-dynamic';

const FORMAT_LABELS: Record<string, string> = {
  'rr-singles': 'Round Robin — Singles',
  'rr-doubles': 'Round Robin — Doubles',
  'single-elim-singles': 'Single Elimination — Singles',
  'single-elim-doubles': 'Single Elimination — Doubles',
  'fmlc-singles': 'First-Match Loser Consolation — Singles',
  'fmlc-doubles': 'First-Match Loser Consolation — Doubles',
  'ffic-singles': 'Full Feed-In Consolation — Singles',
  'ffic-doubles': 'Full Feed-In Consolation — Doubles',
};

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

export default async function PublicResultsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  const { data: ev } = await supabase
    .from('events')
    .select('id, name, slug, public_status, event_scoring_format, event_date, match_format')
    .eq('slug', slug)
    .maybeSingle();
  if (!ev) return notFound();
  const e = ev as any;
  const isRR = e.match_format === 'rr-singles' || e.match_format === 'rr-doubles';

  const [{ data: entries }, { data: matches }] = await Promise.all([
    supabase
      .from('tournament_entries')
      .select('id, player_name, partner_name, seed, position')
      .eq('event_id', e.id),
    supabase
      .from('tournament_matches')
      .select('*')
      .eq('event_id', e.id)
      .order('round'),
  ]);

  const entriesList = (entries as any[]) || [];
  const matchesList = (matches as any[]) || [];
  const entryById = new Map(entriesList.map((x) => [x.id, x]));

  const isComplete = e.public_status === 'completed';
  const headerLabel = isComplete ? 'Final standings' : 'Live results';
  const labelEntry = (id: string | null) => {
    if (!id) return 'TBD';
    const ent = entryById.get(id);
    if (!ent) return '—';
    if (ent.partner_name) return `${ent.player_name} + ${ent.partner_name}`;
    return ent.player_name;
  };

  // For RR: compute standings table
  // For brackets: list matches by round
  const standings = isRR
    ? computeRRStandings(
        entriesList.filter((x) => x.position === 'in_draw'),
        matchesList.map((m) => ({
          player1_id: m.player1_id,
          player3_id: m.player3_id,
          score: m.score,
          winner_side: m.winner_side,
          status: m.status,
        }))
      )
    : null;

  // Champion (for completed brackets): winner of the highest-round main match
  let champion: any = null;
  if (!isRR) {
    const mainFinal = matchesList
      .filter((m) => m.bracket === 'main' && m.status === 'completed')
      .sort((a, b) => b.round - a.round || b.slot - a.slot)[0];
    if (mainFinal && mainFinal.winner_side) {
      const champId = mainFinal.winner_side === 'a' ? mainFinal.player1_id : mainFinal.player3_id;
      champion = entryById.get(champId);
    }
  } else if (standings && standings.length > 0) {
    champion = entryById.get(standings[0].entry_id);
  }

  // Build match-list grouped by bracket+round for display
  const matchesByBracket = new Map<string, any[]>();
  for (const m of matchesList) {
    if (!matchesByBracket.has(m.bracket)) matchesByBracket.set(m.bracket, []);
    matchesByBracket.get(m.bracket)!.push(m);
  }

  return (
    <div className="min-h-screen bg-[#001820] text-white print:bg-white print:text-black">
      <header className="border-b border-white/10 print:border-gray-300">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <Link
            href={`/tournaments/${slug}`}
            className="p-2 hover:bg-white/10 rounded-lg print:hidden"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/40 print:text-gray-500">
              {headerLabel} · {FORMAT_LABELS[e.match_format]}
            </div>
            <h1 className="text-xl font-semibold truncate">{e.name}</h1>
            {e.event_date && (
              <div className="text-xs text-white/50 print:text-gray-500">{e.event_date}</div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6 print:py-4">
        <ShareBar tournamentName={e.name} championName={champion ? labelEntry(champion.id) : null} />

        {isComplete && champion && (
          <div className="bg-gradient-to-br from-yellow-400/20 to-orange-400/20 border-2 border-yellow-400/40 rounded-2xl p-6 text-center print:bg-yellow-50 print:border-yellow-400">
            <Crown size={32} className="mx-auto text-yellow-400 mb-2 print:text-yellow-600" />
            <div className="text-xs uppercase tracking-widest text-yellow-300 font-bold mb-3 print:text-yellow-700">
              Champion
            </div>
            <div className="text-2xl font-bold text-white print:text-black">
              {labelEntry(champion.id)}
            </div>
          </div>
        )}

        {isRR && standings && (
          <div className="bg-white text-gray-900 rounded-2xl p-5">
            <h2 className="font-semibold text-lg mb-3" style={{ color: '#000000' }}>
              Standings
            </h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-3 py-1.5 w-12">#</th>
                  <th className="text-left px-3 py-1.5">Player</th>
                  <th className="text-right px-3 py-1.5">W-L</th>
                  <th className="text-right px-3 py-1.5">Games</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => {
                  const ent = entryById.get(s.entry_id);
                  return (
                    <tr key={s.entry_id} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 font-semibold" style={{ color: '#000000' }}>
                        {ORDINAL[s.rank] ?? `${s.rank}th`}
                      </td>
                      <td className="px-3 py-1.5" style={{ color: '#000000' }}>
                        {ent ? labelEntry(ent.id) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-700">
                        {s.match_wins}-{s.match_losses}
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
        )}

        {!isRR &&
          Array.from(matchesByBracket.entries()).map(([bracket, ms]) => (
            <div key={bracket} className="bg-white text-gray-900 rounded-2xl p-5">
              <h2 className="font-semibold text-lg mb-3 capitalize" style={{ color: '#000000' }}>
                {bracket} bracket
              </h2>
              {Array.from(new Set(ms.map((m) => m.round)))
                .sort((a, b) => a - b)
                .map((round) => (
                  <div key={round} className="mb-4">
                    <div className="text-xs uppercase text-gray-500 font-semibold mb-2">
                      Round {round}
                    </div>
                    <div className="space-y-1.5">
                      {ms
                        .filter((m) => m.round === round)
                        .sort((a, b) => a.slot - b.slot)
                        .map((m) => {
                          const aWon = m.winner_side === 'a';
                          const bWon = m.winner_side === 'b';
                          return (
                            <div
                              key={m.id}
                              className="border border-gray-200 rounded-lg p-2 grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center text-sm"
                            >
                              <div
                                className={aWon ? 'font-semibold text-emerald-700' : 'text-gray-900'}
                                style={!aWon ? { color: '#000000' } : undefined}
                              >
                                {labelEntry(m.player1_id)}
                              </div>
                              <div className="text-xs text-gray-400">vs</div>
                              <div
                                className={bWon ? 'font-semibold text-emerald-700' : 'text-gray-900'}
                                style={!bWon ? { color: '#000000' } : undefined}
                              >
                                {labelEntry(m.player3_id)}
                              </div>
                              <div className="text-xs font-mono text-gray-700 w-20 text-right truncate">
                                {m.score || (m.status === 'completed' ? '—' : '')}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
            </div>
          ))}

        {matchesList.length === 0 && (
          <div className="bg-white/5 rounded-xl p-8 text-center text-white/60">
            Bracket hasn't been generated yet — check back closer to start time.
          </div>
        )}

        <div className="text-center text-xs text-white/40 print:text-gray-500">
          <Link href={`/tournaments/${slug}`} className="hover:text-white/60 print:hidden">
            ← Back to tournament
          </Link>
          <div className="mt-2 hidden print:block">Powered by CoachMode</div>
        </div>
      </main>
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
