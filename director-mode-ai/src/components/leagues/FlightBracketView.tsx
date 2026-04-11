/**
 * Modern compass-draw bracket visualization.
 *
 * Dark-mode tournament aesthetic with glowing accents, proper tree layout
 * for each sub-bracket using flexbox vertical spacing to create visual
 * connector paths between rounds (no SVG — pure CSS).
 *
 * Sectioned layout (not a literal compass rose — that design reads as
 * "cramped boxes" on most screens):
 *   1. Header with flight info + progress meter
 *   2. Qualifying Rounds — R1 + R2 shown as two columns of match cards,
 *      with E/W labels and visual flow from R1 → R2
 *   3. Championship Bracket (NE) — prominent gold-accented section with
 *      R3 semis → R4 final + 3rd-place match
 *   4. Consolation Brackets — NW/SE/SW shown in a 3-up grid, each with
 *      muted accent colors by placement (SE amber, NW blue, SW gray)
 *
 * Also supports round-robin (table view + standings) and single-elim
 * (horizontal bracket tree).
 */

'use client';

import React from 'react';
import { Trophy, Crown, Medal, Users, Clock, CheckCircle2 } from 'lucide-react';

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

  return (
    <div className="bg-gradient-to-br from-[#001820] via-[#041e2a] to-[#002838] text-white rounded-2xl p-6 sm:p-8 border border-white/10 shadow-xl">
      {leagueType === 'round_robin' && (
        <RoundRobinView flight={flight} entries={entries} matches={matches} entryById={entryById} />
      )}
      {leagueType === 'single_elimination' && (
        <SingleElimView flight={flight} matches={matches} entryById={entryById} />
      )}
      {leagueType === 'compass' && (
        <CompassView flight={flight} entries={entries} matches={matches} entryById={entryById} />
      )}
    </div>
  );
}

// ============================================
// Shared flight header
// ============================================

