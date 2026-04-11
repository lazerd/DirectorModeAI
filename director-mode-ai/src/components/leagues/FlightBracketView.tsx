/**
 * Compass draw bracket visualization.
 *
 * Renders a single 16-player or 8-player flight as a compass-rose layout:
 *
 *     NW (9-12)    │   Round 1   │   NE (1-4)
 *     ┌──────┐     │   ┌─────┐   │   ┌──────┐
 *     │ R4   │←── R3 R2 │  1  │ R2 R3 ──→│ R4  │
 *     │final │     │   ├─────┤   │   │final │
 *     └──────┘     │   │  2  │   │   └──────┘
 *     SW (13-16)   │   │  …  │   │   SE (5-8)
 *     ┌──────┐     │   └─────┘   │   ┌──────┐
 *     │ R4   │←── R3 ──          │   │ R4   │
 *     └──────┘     │             │   └──────┘
 *
 * Winners of R1 go East (right), losers go West (left). After R2, East
 * winners go to NE (championship path, 1st-4th), East losers to SE (5th-8th),
 * West winners to NW (9th-12th), West losers to SW (13th-16th). Each of the
 * 4 sub-brackets is a 4-player knockout (R3 semis + R4 final + 3rd place).
 *
 * Also supports round-robin and single-elimination flights via a simpler
 * round-by-round layout.
 */

'use client';

import React from 'react';
import { Trophy, Users } from 'lucide-react';

export type BracketEntry = {
  id: string;
  captain_name: string;
  partner_name: string | null;
  seed_in_flight: number | null;
};

