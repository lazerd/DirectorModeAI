/**
 * Presentational tournament draw — the read-only "shape" of the event.
 *
 * Hookless + no server-only imports, so it renders in BOTH the server print
 * route (/tournaments/[slug]/draw) and the client admin Draw tab. Picks the
 * right layout for the format:
 *   - flighted / single round robin → RR grid draw sheet (crosstab + record)
 *   - compass → directional placement groups
 *   - single-elim / FMLC / FFIC → main (+ consolation) bracket columns
 */

import { isCompassFormat, buildCompassGroups } from '@/lib/compassLayout';
import { buildRoundRobinGrid, type RRCell } from '@/lib/roundRobinGrid';
import PanScroll from './PanScroll';

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

export default function DrawView({
  format,
  entries,
  matches,
  revealAllSeeds = true,
}: {
  format: string;
  entries: Entry[];
  matches: Match[];
  /** Public print view hides all but the top-4 seeds; the admin tab shows all. */
  revealAllSeeds?: boolean;
}) {
  const entryById = new Map(entries.map((en) => [en.id, en]));

  if (matches.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-gray-500">
        The draw has not been generated yet.
      </div>
    );
  }

  const isRR = format === 'rr-singles' || format === 'rr-doubles';
  if (isRR) {
    const grid = buildRoundRobinGrid(entries, matches);
    return (
      <div className="space-y-6 print:space-y-4">
        {grid.flights.map((flight) => (
          <section key={flight.key} className="bracket-card">
            <div className="flex items-baseline gap-2 mb-2 flex-wrap">
              <h2 className="text-xl font-bold print:text-base">{flight.name}</h2>
              <span className="text-xs text-gray-500">
                {flight.players.length} players ·{' '}
                {flight.complete ? 'complete' : 'in progress'}
              </span>
            </div>
            <PanScroll maxHeightClass="max-h-none" className="rounded-lg border border-gray-200 print:border-gray-400">
              <table className="border-collapse text-sm w-full">
                <thead>
                  <tr className="bg-gray-50 print:bg-gray-100">
                    <th className="text-left font-semibold text-gray-700 px-2 py-1.5 border-b border-r border-gray-200 min-w-[160px] sticky left-0 bg-gray-50 print:static">
                      Player
                    </th>
                    {flight.players.map((_, j) => (
                      <th
                        key={j}
                        className="w-14 text-center font-semibold text-gray-500 px-1 py-1.5 border-b border-gray-200 text-xs"
                        title={flight.players[j].name}
                      >
                        {j + 1}
                      </th>
                    ))}
                    <th className="w-14 text-center font-semibold text-gray-700 px-1 py-1.5 border-b border-l border-gray-200 text-xs">
                      W-L
                    </th>
                    <th className="w-12 text-center font-semibold text-gray-700 px-1 py-1.5 border-b border-gray-200 text-xs">
                      Fin
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {flight.rows.map((row, i) => (
                    <tr key={row.id} className="odd:bg-white even:bg-gray-50/50">
                      <td className="px-2 py-1.5 border-r border-gray-200 sticky left-0 bg-inherit print:static">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-gray-400 text-xs w-4 text-right tabular-nums">
                            {i + 1}
                          </span>
                          <span
                            className={`w-5 h-5 inline-flex items-center justify-center text-[10px] font-bold rounded flex-shrink-0 ${
                              row.seed != null && (revealAllSeeds || row.seed <= 4)
                                ? 'bg-gray-900 text-white'
                                : 'text-gray-400 border border-gray-200'
                            }`}
                          >
                            {row.seed != null && (revealAllSeeds || row.seed <= 4) ? row.seed : '·'}
                          </span>
                          <span className="truncate font-medium text-gray-900">{row.name}</span>
                        </div>
                      </td>
                      {row.cells.map((cell, j) => (
                        <RRCellView key={j} cell={cell} />
                      ))}
                      <td className="text-center px-1 py-1.5 border-l border-gray-200 font-mono font-semibold text-gray-900 tabular-nums">
                        {row.wins}-{row.losses}
                      </td>
                      <td className="text-center px-1 py-1.5 font-bold text-gray-900">
                        {row.finish
                          ? row.finish === 1
                            ? '1st'
                            : row.finish === 2
                              ? '2nd'
                              : row.finish === 3
                                ? '3rd'
                                : `${row.finish}th`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PanScroll>
          </section>
        ))}

        {grid.crossover.length > 0 && (
          <section className="bracket-card">
            <h2 className="text-xl font-bold mb-2 print:text-base">Crossover / Placement</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {grid.crossover.map((c) => {
                const sets = parseScoreSets(c.score);
                const marker = scoreMarker(c.score);
                return (
                  <div
                    key={c.id}
                    className="border border-gray-300 rounded-lg overflow-hidden text-sm"
                  >
                    <div className="px-2 py-1 bg-gray-100 border-b border-gray-200 text-[11px] font-bold uppercase tracking-wide text-gray-700 print:bg-gray-200">
                      {c.label}
                    </div>
                    <CrossRow name={c.aName} won={c.winner === 'a'} sets={sets?.a ?? null} marker={c.winner === 'a' ? marker : null} pending={c.pending} />
                    <div className="border-t border-gray-200" />
                    <CrossRow name={c.bName} won={c.winner === 'b'} sets={sets?.b ?? null} marker={c.winner === 'b' ? marker : null} pending={c.pending} />
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    );
  }

  const compassGroups = isCompassFormat(format) ? buildCompassGroups(matches) : null;
  if (compassGroups) {
    return (
      <div className="space-y-6 print:space-y-4">
        <p className="text-sm text-gray-600 mb-1 print:text-xs max-w-2xl">
          A compass draw keeps everyone playing: <b>win and you head East</b> toward the
          championship, <b>lose and you head West</b>, fanning into North, South and the corner
          playoffs so <b>every player earns a final placement</b>.
        </p>
        <p className="text-xs text-gray-400 mb-2 print:hidden">↔ Click and drag (or scroll) to pan across each draw.</p>
        {compassGroups.map((g) => (
          <section
            key={g.id}
            className="bracket-card pl-3 border-l-4 print:pl-2"
            style={{ borderLeftColor: g.accent }}
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-xl font-bold print:text-base">{g.direction}</h2>
              <span
                className="px-2 py-0.5 rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: g.accent }}
              >
                {g.place}
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-3 print:text-xs">{g.subtitle}</p>
            <PanScroll className="rounded-lg border border-gray-100 print:border-0">
              <div className="flex gap-6 min-w-max items-stretch p-1 print:gap-4 print:p-0">
                {g.stages.map((st) => {
                  const stageMatches = matches
                    .filter((m) => m.bracket === st.bracket && m.round === st.round)
                    .sort((a, b) => a.slot - b.slot);
                  return (
                    <div
                      key={`${st.bracket}:${st.round}`}
                      className="flex flex-col min-w-[260px] print:min-w-[210px]"
                    >
                      <div className="text-center text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-3 pb-2 border-b border-gray-300 print:text-[10px]">
                        {st.roundName}
                      </div>
                      <div className="flex-1 flex flex-col justify-around gap-4 print:gap-2">
                        {stageMatches.map((m) => (
                          <DrawMatchCard key={m.id} m={m} entryById={entryById} revealAllSeeds={revealAllSeeds} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </PanScroll>
          </section>
        ))}
      </div>
    );
  }

  // Generic elimination bracket (single-elim / FMLC / FFIC).
  const brackets = (['main', 'consolation'] as const).filter((b) =>
    matches.some((m) => m.bracket === b)
  );
  return (
    <div className="space-y-8 print:space-y-4">
      <p className="text-xs text-gray-400 print:hidden">↔ Click and drag (or scroll) to pan across the bracket.</p>
      {brackets.map((bracket) => {
        const bMatches = matches
          .filter((m) => m.bracket === bracket)
          .sort((a, b) => a.round - b.round || a.slot - b.slot);
        const rounds = Array.from(new Set(bMatches.map((m) => m.round))).sort((a, b) => a - b);
        const totalRounds = rounds.length;
        return (
          <section key={bracket} className="bracket-card">
            <h2 className="text-xl font-bold mb-3 print:text-base">
              {bracket === 'main' ? 'Main Draw' : 'Consolation Draw'}
            </h2>
            <PanScroll className="rounded-lg border border-gray-100 print:border-0">
              <div className="flex gap-6 min-w-max items-stretch p-1 print:gap-4 print:p-0">
                {rounds.map((round, roundIdx) => {
                  const roundMatches = bMatches.filter((m) => m.round === round);
                  return (
                    <div key={round} className="flex flex-col min-w-[260px] print:min-w-[210px]">
                      <div className="text-center text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-3 pb-2 border-b border-gray-300 print:text-[10px]">
                        {roundLabel(roundIdx + 1, totalRounds, bracket)}
                      </div>
                      <div className="flex-1 flex flex-col justify-around gap-4 print:gap-2">
                        {roundMatches.map((m) => (
                          <DrawMatchCard key={m.id} m={m} entryById={entryById} revealAllSeeds={revealAllSeeds} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </PanScroll>
          </section>
        );
      })}
    </div>
  );
}

function RRCellView({ cell }: { cell: RRCell }) {
  if (cell.kind === 'self') {
    return <td className="text-center bg-gray-200/70 print:bg-gray-300" />;
  }
  if (cell.kind === 'empty') {
    return <td className="text-center text-gray-300 px-1 py-1.5">—</td>;
  }
  if (cell.kind === 'pending') {
    return <td className="text-center text-gray-300 px-1 py-1.5">·</td>;
  }
  return (
    <td
      className={`text-center px-1 py-1.5 font-mono text-xs tabular-nums whitespace-nowrap ${
        cell.won ? 'text-emerald-700 font-semibold bg-emerald-50/60' : 'text-gray-500'
      }`}
    >
      {cell.text}
    </td>
  );
}

function CrossRow({
  name,
  won,
  sets,
  marker,
  pending,
}: {
  name: string;
  won: boolean;
  sets: string[] | null;
  marker: string | null;
  pending: boolean;
}) {
  return (
    <div className={`px-2 py-1.5 flex items-center justify-between gap-2 ${won ? 'bg-emerald-50' : ''}`}>
      <span className={`truncate ${won ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
        {name}
      </span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {sets && sets.length > 0 && (
          <span className={`font-mono text-xs tabular-nums ${won ? 'font-bold' : 'text-gray-500'}`}>
            {sets.join(' ')}
          </span>
        )}
        {won && marker && (
          <span className="px-1 py-0.5 bg-gray-900 text-white text-[9px] font-bold rounded">{marker}</span>
        )}
        {pending && <span className="text-[10px] text-gray-400 italic">TBD</span>}
      </div>
    </div>
  );
}

function DrawMatchCard({
  m,
  entryById,
  revealAllSeeds,
}: {
  m: Match;
  entryById: Map<string, Entry>;
  revealAllSeeds: boolean;
}) {
  const teamA = m.player1_id ? entryById.get(m.player1_id) : undefined;
  const teamB = m.player3_id ? entryById.get(m.player3_id) : undefined;
  const aWon = m.winner_side === 'a';
  const bWon = m.winner_side === 'b';
  const parsed = parseScoreSets(m.score);
  const marker = scoreMarker(m.score);
  return (
    <div className="border border-gray-400 rounded bg-white overflow-hidden print:border-gray-500">
      <DrawTeamRow entry={teamA} won={aWon} sets={parsed?.a ?? null} marker={aWon ? marker : null} revealAllSeeds={revealAllSeeds} />
      <div className="border-t border-gray-300" />
      <DrawTeamRow entry={teamB} won={bWon} sets={parsed?.b ?? null} marker={bWon ? marker : null} revealAllSeeds={revealAllSeeds} />
      {(m.court || m.scheduled_at) && (
        <div className="border-t border-gray-200 px-2 py-0.5 text-[10px] text-gray-600 flex gap-2 print:text-[9px]">
          {m.court && <span>Court {m.court}</span>}
          {m.scheduled_at && <span>{m.scheduled_at.slice(0, 5)}</span>}
        </div>
      )}
    </div>
  );
}

function DrawTeamRow({
  entry,
  won,
  sets,
  marker,
  revealAllSeeds,
}: {
  entry: Entry | undefined;
  won: boolean;
  sets: string[] | null;
  marker: string | null;
  revealAllSeeds: boolean;
}) {
  if (!entry) {
    return (
      <div className="px-2 py-1.5 min-h-[36px] flex items-center text-gray-600 italic text-sm">
        <span className="w-6 text-center">—</span>
        <span className="ml-2">TBD</span>
      </div>
    );
  }
  const showSeed = entry.seed != null && (revealAllSeeds || entry.seed <= 4);
  return (
    <div className="px-2 py-1.5 min-h-[36px] flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-6 h-5 inline-flex items-center justify-center text-[10px] font-bold rounded flex-shrink-0 ${
            showSeed ? 'bg-gray-900 text-white' : 'text-gray-500 border border-gray-300'
          }`}
        >
          {showSeed ? entry.seed : '·'}
        </span>
        <span className={`text-sm truncate ${won ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
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