function FlightHeader({
  flight,
  entries,
  matches,
  label,
}: {
  flight: BracketFlight;
  entries: BracketEntry[];
  matches: BracketMatch[];
  label: string;
}) {
  const confirmed = matches.filter(m => m.status === 'confirmed').length;
  const total = matches.length;
  const pct = total === 0 ? 0 : Math.round((confirmed / total) * 100);

  return (
    <div className="mb-8">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#D3FB52]/20 border border-[#D3FB52]/40 flex items-center justify-center">
              <Trophy size={16} className="text-[#D3FB52]" />
            </div>
            <div>
              <div className="font-semibold text-lg leading-tight">Flight {flight.flight_name}</div>
              <div className="text-xs text-white/40">{label}</div>
            </div>
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium border ${
          flight.status === 'completed'
            ? 'bg-[#D3FB52]/20 border-[#D3FB52]/40 text-[#D3FB52]'
            : 'bg-blue-500/20 border-blue-500/40 text-blue-300'
        }`}>
          {flight.status === 'completed' ? 'Completed' : 'In progress'}
        </div>
      </div>
      {/* Progress bar */}
      <div className="flex items-center gap-3 text-xs text-white/60">
        <span className="text-white/40">Progress</span>
        <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#D3FB52] to-emerald-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono">{confirmed}/{total} matches</span>
      </div>
    </div>
  );
}

// ============================================
// Compass view
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
    const r3 = matches.filter(m => m.round === 3 && (m.bracket_position || '').startsWith(prefix)).sort((a, b) => a.match_index - b.match_index);
    const r4 = matches.filter(m => m.round === 4 && (m.bracket_position || '').startsWith(prefix));
    const final = r4.find(m => (m.bracket_position || '').endsWith('-FINAL'));
    const third = r4.find(m => (m.bracket_position || '').endsWith('-3RD'));
    return { r3, final, third };
  };

  const ne = subBracket('NE');
  const se = subBracket('SE');
  const nw = subBracket('NW');
  const sw = subBracket('SW');

  const isEightPlayer = flight.size === 8;

  return (
    <div>
      <FlightHeader
        flight={flight}
        entries={entries}
        matches={matches}
        label={`${flight.size}-player compass draw`}
      />

      {/* Seed list — collapsible */}
      <details className="mb-8 group">
        <summary className="cursor-pointer text-xs uppercase tracking-wider text-white/50 hover:text-white/80 select-none flex items-center gap-2">
          <Users size={12} />
          <span>Seeded entries ({entries.length})</span>
          <span className="text-white/30 group-open:rotate-90 transition-transform">▸</span>
        </summary>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1.5 text-xs">
          {entries
            .slice()
            .sort((a, b) => (a.seed_in_flight || 99) - (b.seed_in_flight || 99))
            .map(e => (
              <div key={e.id} className="flex items-center gap-2 truncate">
                <span className="w-6 h-5 rounded bg-white/5 text-white/50 text-[10px] font-mono flex items-center justify-center flex-shrink-0">
                  {e.seed_in_flight}
                </span>
                <span className="text-white/80 truncate">{entryLabel(e)}</span>
              </div>
            ))}
        </div>
      </details>

      {/* Qualifying Rounds section */}
      <Section
        title="Qualifying Rounds"
        subtitle="Every player plays R1 in the middle. Winners flow East (championship path). Losers flow West (consolation path)."
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.2fr,1fr] gap-6">
          {/* West side */}
          <div>
            <SectionLabel color="text-blue-300" align="left">← West (Consolation)</SectionLabel>
            <div className="space-y-2">
              {r2West.map(m => (
                <MatchCard key={m.id} match={m} entryById={entryById} accent="west" />
              ))}
            </div>
          </div>

          {/* Middle: Round 1 */}
          <div>
            <SectionLabel color="text-white/60" align="center">Round 1</SectionLabel>
            <div className="space-y-2">
              {r1.map(m => (
                <MatchCard key={m.id} match={m} entryById={entryById} accent="neutral" />
              ))}
            </div>
          </div>

          {/* East side */}
          <div>
            <SectionLabel color="text-emerald-300" align="right">East (Championship) →</SectionLabel>
            <div className="space-y-2">
              {r2East.map(m => (
                <MatchCard key={m.id} match={m} entryById={entryById} accent="east" />
              ))}
            </div>
          </div>
        </div>
      </Section>

      {isEightPlayer ? (
        /* 8-player compass: only 3 rounds, R3 finals determine final placements */
        <Section
          title="Final Placements"
          subtitle="8-player compass ends at Round 3 with 4 placement matches."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {matches
              .filter(m => m.round === 3)
              .sort((a, b) => {
                // Order: NE, SE, NW, SW
                const order: Record<string, number> = { NE: 0, SE: 1, NW: 2, SW: 3 };
                const ak = (a.bracket_position || '').slice(0, 2);
                const bk = (b.bracket_position || '').slice(0, 2);
                return (order[ak] ?? 9) - (order[bk] ?? 9);
              })
              .map(m => {
                const prefix = (m.bracket_position || '').slice(0, 2);
                const placeLabel =
                  prefix === 'NE' ? '1st / 2nd'
                    : prefix === 'SE' ? '3rd / 4th'
                    : prefix === 'NW' ? '5th / 6th'
                    : prefix === 'SW' ? '7th / 8th'
                    : '';
                return (
                  <div key={m.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">{placeLabel}</div>
                    <MatchCard match={m} entryById={entryById} accent="championship" />
                  </div>
                );
              })}
          </div>
        </Section>
      ) : (
        <>
          {/* Championship Bracket — NE */}
          <Section
            title="Championship Bracket"
            subtitle="1st through 4th place. Two semifinals into a final + 3rd-place match."
            icon={<Crown size={14} className="text-amber-400" />}
            accent="gold"
          >
            <SubBracketVisual r3={ne.r3} final={ne.final} third={ne.third} entryById={entryById} accent="championship" />
          </Section>

          {/* Consolation grid */}
          <Section
            title="Consolation Brackets"
            subtitle="Separate sub-brackets for the remaining 12 placements, grouped by 1st-round result."
            icon={<Medal size={14} className="text-white/60" />}
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ConsolationSubBracket
                label="5th — 8th"
                description="Won R1, lost R2"
                r3={se.r3}
                final={se.final}
                third={se.third}
                entryById={entryById}
                accent="amber"
              />
              <ConsolationSubBracket
                label="9th — 12th"
                description="Lost R1, won R2"
                r3={nw.r3}
                final={nw.final}
                third={nw.third}
                entryById={entryById}
                accent="blue"
              />
              <ConsolationSubBracket
                label="13th — 16th"
                description="0W-2L after R2"
                r3={sw.r3}
                final={sw.final}
                third={sw.third}
                entryById={entryById}
                accent="gray"
              />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

// ============================================
// Sub-bracket visual (proper tree layout)
// ============================================

function SubBracketVisual({
  r3,
  final,
  third,
  entryById,
  accent,
}: {
  r3: BracketMatch[];
  final?: BracketMatch;
  third?: BracketMatch;
  entryById: Map<string, BracketEntry>;
  accent: 'championship' | 'amber' | 'blue' | 'gray';
}) {
  const accentLabel =
    accent === 'championship'
      ? 'text-amber-400'
      : accent === 'amber'
      ? 'text-amber-300/80'
      : accent === 'blue'
      ? 'text-blue-300/80'
      : 'text-white/40';

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1.2fr,auto,1fr] gap-4 md:gap-6 items-center">
      {/* R3 Semis */}
      <div className="space-y-4">
        <div className={`text-[10px] uppercase tracking-wider ${accentLabel}`}>Semifinals</div>
        <div className="space-y-6">
          {r3.map(m => (
            <MatchCard key={m.id} match={m} entryById={entryById} accent={accent} />
          ))}
        </div>
      </div>

      {/* Connector */}
      <div className="hidden md:flex flex-col items-center justify-center gap-20 text-white/20">
        <div className="text-xs">→</div>
        <div className="text-xs">→</div>
      </div>

      {/* R4 Final + 3rd */}
      <div className="space-y-6">
        {final && (
          <div>
            <div className={`text-[10px] uppercase tracking-wider ${accentLabel} flex items-center gap-1`}>
              {accent === 'championship' && <Crown size={10} />}
              Final — 1st Place
            </div>
            <MatchCard match={final} entryById={entryById} accent={accent} large />
          </div>
        )}
        {third && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">3rd-Place Match</div>
            <MatchCard match={third} entryById={entryById} accent="gray" />
          </div>
        )}
      </div>
    </div>
  );
}

function ConsolationSubBracket({
  label,
  description,
  r3,
  final,
  third,
  entryById,
  accent,
}: {
  label: string;
  description: string;
  r3: BracketMatch[];
  final?: BracketMatch;
  third?: BracketMatch;
  entryById: Map<string, BracketEntry>;
  accent: 'amber' | 'blue' | 'gray';
}) {
  const accentBg =
    accent === 'amber'
      ? 'from-amber-500/5 border-amber-500/20'
      : accent === 'blue'
      ? 'from-blue-500/5 border-blue-500/20'
      : 'from-gray-500/5 border-white/10';

  return (
    <div className={`bg-gradient-to-b ${accentBg} border rounded-xl p-4`}>
      <div className="mb-4">
        <div className="font-semibold text-sm">{label}</div>
        <div className="text-[10px] text-white/40">{description}</div>
      </div>
      <div className="space-y-5">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Semifinals</div>
          <div className="space-y-2">
            {r3.map(m => <MatchCard key={m.id} match={m} entryById={entryById} accent={accent} compact />)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Finals</div>
          <div className="space-y-2">
            {final && <MatchCard match={final} entryById={entryById} accent={accent} compact />}
            {third && <MatchCard match={third} entryById={entryById} accent="gray" compact />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Round robin view
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

  const stats = new Map<string, { wins: number; losses: number }>();
  for (const e of entries) stats.set(e.id, { wins: 0, losses: 0 });
  for (const m of matches) {
    if (m.winner_entry_id && m.entry_a_id && m.entry_b_id) {
      const ws = stats.get(m.winner_entry_id); if (ws) ws.wins++;
      const lid = m.winner_entry_id === m.entry_a_id ? m.entry_b_id : m.entry_a_id;
      const ls = stats.get(lid); if (ls) ls.losses++;
    }
  }
  const standings = entries.slice().sort((a, b) => {
    const sa = stats.get(a.id) || { wins: 0, losses: 0 };
    const sb = stats.get(b.id) || { wins: 0, losses: 0 };
    if (sb.wins !== sa.wins) return sb.wins - sa.wins;
    return sa.losses - sb.losses;
  });

  return (
    <div>
      <FlightHeader
        flight={flight}
        entries={entries}
        matches={matches}
        label={`${entries.length}-player round robin · ${flight.num_rounds} rounds`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,0.7fr] gap-6">
        <Section title="Matches" subtitle="">
          <div className="space-y-5">
            {rounds.map(round => {
              const roundMatches = matches.filter(m => m.round === round).sort((a, b) => a.match_index - b.match_index);
              return (
                <div key={round}>
                  <SectionLabel color="text-white/50" align="left">Round {round}</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {roundMatches.map(m => <MatchCard key={m.id} match={m} entryById={entryById} accent="neutral" />)}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Standings" subtitle="Live — sorted by wins then losses.">
          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            {standings.map((e, idx) => {
              const s = stats.get(e.id) || { wins: 0, losses: 0 };
              return (
                <div key={e.id} className={`flex items-center gap-3 p-3 ${idx > 0 ? 'border-t border-white/5' : ''} ${idx === 0 ? 'bg-[#D3FB52]/5' : ''}`}>
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-mono font-semibold ${
                    idx === 0 ? 'bg-[#D3FB52]/20 text-[#D3FB52]' : 'bg-white/5 text-white/50'
                  }`}>
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-sm truncate">{entryLabel(e)}</span>
                  <span className="text-xs font-mono text-white/60">{s.wins}-{s.losses}</span>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}

