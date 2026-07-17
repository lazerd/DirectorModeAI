import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import PrintBar from './PrintBar';

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
  'compass-singles': 'Compass Draw — Singles',
  'compass-doubles': 'Compass Draw — Doubles',
};

type Entry = {
  id: string;
  player_name: string;
  partner_name: string | null;
  seed: number | null;
};

type Match = {
  id: string;
  bracket: 'main' | 'consolation';
  round: number;
  slot: number;
  player1_id: string | null;
  player3_id: string | null;
  score: string | null;
  winner_side: 'a' | 'b' | null;
  status: string;
  court: string | null;
  scheduled_at: string | null;
};

function roundLabel(round: number, totalRounds: number, bracket: 'main' | 'consolation'): string {
  if (round === totalRounds) return bracket === 'consolation' ? 'Consolation Final' : 'Final';
  if (round === totalRounds - 1) return 'Semifinals';
  if (round === totalRounds - 2) return 'Quarterfinals';
  const playersLeft = 2 ** (totalRounds - round + 1);
  return `Round of ${playersLeft}`;
}

function parseScoreSets(score: string | null): { a: string[]; b: string[] } | null {
  if (!score) return null;
  const cleaned = score.replace(/,?\s*RET$/i, '').replace(/^(W\/O|WO|DEF)$/i, '');
  if (!cleaned.trim()) return null;
  const pairs = cleaned.split(/[,\s]+/).filter(Boolean);
  const a: string[] = [];
  const b: string[] = [];
  for (const s of pairs) {
    const m = s.match(/^(\d+)-(\d+)$/);
    if (!m) return null;
    a.push(m[1]);
    b.push(m[2]);
  }
  return a.length === 0 ? null : { a, b };
}

function scoreMarker(score: string | null): string | null {
  if (!score) return null;
  const s = score.trim().toUpperCase();
  if (s === 'W/O' || s === 'WO') return 'W/O';
  if (s === 'DEF') return 'DEF';
  if (s.endsWith(', RET') || s === 'RET') return 'RET';
  return null;
}

function formatTeamName(entry: Entry | undefined): string {
  if (!entry) return 'TBD';
  if (entry.partner_name) return `${entry.player_name} / ${entry.partner_name}`;
  return entry.player_name;
}