export type BracketMatch = {
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

export type BracketFlight = {
  id: string;
  flight_name: string;
  size: number;
  num_rounds: number;
  status: string;
};

type Props = {
  flight: BracketFlight;
  entries: BracketEntry[];
  matches: BracketMatch[];
  leagueType: 'compass' | 'round_robin' | 'single_elimination';
};

export default function FlightBracketView({ flight, entries, matches, leagueType }: Props) {
  const entryById = React.useMemo(() => {
    const m = new Map<string, BracketEntry>();
    for (const e of entries) m.set(e.id, e);
    return m;
  }, [entries]);

  if (leagueType === 'round_robin') {
    return <RoundRobinView flight={flight} entries={entries} matches={matches} entryById={entryById} />;
  }
  if (leagueType === 'single_elimination') {
    return <SingleElimView flight={flight} matches={matches} entryById={entryById} />;
  }
  return <CompassView flight={flight} entries={entries} matches={matches} entryById={entryById} />;
}

// ============================================
// Compass layout
// ============================================

function CompassView({
  flight,
  entries,
  matches,
  entryById,
}: {
  flight: BracketFlight;
  entries: BracketEntry[];
  matches: BracketMatch[];
  entryById: Map<string, BracketEntry>;
}) {
  const r1 = matches.filter(m => m.round === 1).sort((a, b) => a.match_index - b.match_index);
  const r2East = matches.filter(m => m.round === 2 && (m.bracket_position || '').startsWith('E')).sort((a, b) => a.match_index - b.match_index);
  const r2West = matches.filter(m => m.round === 2 && (m.bracket_position || '').startsWith('W')).sort((a, b) => a.match_index - b.match_index);

  const subBracket = (prefix: 'NE' | 'SE' | 'NW' | 'SW') => {
    const r3 = matches.filter(m => m.round === 3 && (m.bracket_position || '').startsWith(prefix));
    const r4 = matches.filter(m => m.round === 4 && (m.bracket_position || '').startsWith(prefix));
    return { r3, r4 };
  };

  const ne = subBracket('NE');
  const se = subBracket('SE');
  const nw = subBracket('NW');
  const sw = subBracket('SW');

  const isEightPlayer = flight.size === 8;

  return (
    <div className="space-y-6">
      {/* Flight header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-orange-500" />
          <h3 className="font-semibold text-base">
            Flight {flight.flight_name}{' '}
            <span className="text-sm text-gray-500 font-normal">
              ({flight.size}-player compass, {flight.num_rounds} rounds)
            </span>
          </h3>
        </div>
        <span className={`px-2 py-0.5 text-xs rounded-full ${
          flight.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
        }`}>
          {flight.status}
        </span>
      </div>

      {/* Seeded entries list (collapsible on mobile) */}
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-600 font-medium select-none">
          Show seeded entries ({entries.length})
        </summary>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-gray-600">
          {entries
            .slice()
            .sort((a, b) => (a.seed_in_flight || 99) - (b.seed_in_flight || 99))
            .map(e => (
              <div key={e.id} className="truncate">
                <span className="text-gray-400 w-5 inline-block">{e.seed_in_flight}.</span>
                {entryLabel(e)}
              </div>
            ))}
        </div>
      </details>

      {/* The compass layout itself */}
      <div className="overflow-x-auto pb-4">
        <div className="min-w-[900px]">
          {/* Main grid: 3 columns — West side | Center (R1) | East side */}
          <div className="grid grid-cols-[1fr,1fr,1fr] gap-4">
            {/* ============ WEST SIDE (losers from R1) ============ */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-400 text-right pr-2">WEST ← losers of R1</div>
              <div className="grid grid-cols-2 gap-2">
                {/* R2 West column */}
                <div className="space-y-2">
                  <div className="text-[10px] uppercase text-gray-400 tracking-wide">R2 West</div>
                  {r2West.map(m => (
                    <MatchCard key={m.id} match={m} entryById={entryById} compact />
                  ))}
                </div>
                {/* R1 Bottom half (losers going west) */}
                <div className="space-y-2">
                  <div className="text-[10px] uppercase text-gray-400 tracking-wide">R1 (→ W)</div>
                  {r1.slice(4, 8).map(m => (
                    <MatchCard key={m.id} match={m} entryById={entryById} compact />
                  ))}
                </div>
              </div>
            </div>

            {/* ============ CENTER (R1 top half) ============ */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-400 text-center">ROUND 1</div>
              <div className="text-[10px] uppercase text-gray-400 tracking-wide text-center">All players start here</div>
              <div className="space-y-1">
                {r1.slice(0, 4).map(m => (
                  <MatchCard key={m.id} match={m} entryById={entryById} compact />
                ))}
                <div className="h-2" />
                {r1.slice(4, 8).length > 0 && r1.slice(0, 4).length === 4 && (
                  <div className="text-[10px] uppercase text-gray-400 tracking-wide text-center border-t border-gray-200 pt-2">
                    (continued W →)
                  </div>
                )}
              </div>
            </div>

            {/* ============ EAST SIDE (winners from R1) ============ */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-400 pl-2">winners of R1 → EAST</div>
              <div className="grid grid-cols-2 gap-2">
                {/* R1 top half (winners going east) */}
                <div className="space-y-2">
                  <div className="text-[10px] uppercase text-gray-400 tracking-wide">R1 (→ E)</div>
                  {r1.slice(0, 4).map(m => (
                    <MatchCard key={m.id} match={m} entryById={entryById} compact />
                  ))}
                </div>
                {/* R2 East column */}
                <div className="space-y-2">
                  <div className="text-[10px] uppercase text-gray-400 tracking-wide">R2 East</div>
                  {r2East.map(m => (
                    <MatchCard key={m.id} match={m} entryById={entryById} compact />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {!isEightPlayer && (
            <>
              {/* ============ Sub-brackets: 2x2 grid ============ */}
              <div className="mt-8 pt-6 border-t border-gray-200">
                <div className="text-center text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                  Directional sub-brackets
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <SubBracketCard
                    label="NW"
                    title="9th – 12th place"
                    description="Losers of R1 who won R2"
                    r3={nw.r3}
                    r4={nw.r4}
                    entryById={entryById}
                  />
                  <SubBracketCard
                    label="NE"
                    title="Championship (1st – 4th)"
                    description="Undefeated path"
                    r3={ne.r3}
                    r4={ne.r4}
                    entryById={entryById}
                    highlight
                  />
                  <SubBracketCard
                    label="SW"
                    title="13th – 16th place"
                    description="0W-2L after R2"
                    r3={sw.r3}
                    r4={sw.r4}
                    entryById={entryById}
                  />
                  <SubBracketCard
                    label="SE"
                    title="5th – 8th place"
                    description="Winners of R1 who lost R2"
                    r3={se.r3}
                    r4={se.r4}
                    entryById={entryById}
                  />
                </div>
              </div>
            </>
          )}

          {isEightPlayer && (
            /* 8-player compass only has 3 rounds, finals are the R3 matches */
            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="text-center text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                Final placements
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {matches.filter(m => m.round === 3).sort((a, b) => a.match_index - b.match_index).map(m => (
                  <div key={m.id} className="bg-orange-50 border border-orange-200 rounded-lg p-2">
                    <div className="text-[10px] uppercase text-orange-700 tracking-wide mb-1">
                      {m.bracket_position || ''}
                    </div>
                    <MatchCard match={m} entryById={entryById} compact />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SubBracketCard({
  label,
  title,
  description,
  r3,
  r4,
  entryById,
  highlight,
}: {
  label: string;
  title: string;
  description: string;
  r3: BracketMatch[];
  r4: BracketMatch[];
  entryById: Map<string, BracketEntry>;
  highlight?: boolean;
}) {
  const sortedR3 = [...r3].sort((a, b) => a.match_index - b.match_index);
  const final = r4.find(m => (m.bracket_position || '').endsWith('-FINAL'));
  const third = r4.find(m => (m.bracket_position || '').endsWith('-3RD'));

  return (
    <div className={`rounded-lg border p-3 ${
      highlight ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'
    }`}>
      <div className="flex items-baseline justify-between mb-3">
        <div className={`text-xs font-semibold uppercase tracking-wider ${highlight ? 'text-amber-700' : 'text-gray-500'}`}>
          {label}
        </div>
        <div className="text-[10px] text-gray-400 text-right">
          <div>{title}</div>
          <div>{description}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="text-[10px] uppercase text-gray-400 tracking-wide">R3 Semis</div>
          {sortedR3.map(m => <MatchCard key={m.id} match={m} entryById={entryById} compact />)}
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase text-gray-400 tracking-wide">R4 Finals</div>
          {final && (
            <>
              <div className="text-[9px] text-amber-600 font-medium">FINAL (1st/2nd)</div>
              <MatchCard match={final} entryById={entryById} compact />
            </>
          )}
          {third && (
            <>
              <div className="text-[9px] text-gray-500 font-medium mt-1">3rd place</div>
              <MatchCard match={third} entryById={entryById} compact />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Round robin layout
// ============================================

function RoundRobinView({
  flight,
  entries,
  matches,
  entryById,
}: {
  flight: BracketFlight;
  entries: BracketEntry[];
  matches: BracketMatch[];
  entryById: Map<string, BracketEntry>;
}) {
  const rounds = Array.from(new Set(matches.map(m => m.round))).sort((a, b) => a - b);

  // Compute standings
  const stats = new Map<string, { wins: number; losses: number; }>();
  for (const e of entries) stats.set(e.id, { wins: 0, losses: 0 });
  for (const m of matches) {
    if (m.winner_entry_id && m.entry_a_id && m.entry_b_id) {
      const winStats = stats.get(m.winner_entry_id);
      if (winStats) winStats.wins += 1;
      const loserId = m.winner_entry_id === m.entry_a_id ? m.entry_b_id : m.entry_a_id;
      const loseStats = stats.get(loserId);
      if (loseStats) loseStats.losses += 1;
    }
  }
  const standings = entries.slice().sort((a, b) => {
    const sa = stats.get(a.id) || { wins: 0, losses: 0 };
    const sb = stats.get(b.id) || { wins: 0, losses: 0 };
    if (sb.wins !== sa.wins) return sb.wins - sa.wins;
    return sa.losses - sb.losses;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-orange-500" />
          <h3 className="font-semibold text-base">
            Flight {flight.flight_name}
            <span className="text-sm text-gray-500 font-normal ml-2">
              ({flight.size}-player round robin, {flight.num_rounds} rounds)
            </span>
          </h3>
        </div>
        <span className={`px-2 py-0.5 text-xs rounded-full ${
          flight.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
        }`}>
          {flight.status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">All matches</div>
          <div className="space-y-3">
            {rounds.map(round => {
              const roundMatches = matches.filter(m => m.round === round).sort((a, b) => a.match_index - b.match_index);
              return (
                <div key={round}>
                  <div className="text-xs text-gray-500 font-medium mb-1">Round {round}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {roundMatches.map(m => (
                      <MatchCard key={m.id} match={m} entryById={entryById} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Standings</div>
          <div className="bg-gray-50 rounded-lg border border-gray-200 divide-y divide-gray-200">
            {standings.map((e, idx) => {
              const s = stats.get(e.id) || { wins: 0, losses: 0 };
              return (
                <div key={e.id} className="p-2 flex items-center gap-2 text-sm">
                  <span className="w-5 text-gray-400 font-mono text-xs">{idx + 1}.</span>
                  <span className="flex-1 truncate">{entryLabel(e)}</span>
                  <span className="text-xs text-gray-600 font-mono">{s.wins}-{s.losses}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Single elimination layout
// ============================================

function SingleElimView({
  flight,
  matches,
  entryById,
}: {
  flight: BracketFlight;
  matches: BracketMatch[];
  entryById: Map<string, BracketEntry>;
}) {
  const rounds = Array.from(new Set(matches.map(m => m.round))).sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-orange-500" />
          <h3 className="font-semibold text-base">
            Flight {flight.flight_name}
            <span className="text-sm text-gray-500 font-normal ml-2">
              ({flight.size}-player single elimination, {flight.num_rounds} rounds)
            </span>
          </h3>
        </div>
        <span className={`px-2 py-0.5 text-xs rounded-full ${
          flight.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
        }`}>
          {flight.status}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className={`grid gap-4 min-w-max`} style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(220px, 1fr))` }}>
          {rounds.map(round => {
            const roundMatches = matches.filter(m => m.round === round).sort((a, b) => a.match_index - b.match_index);
            const isFinal = round === rounds[rounds.length - 1];
            return (
              <div key={round}>
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
                  {isFinal ? 'Final' : round === rounds[rounds.length - 2] ? 'Semifinal' : `Round ${round}`}
                </div>
                <div className="space-y-2">
                  {roundMatches.map(m => (
                    <MatchCard key={m.id} match={m} entryById={entryById} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Shared match card
// ============================================

function MatchCard({
  match,
  entryById,
  compact,
}: {
  match: BracketMatch;
  entryById: Map<string, BracketEntry>;
  compact?: boolean;
}) {
  const a = match.entry_a_id ? entryById.get(match.entry_a_id) : null;
  const b = match.entry_b_id ? entryById.get(match.entry_b_id) : null;
  const aWon = match.winner_entry_id === match.entry_a_id;
  const bWon = match.winner_entry_id === match.entry_b_id;
  const isConfirmed = match.status === 'confirmed';
  const isReported = match.status === 'reported';
  const isPending = match.status === 'pending';
  const textSize = compact ? 'text-[11px]' : 'text-xs';
  const pad = compact ? 'p-1.5' : 'p-2';

  return (
    <div className={`bg-white border border-gray-300 rounded ${pad} ${textSize} leading-tight`}>
      <div className={`flex items-center justify-between gap-1 ${aWon ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
        <span className="truncate flex-1 min-w-0">
          {a ? `${a.seed_in_flight ?? '?'}. ${entryLabel(a, compact)}` : <span className="text-gray-300 italic">TBD</span>}
        </span>
      </div>
      <div className="h-px bg-gray-100 my-0.5" />
      <div className={`flex items-center justify-between gap-1 ${bWon ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
        <span className="truncate flex-1 min-w-0">
          {b ? `${b.seed_in_flight ?? '?'}. ${entryLabel(b, compact)}` : <span className="text-gray-300 italic">TBD</span>}
        </span>
      </div>
      {(isConfirmed || isReported) && match.score && (
        <div className="mt-1 text-[10px] text-gray-500 font-mono truncate">
          {match.score}
          {isReported && <span className="ml-1 text-yellow-600">(pending)</span>}
        </div>
      )}
      {isPending && match.deadline && compact && (
        <div className="mt-1 text-[9px] text-gray-400">due {match.deadline}</div>
      )}
    </div>
  );
}

function entryLabel(e: BracketEntry, compact?: boolean): string {
  if (!e.partner_name) {
    return compact ? lastName(e.captain_name) : e.captain_name;
  }
  if (compact) {
    return `${lastName(e.captain_name)} / ${lastName(e.partner_name)}`;
  }
  return `${e.captain_name} & ${e.partner_name}`;
}

function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1] || full;
}