// ============================================
// Single elimination view
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
    <div>
      <FlightHeader
        flight={flight}
        entries={[]}
        matches={matches}
        label={`${flight.size}-player single elimination · ${flight.num_rounds} rounds`}
      />

      <div className="overflow-x-auto pb-4">
        <div
          className="grid gap-8 min-w-max items-center"
          style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(240px, 1fr))` }}
        >
          {rounds.map(round => {
            const roundMatches = matches.filter(m => m.round === round).sort((a, b) => a.match_index - b.match_index);
            const isFinal = round === rounds[rounds.length - 1];
            const isSemi = round === rounds[rounds.length - 2];
            const label = isFinal ? 'Final' : isSemi ? 'Semifinals' : `Round ${round}`;
            const accent: 'championship' | 'east' = isFinal ? 'championship' : 'east';
            // Vertical spacing grows each round to create visual tree
            const gapClass = round === 1 ? 'space-y-3' : round === 2 ? 'space-y-10' : round === 3 ? 'space-y-24' : 'space-y-48';
            return (
              <div key={round}>
                <div className="text-[10px] uppercase tracking-wider text-white/50 mb-3 text-center">
                  {isFinal && <Crown size={12} className="inline mr-1 text-amber-400" />}
                  {label}
                </div>
                <div className={gapClass}>
                  {roundMatches.map(m => <MatchCard key={m.id} match={m} entryById={entryById} accent={accent} />)}
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
// Shared pieces — match card, section, etc.
// ============================================

type MatchAccent = 'championship' | 'east' | 'west' | 'amber' | 'blue' | 'gray' | 'neutral';

function MatchCard({
  match,
  entryById,
  accent = 'neutral',
  compact,
  large,
}: {
  match: BracketMatch;
  entryById: Map<string, BracketEntry>;
  accent?: MatchAccent;
  compact?: boolean;
  large?: boolean;
}) {
  const a = match.entry_a_id ? entryById.get(match.entry_a_id) : null;
  const b = match.entry_b_id ? entryById.get(match.entry_b_id) : null;
  const aWon = match.winner_entry_id === match.entry_a_id;
  const bWon = match.winner_entry_id === match.entry_b_id;
  const isConfirmed = match.status === 'confirmed';
  const isReported = match.status === 'reported';
  const isDisputed = match.status === 'disputed';
  const isPending = match.status === 'pending';

  // Color ramps per accent
  const borderColor = {
    championship: 'border-amber-400/40 shadow-amber-500/10 shadow-lg',
    east: 'border-emerald-500/30',
    west: 'border-blue-500/30',
    amber: 'border-amber-500/20',
    blue: 'border-blue-500/20',
    gray: 'border-white/10',
    neutral: 'border-white/10',
  }[accent];

  const accentGlow = aWon || bWon
    ? accent === 'championship'
      ? 'ring-1 ring-amber-400/40'
      : 'ring-1 ring-[#D3FB52]/30'
    : '';

  return (
    <div className={`bg-white/[0.03] backdrop-blur border ${borderColor} ${accentGlow} rounded-xl overflow-hidden ${compact ? 'text-xs' : 'text-sm'}`}>
      {/* Position label strip */}
      {match.bracket_position && !compact && (
        <div className="px-3 py-1 bg-white/[0.02] text-[10px] uppercase tracking-wider text-white/40 font-mono border-b border-white/5">
          {match.bracket_position}
        </div>
      )}
      {/* Player rows */}
      <div>
        <PlayerRow entry={a} won={aWon} large={large} compact={compact} />
        <div className="border-t border-white/5" />
        <PlayerRow entry={b} won={bWon} large={large} compact={compact} />
      </div>
      {/* Status footer */}
      <div className="px-3 py-1.5 bg-white/[0.02] border-t border-white/5 flex items-center justify-between text-[10px]">
        {isConfirmed && match.score && (
          <div className="flex items-center gap-1 text-[#D3FB52] font-mono">
            <CheckCircle2 size={10} />
            {match.score}
          </div>
        )}
        {isReported && match.score && (
          <div className="flex items-center gap-1 text-yellow-400 font-mono">
            <Clock size={10} />
            {match.score} (pending)
          </div>
        )}
        {isDisputed && <div className="text-red-400">Disputed</div>}
        {isPending && !match.score && (
          <div className="text-white/40">
            {match.deadline ? `Due ${match.deadline}` : 'Scheduled'}
          </div>
        )}
        {!isPending && !isConfirmed && !isReported && !isDisputed && (
          <div className="text-white/40">{match.status}</div>
        )}
      </div>
    </div>
  );
}

function PlayerRow({
  entry,
  won,
  large,
  compact,
}: {
  entry: BracketEntry | null | undefined;
  won: boolean;
  large?: boolean;
  compact?: boolean;
}) {
  const pad = large ? 'px-4 py-3' : compact ? 'px-2.5 py-1.5' : 'px-3 py-2';
  const textSize = large ? 'text-base' : compact ? 'text-xs' : 'text-sm';

  if (!entry) {
    return (
      <div className={`${pad} flex items-center gap-2 text-white/25 italic ${textSize}`}>
        <span className="w-5 h-5 rounded bg-white/5 flex items-center justify-center text-[10px] text-white/20">
          —
        </span>
        TBD
      </div>
    );
  }

  return (
    <div className={`${pad} flex items-center gap-2 ${won ? 'font-semibold text-white' : 'text-white/70'}`}>
      <span className={`w-5 h-5 rounded bg-white/5 flex items-center justify-center text-[10px] font-mono ${won ? 'text-[#D3FB52]' : 'text-white/40'}`}>
        {entry.seed_in_flight ?? '?'}
      </span>
      <span className={`truncate flex-1 ${textSize}`}>
        {entryLabel(entry, compact)}
      </span>
      {won && <CheckCircle2 size={12} className="text-[#D3FB52] flex-shrink-0" />}
    </div>
  );
}

function Section({
  title,
  subtitle,
  icon,
  accent,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accent?: 'gold';
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10 last:mb-0">
      <div className={`flex items-center gap-2 mb-1 ${accent === 'gold' ? 'text-amber-300' : 'text-white/80'}`}>
        {icon}
        <h3 className="font-semibold text-base">{title}</h3>
      </div>
      {subtitle && <p className="text-xs text-white/40 mb-4">{subtitle}</p>}
      {children}
    </section>
  );
}

function SectionLabel({
  children,
  color,
  align,
}: {
  children: React.ReactNode;
  color: string;
  align: 'left' | 'center' | 'right';
}) {
  return (
    <div className={`text-[10px] uppercase tracking-widest font-semibold mb-2 ${color} text-${align}`}>
      {children}
    </div>
  );
}

function entryLabel(e: BracketEntry, compact?: boolean): string {
  if (!e.partner_name) {
    return compact ? lastName(e.captain_name) : e.captain_name;
  }
  if (compact) {
    return `${lastName(e.captain_name)}/${lastName(e.partner_name)}`;
  }
  return `${e.captain_name} & ${e.partner_name}`;
}

function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1] || full;
}