export default async function PrintDrawPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const admin = getSupabaseAdmin();

  const { data: ev } = await admin
    .from('events')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (!ev || !FORMAT_LABELS[(ev as any).match_format]) return notFound();
  const e = ev as any;

  const [entriesRes, matchesRes] = await Promise.all([
    admin
      .from('tournament_entries')
      .select('id, player_name, partner_name, seed')
      .eq('event_id', e.id),
    admin
      .from('tournament_matches')
      .select('id, bracket, round, slot, player1_id, player3_id, score, winner_side, status, court, scheduled_at')
      .eq('event_id', e.id)
      .order('round')
      .order('slot'),
  ]);

  const entries = (entriesRes.data as Entry[]) || [];
  const matches = (matchesRes.data as Match[]) || [];
  const entryById = new Map(entries.map((en) => [en.id, en]));

  const brackets = (['main', 'consolation'] as const).filter((b) =>
    matches.some((m) => m.bracket === b)
  );

  return (
    <>
      {/* Print-only CSS — hide browser chrome / nav on print */}
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .bracket-card { box-shadow: none !important; border-color: #d1d5db !important; }
          @page { size: landscape; margin: 0.4in; }
        }
        @media screen {
          body { background: #f9fafb; }
        }
      `}</style>

      <div className="min-h-screen bg-white text-gray-900">
        <PrintBar
          name={e.name}
          date={e.event_date}
          format={FORMAT_LABELS[e.match_format]}
        />

        <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 print:px-0 print:py-2">
          {/* Title block */}
          <div className="mb-6 print:mb-3">
            <h1 className="text-3xl font-bold print:text-2xl">{e.name}</h1>
            <p className="text-sm text-gray-600 print:text-xs">
              {FORMAT_LABELS[e.match_format]}
              {e.event_date && ` · ${format(new Date(e.event_date), 'EEEE, MMMM d, yyyy')}`}
              {e.event_date !== e.end_date && e.end_date && ` – ${format(new Date(e.end_date), 'MMMM d, yyyy')}`}
            </p>
          </div>

          {matches.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-gray-500">
              The draw has not been generated yet.
            </div>
          ) : (
            <div className="space-y-8 print:space-y-4">
              {brackets.map((bracket) => {
                const bMatches = matches
                  .filter((m) => m.bracket === bracket)
                  .sort((a, b) => a.round - b.round || a.slot - b.slot);
                const rounds = Array.from(new Set(bMatches.map((m) => m.round))).sort(
                  (a, b) => a - b
                );
                const totalRounds = rounds.length;
                return (
                  <section key={bracket} className="bracket-card">
                    <h2 className="text-xl font-bold mb-3 print:text-base">
                      {bracket === 'main' ? 'Main Draw' : 'Consolation Draw'}
                    </h2>
                    <div className="overflow-x-auto print:overflow-visible">
                      <div className="flex gap-6 min-w-max items-stretch print:gap-4">
                        {rounds.map((round, roundIdx) => {
                          const roundMatches = bMatches.filter((m) => m.round === round);
                          return (
                            <div
                              key={round}
                              className="flex flex-col min-w-[260px] print:min-w-[210px]"
                            >
                              <div className="text-center text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-3 pb-2 border-b border-gray-300 print:text-[10px]">
                                {roundLabel(roundIdx + 1, totalRounds, bracket)}
                              </div>
                              <div className="flex-1 flex flex-col justify-around gap-4 print:gap-2">
                                {roundMatches.map((m) => {
                                  const teamA = m.player1_id ? entryById.get(m.player1_id) : undefined;
                                  const teamB = m.player3_id ? entryById.get(m.player3_id) : undefined;
                                  const aWon = m.winner_side === 'a';
                                  const bWon = m.winner_side === 'b';
                                  const parsed = parseScoreSets(m.score);
                                  const marker = scoreMarker(m.score);
                                  return (
                                    <div
                                      key={m.id}
                                      className="border border-gray-400 rounded bg-white overflow-hidden print:border-gray-500"
                                    >
                                      <DrawTeamRow
                                        entry={teamA}
                                        won={aWon}
                                        sets={parsed?.a ?? null}
                                        marker={aWon ? marker : null}
                                      />
                                      <div className="border-t border-gray-300" />
                                      <DrawTeamRow
                                        entry={teamB}
                                        won={bWon}
                                        sets={parsed?.b ?? null}
                                        marker={bWon ? marker : null}
                                      />
                                      {(m.court || m.scheduled_at) && (
                                        <div className="border-t border-gray-200 px-2 py-0.5 text-[10px] text-gray-600 flex gap-2 print:text-[9px]">
                                          {m.court && <span>Court {m.court}</span>}
                                          {m.scheduled_at && (
                                            <span>{m.scheduled_at.slice(0, 5)}</span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <footer className="mt-8 pt-4 border-t border-gray-200 text-[10px] text-gray-500 text-center print:mt-3">
            club.coachmode.ai · printed {format(new Date(), 'MMM d, yyyy h:mm a')}
          </footer>
        </main>
      </div>
    </>
  );
}

function DrawTeamRow({
  entry,
  won,
  sets,
  marker,
}: {
  entry: Entry | undefined;
  won: boolean;
  sets: string[] | null;
  marker: string | null;
}) {
  if (!entry) {
    return (
      <div className="px-2 py-1.5 min-h-[36px] flex items-center text-gray-600 italic text-sm">
        <span className="w-6 text-center">—</span>
        <span className="ml-2">TBD</span>
      </div>
    );
  }
  return (
    <div className="px-2 py-1.5 min-h-[36px] flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-6 h-5 inline-flex items-center justify-center text-[10px] font-bold rounded flex-shrink-0 ${
            entry.seed != null ? 'bg-gray-900 text-white' : 'text-gray-500 border border-gray-300'
          }`}
        >
          {entry.seed ?? '·'}
        </span>
        <span
          className={`text-sm truncate ${won ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}
        >
          {formatTeamName(entry)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {sets && sets.length > 0 && (
          <div
            className={`font-mono text-sm tabular-nums whitespace-nowrap flex gap-1.5 ${
              won ? 'font-bold text-gray-900' : 'text-gray-600'
            }`}
          >
            {sets.map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
        )}
        {won && marker && (
          <span className="px-1 py-0.5 bg-gray-900 text-white text-[9px] font-bold rounded tracking-wider">
            {marker}
          </span>
        )}
      </div>
    </div>
  );
}
