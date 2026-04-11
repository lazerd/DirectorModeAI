/**
 * Compass / single-elim / round-robin bracket visualization.
 *
 * Compass layout is four horizontal bracket rows stacked vertically, each
 * flowing strictly left→right like a printed tournament draw sheet:
 *   1. Compass (1st–4th) — main draw: R1 → R2 East → NE Semis → NE Final
 *   2. Plate   (5th–8th) — right-aligned: SE Semis → SE Final + 3rd
 *   3. Bowl    (9th–12th) — right-aligned: NW Semis → NW Final + 3rd
 *   4. Shield  (13th–16th) — right-aligned: SW Semis → SW Final + 3rd
 * For 8-player compass the main row is R1 → R2E → NE Final and the
 * consolation rows each show a single placement match.
 *
 * The bracket canvas for compass + single-elimination is wrapped in a
 * PanZoomCanvas that supports Google-Maps-style pan (one-finger drag or
 * mouse drag), pinch-to-zoom on touch, ctrl+wheel zoom on desktop, inertial
 * release, and double-tap / double-click reset. Round robin is table-shaped
 * and is left un-wrapped.
 */

'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { Trophy, Crown, Medal, Users, Clock, CheckCircle2, Shield } from 'lucide-react';

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
  /** When true, admin can click matches to enter/edit scores. */
  isAdmin?: boolean;
  /** Called when the admin clicks a match card. Receives the match id. */
  onMatchClick?: (match: BracketMatch) => void;
  /** ID of the match currently highlighted (e.g. the one being edited). */
  highlightedMatchId?: string | null;
};

export default function FlightBracketView({
  flight,
  entries,
  matches,
  leagueType,
  isAdmin,
  onMatchClick,
  highlightedMatchId,
}: Props) {
  const entryById = React.useMemo(() => {
    const m = new Map<string, BracketEntry>();
    for (const e of entries) m.set(e.id, e);
    return m;
  }, [entries]);

  const shared = { isAdmin, onMatchClick, highlightedMatchId };

  const label =
    leagueType === 'compass'
      ? `${flight.size}-player compass draw`
      : leagueType === 'single_elimination'
        ? `${flight.size}-player single elimination · ${flight.num_rounds} rounds`
        : `${entries.length}-player round robin · ${flight.num_rounds} rounds`;

  return (
    <div className="bg-gradient-to-br from-[#001820] via-[#041e2a] to-[#002838] text-white rounded-2xl p-6 sm:p-8 border border-white/10 shadow-xl">
      <FlightHeader flight={flight} entries={entries} matches={matches} label={label} />
      {leagueType === 'round_robin' && (
        <RoundRobinView flight={flight} entries={entries} matches={matches} entryById={entryById} {...shared} />
      )}
      {leagueType === 'single_elimination' && (
        <SingleElimView flight={flight} matches={matches} entryById={entryById} {...shared} />
      )}
      {leagueType === 'compass' && (
        <CompassView flight={flight} entries={entries} matches={matches} entryById={entryById} {...shared} />
      )}
    </div>
  );
}

type SharedProps = {
  isAdmin?: boolean;
  onMatchClick?: (match: BracketMatch) => void;
  highlightedMatchId?: string | null;
};

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
  isAdmin,
  onMatchClick,
  highlightedMatchId,
}: {
  flight: BracketFlight;
  entries: BracketEntry[];
  matches: BracketMatch[];
  entryById: Map<string, BracketEntry>;
} & SharedProps) {
  const sortByIndex = (a: BracketMatch, b: BracketMatch) => a.match_index - b.match_index;
  const posStartsWith = (m: BracketMatch, prefix: string) =>
    (m.bracket_position || '').startsWith(prefix);

  const r1 = matches.filter(m => m.round === 1).sort(sortByIndex);
  const r2East = matches.filter(m => m.round === 2 && posStartsWith(m, 'E')).sort(sortByIndex);
  const r2West = matches.filter(m => m.round === 2 && posStartsWith(m, 'W')).sort(sortByIndex);

  const isEight = flight.size === 8;

  // Per-quadrant matches. For 16-player compass each quadrant has R3 semis
  // and R4 finals (final + 3rd). For 8-player compass each quadrant collapses
  // down to a single R3 final (no semis, no separate 3rd place match).
  const quadrant = (prefix: 'NE' | 'SE' | 'NW' | 'SW') => {
    if (isEight) {
      const final = matches.find(
        m => m.round === 3 && posStartsWith(m, prefix) && (m.bracket_position || '').endsWith('FINAL')
      );
      return { semis: [] as BracketMatch[], final, third: undefined as BracketMatch | undefined };
    }
    const semis = matches.filter(m => m.round === 3 && posStartsWith(m, prefix)).sort(sortByIndex);
    const r4 = matches.filter(m => m.round === 4 && posStartsWith(m, prefix));
    const final = r4.find(m => (m.bracket_position || '').endsWith('-FINAL'));
    const third = r4.find(m => (m.bracket_position || '').endsWith('-3RD'));
    return { semis, final, third };
  };

  const ne = quadrant('NE'); // Compass — 1st–4th (main draw)
  const se = quadrant('SE'); // Plate    — 5th–8th
  const nw = quadrant('NW'); // Bowl     — 9th–12th
  const sw = quadrant('SW'); // Shield   — 13th–16th

  // Column template: 4 wide columns for 16-player (R1 | R2E | SF | Final),
  // 3 wide columns for 8-player (R1 | R2E | Final). Consolations right-align
  // into the rightmost 2 columns (16p) or 1 column (8p).
  const numCols = isEight ? 3 : 4;
  const columnWidth = 230; // px; everything inside pan/zoom so scale handles fit
  const columnGap = 48;    // px between columns — leaves room for tree "arms"
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${numCols}, ${columnWidth}px)`,
    columnGap: `${columnGap}px`,
    alignItems: 'stretch',
  };

  const sharedCol = { entryById, isAdmin, onMatchClick, highlightedMatchId };

  return (
    <div>
      {/* Seed list — stays outside the pan/zoom canvas so the director can
          still read it without having to zoom around. */}
      <details className="mb-6 group">
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

      <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2">
        Pinch / scroll-zoom · Drag to pan · Double-tap to reset
      </div>

      <PanZoomCanvas>
        <div className="p-6 space-y-10" style={{ width: 'max-content' }}>
          {/* ================= COMPASS (1st–4th, main draw) ================= */}
          <BracketRow
            title="Compass"
            subtitle={isEight ? '1st – 4th · Main draw' : '1st – 4th · Main draw — Round 1 through Final'}
            icon={<Crown size={14} className="text-amber-400" />}
            accent="championship"
          >
            <div style={gridStyle}>
              <MatchColumn
                label="Round 1"
                matches={r1}
                accent="neutral"
                {...sharedCol}
              />
              <MatchColumn
                label="Round 2 · East"
                matches={r2East}
                accent="east"
                {...sharedCol}
              />
              {isEight ? (
                <MatchColumn
                  label="Final (1st / 2nd)"
                  matches={ne.final ? [ne.final] : []}
                  accent="championship"
                  large
                  {...sharedCol}
                />
              ) : (
                <>
                  <MatchColumn
                    label="Semifinals"
                    matches={ne.semis}
                    accent="championship"
                    {...sharedCol}
                  />
                  <MatchColumn
                    label="Final · 3rd Place"
                    matches={[ne.final, ne.third].filter(Boolean) as BracketMatch[]}
                    accent="championship"
                    large
                    {...sharedCol}
                  />
                </>
              )}
            </div>
          </BracketRow>

          {/* ================= PLATE (5th–8th) ================= */}
          <BracketRow
            title="Plate"
            subtitle={isEight ? '3rd – 4th' : '5th – 8th · Won R1, lost R2'}
            icon={<Medal size={14} className="text-amber-300" />}
            accent="amber"
          >
            <div style={gridStyle}>
              {isEight ? (
                <MatchColumn
                  label="Placement"
                  matches={se.final ? [se.final] : []}
                  accent="amber"
                  colStart={numCols}
                  {...sharedCol}
                />
              ) : (
                <>
                  <MatchColumn
                    label="Semifinals"
                    matches={se.semis}
                    accent="amber"
                    colStart={numCols - 1}
                    {...sharedCol}
                  />
                  <MatchColumn
                    label="Final · 3rd Place"
                    matches={[se.final, se.third].filter(Boolean) as BracketMatch[]}
                    accent="amber"
                    {...sharedCol}
                  />
                </>
              )}
            </div>
          </BracketRow>

          {/* ================= BOWL (9th–12th) =================
              R2 West is shown as the Bowl row's leftmost column — it's where
              both Bowl (R2W winners) and Shield (R2W losers) get their
              entrants. Column 2 of the grid so it vertically aligns with
              R2 East in the Compass row above. */}
          <BracketRow
            title="Bowl"
            subtitle={isEight ? '5th – 6th · R2 West winners' : '9th – 12th · Lost R1, won R2 West'}
            icon={<Medal size={14} className="text-blue-300" />}
            accent="blue"
          >
            <div style={gridStyle}>
              <MatchColumn
                label="Round 2 · West"
                matches={r2West}
                accent="west"
                colStart={2}
                {...sharedCol}
              />
              {isEight ? (
                <MatchColumn
                  label="Final (5th / 6th)"
                  matches={nw.final ? [nw.final] : []}
                  accent="blue"
                  large
                  {...sharedCol}
                />
              ) : (
                <>
                  <MatchColumn
                    label="Semifinals"
                    matches={nw.semis}
                    accent="blue"
                    {...sharedCol}
                  />
                  <MatchColumn
                    label="Final · 3rd Place"
                    matches={[nw.final, nw.third].filter(Boolean) as BracketMatch[]}
                    accent="blue"
                    {...sharedCol}
                  />
                </>
              )}
            </div>
          </BracketRow>

          {/* ================= SHIELD (13th–16th) ================= */}
          <BracketRow
            title="Shield"
            subtitle={isEight ? '7th – 8th' : '13th – 16th · 0W–2L after R2'}
            icon={<Shield size={14} className="text-white/50" />}
            accent="gray"
          >
            <div style={gridStyle}>
              {isEight ? (
                <MatchColumn
                  label="Placement"
                  matches={sw.final ? [sw.final] : []}
                  accent="gray"
                  colStart={numCols}
                  {...sharedCol}
                />
              ) : (
                <>
                  <MatchColumn
                    label="Semifinals"
                    matches={sw.semis}
                    accent="gray"
                    colStart={numCols - 1}
                    {...sharedCol}
                  />
                  <MatchColumn
                    label="Final · 3rd Place"
                    matches={[sw.final, sw.third].filter(Boolean) as BracketMatch[]}
                    accent="gray"
                    {...sharedCol}
                  />
                </>
              )}
            </div>
          </BracketRow>
        </div>
      </PanZoomCanvas>
    </div>
  );
}

// ============================================
// Compass layout helpers
// ============================================

/**
 * One of the four stacked bracket rows (Compass / Plate / Bowl / Shield).
 * Renders a subtle card with title + subtitle, and the caller provides the
 * inner grid of columns.
 */
function BracketRow({
  title,
  subtitle,
  icon,
  accent,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accent: 'championship' | 'amber' | 'blue' | 'gray';
  children: React.ReactNode;
}) {
  const titleColor = {
    championship: 'text-amber-300',
    amber: 'text-amber-200/90',
    blue: 'text-blue-200/90',
    gray: 'text-white/70',
  }[accent];

  const borderColor = {
    championship: 'border-amber-400/25',
    amber: 'border-amber-400/15',
    blue: 'border-blue-400/15',
    gray: 'border-white/10',
  }[accent];

  const bgGradient = {
    championship: 'from-amber-500/5',
    amber: 'from-amber-500/[0.03]',
    blue: 'from-blue-500/[0.03]',
    gray: 'from-white/[0.02]',
  }[accent];

  return (
    <div className={`bg-gradient-to-b ${bgGradient} to-transparent border ${borderColor} rounded-xl`}>
      <div className="px-5 pt-4 pb-3 border-b border-white/5">
        <div className={`flex items-center gap-2 ${titleColor}`}>
          {icon}
          <h3 className="font-semibold text-base tracking-wide">{title}</h3>
        </div>
        {subtitle && <div className="text-[11px] text-white/40 mt-0.5">{subtitle}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/**
 * A single column of match cards inside a bracket row. Uses flex with
 * `justify-around` so as the grid cell stretches to the tallest column in the
 * row, smaller columns (e.g. 2 semifinals vs. 8 R1 matches) automatically
 * space their cards out into a tree-like vertical rhythm without any SVG or
 * magic numbers. `colStart` right-aligns consolation columns into the
 * rightmost slots of the grid.
 */
function MatchColumn({
  label,
  matches,
  entryById,
  accent,
  large,
  colStart,
  isAdmin,
  onMatchClick,
  highlightedMatchId,
}: {
  label: string;
  matches: BracketMatch[];
  entryById: Map<string, BracketEntry>;
  accent: MatchAccent;
  large?: boolean;
  /** 1-indexed grid column start — use to right-align consolation columns. */
  colStart?: number;
} & SharedProps) {
  return (
    <div
      className="flex flex-col"
      style={colStart ? { gridColumnStart: colStart } : undefined}
    >
      <div className="text-[10px] uppercase tracking-wider text-white/50 mb-3 text-center font-semibold">
        {label}
      </div>
      <div className="flex-1 flex flex-col justify-around gap-3">
        {matches.map(m => (
          <MatchCard
            key={m.id}
            match={m}
            entryById={entryById}
            accent={accent}
            large={large}
            isAdmin={isAdmin}
            onClick={onMatchClick}
            isHighlighted={m.id === highlightedMatchId}
          />
        ))}
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
  isAdmin,
  onMatchClick,
  highlightedMatchId,
}: {
  flight: BracketFlight;
  entries: BracketEntry[];
  matches: BracketMatch[];
  entryById: Map<string, BracketEntry>;
} & SharedProps) {
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
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,0.7fr] gap-6">
        <Section title="Matches" subtitle="">
          <div className="space-y-5">
            {rounds.map(round => {
              const roundMatches = matches.filter(m => m.round === round).sort((a, b) => a.match_index - b.match_index);
              return (
                <div key={round}>
                  <SectionLabel color="text-white/50" align="left">Round {round}</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {roundMatches.map(m => (
                      <MatchCard
                        key={m.id}
                        match={m}
                        entryById={entryById}
                        accent="neutral"
                        isAdmin={isAdmin}
                        onClick={onMatchClick}
                        isHighlighted={m.id === highlightedMatchId}
                      />
                    ))}
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
  isAdmin,
  onMatchClick,
  highlightedMatchId,
}: {
  flight: BracketFlight;
  matches: BracketMatch[];
  entryById: Map<string, BracketEntry>;
} & SharedProps) {
  const rounds = Array.from(new Set(matches.map(m => m.round))).sort((a, b) => a - b);

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2">
        Pinch / scroll-zoom · Drag to pan · Double-tap to reset
      </div>
      <PanZoomCanvas>
        <div className="p-6" style={{ width: 'max-content' }}>
          <div
            className="grid gap-x-12 items-center"
            style={{ gridTemplateColumns: `repeat(${rounds.length}, 230px)` }}
          >
            {rounds.map(round => {
              const roundMatches = matches.filter(m => m.round === round).sort((a, b) => a.match_index - b.match_index);
              const isFinal = round === rounds[rounds.length - 1];
              const isSemi = round === rounds[rounds.length - 2];
              const label = isFinal ? 'Final' : isSemi ? 'Semifinals' : `Round ${round}`;
              const accent: 'championship' | 'east' = isFinal ? 'championship' : 'east';
              // Vertical spacing grows each round to create the visual tree.
              const gapClass =
                round === 1 ? 'space-y-3' : round === 2 ? 'space-y-10' : round === 3 ? 'space-y-24' : 'space-y-48';
              return (
                <div key={round}>
                  <div className="text-[10px] uppercase tracking-wider text-white/50 mb-3 text-center">
                    {isFinal && <Crown size={12} className="inline mr-1 text-amber-400" />}
                    {label}
                  </div>
                  <div className={gapClass}>
                    {roundMatches.map(m => (
                      <MatchCard
                        key={m.id}
                        match={m}
                        entryById={entryById}
                        accent={accent}
                        isAdmin={isAdmin}
                        onClick={onMatchClick}
                        isHighlighted={m.id === highlightedMatchId}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </PanZoomCanvas>
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
  isAdmin,
  onClick,
  isHighlighted,
}: {
  match: BracketMatch;
  entryById: Map<string, BracketEntry>;
  accent?: MatchAccent;
  compact?: boolean;
  large?: boolean;
  isAdmin?: boolean;
  onClick?: (match: BracketMatch) => void;
  isHighlighted?: boolean;
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

  const accentGlow = isHighlighted
    ? 'ring-2 ring-[#D3FB52]'
    : (aWon || bWon)
      ? accent === 'championship'
        ? 'ring-1 ring-amber-400/40'
        : 'ring-1 ring-[#D3FB52]/30'
      : '';

  // Only allow clicks when there's a real pair of players and either admin
  // is authoring a score or the match is pending/reported (not yet locked).
  const clickable = isAdmin && !!onClick && a && b && (isPending || isReported || isConfirmed || isDisputed);
  const interactiveClass = clickable
    ? 'cursor-pointer hover:border-[#D3FB52]/60 hover:bg-white/[0.06] transition-colors'
    : '';

  return (
    <div
      onClick={clickable ? () => onClick!(match) : undefined}
      className={`bg-white/[0.03] backdrop-blur border ${borderColor} ${accentGlow} ${interactiveClass} rounded-xl overflow-hidden ${compact ? 'text-xs' : 'text-sm'}`}>
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

// ============================================
// Pan / zoom canvas
// ============================================

/**
 * Google-Maps-style pan + zoom wrapper for the bracket canvas.
 *
 * Touch:
 *   • 1-finger drag → pan
 *   • 2-finger pinch → zoom around the pinch midpoint
 *   • Double tap → reset to scale=1 / translate=0 (animated)
 *   • Fling inertia decays after release, no elastic bounce
 *
 * Mouse / trackpad:
 *   • Drag → pan
 *   • Ctrl / Cmd + wheel → zoom around the cursor position
 *     (trackpad pinch gestures also emit wheel with ctrlKey=true)
 *   • Double click → reset (animated)
 *
 * Live transforms bypass React state and are applied directly to the content
 * element's `style.transform` so every frame is smooth. React state is only
 * touched on cleanup. Pan is unbounded — no snap-back, no elastic edges —
 * scale is clamped to [minScale, maxScale].
 *
 * Clicks on child elements (e.g. the admin score-entry match cards) are
 * suppressed when the pointer moved more than a small threshold, so a pan
 * gesture doesn't accidentally open a modal.
 */
function PanZoomCanvas({
  children,
  minScale = 0.3,
  maxScale = 3.0,
}: {
  children: React.ReactNode;
  minScale?: number;
  maxScale?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Live transform state lives in a ref so pointer moves can write directly
  // to the DOM at 60fps without triggering React re-renders.
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });

  // Single-finger / mouse pan state.
  const panRef = useRef<null | {
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
    lastX: number;
    lastY: number;
    lastT: number;
    vx: number;
    vy: number;
  }>(null);

  // Two-finger pinch state.
  const pinchRef = useRef<null | {
    startDist: number;
    startScale: number;
    anchorContentX: number;
    anchorContentY: number;
  }>(null);

  // Prevent click-through when a drag actually moved.
  const movedRef = useRef(false);

  // Double-tap detection (touch).
  const lastTapRef = useRef<null | { t: number; x: number; y: number }>(null);

  // Inertia + reset animation loop handle.
  const rafRef = useRef<number | null>(null);

  const applyTransform = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const { scale, tx, ty } = transformRef.current;
    el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  }, []);

  const cancelRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startInertia = useCallback(() => {
    // Decaying velocity loop — multiplies by 0.94 each frame until it stops.
    const step = () => {
      const pan = panRef.current;
      // Pull initial velocity from the last move event captured before release.
      // After pointer-up we keep the velocity on a dedicated ref so we can
      // decay it here.
      const v = inertiaVRef.current;
      if (!v) {
        rafRef.current = null;
        return;
      }
      v.vx *= 0.94;
      v.vy *= 0.94;
      transformRef.current.tx += v.vx;
      transformRef.current.ty += v.vy;
      applyTransform();
      if (Math.abs(v.vx) < 0.05 && Math.abs(v.vy) < 0.05) {
        inertiaVRef.current = null;
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [applyTransform]);

  // Velocity handoff from active drag → inertia loop.
  const inertiaVRef = useRef<null | { vx: number; vy: number }>(null);

  const resetView = useCallback(() => {
    cancelRaf();
    const startScale = transformRef.current.scale;
    const startTx = transformRef.current.tx;
    const startTy = transformRef.current.ty;
    const duration = 260;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      // easeOutCubic
      const k = 1 - Math.pow(1 - t, 3);
      transformRef.current.scale = startScale + (1 - startScale) * k;
      transformRef.current.tx = startTx + (0 - startTx) * k;
      transformRef.current.ty = startTy + (0 - startTy) * k;
      applyTransform();
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [applyTransform, cancelRaf]);

  // Zoom around a given viewport point (container-local coordinates).
  const zoomAt = useCallback(
    (nextScale: number, viewportX: number, viewportY: number) => {
      const clamped = Math.max(minScale, Math.min(maxScale, nextScale));
      const { scale, tx, ty } = transformRef.current;
      // Convert the anchor from viewport → content-local coordinates so we
      // can keep it fixed under the cursor / pinch after rescaling.
      const contentX = (viewportX - tx) / scale;
      const contentY = (viewportY - ty) / scale;
      transformRef.current.scale = clamped;
      transformRef.current.tx = viewportX - contentX * clamped;
      transformRef.current.ty = viewportY - contentY * clamped;
      applyTransform();
    },
    [applyTransform, maxScale, minScale]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getLocal = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    // ------ Touch ------

    const onTouchStart = (e: TouchEvent) => {
      cancelRaf();
      inertiaVRef.current = null;

      if (e.touches.length === 1) {
        const t = e.touches[0];
        movedRef.current = false;
        panRef.current = {
          startX: t.clientX,
          startY: t.clientY,
          startTx: transformRef.current.tx,
          startTy: transformRef.current.ty,
          lastX: t.clientX,
          lastY: t.clientY,
          lastT: performance.now(),
          vx: 0,
          vy: 0,
        };
      } else if (e.touches.length === 2) {
        // Pinch starts: capture the anchor point in content-local coordinates
        // so we can re-anchor on every move.
        const [t1, t2] = [e.touches[0], e.touches[1]];
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        const dist = Math.hypot(dx, dy);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        const local = getLocal(midX, midY);
        const { scale, tx, ty } = transformRef.current;
        pinchRef.current = {
          startDist: dist,
          startScale: scale,
          anchorContentX: (local.x - tx) / scale,
          anchorContentY: (local.y - ty) / scale,
        };
        panRef.current = null;
        movedRef.current = true; // pinching counts as movement
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (pinchRef.current && e.touches.length === 2) {
        e.preventDefault();
        const [t1, t2] = [e.touches[0], e.touches[1]];
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        const dist = Math.hypot(dx, dy);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        const local = getLocal(midX, midY);
        const rawScale = pinchRef.current.startScale * (dist / pinchRef.current.startDist);
        const clamped = Math.max(minScale, Math.min(maxScale, rawScale));
        transformRef.current.scale = clamped;
        transformRef.current.tx = local.x - pinchRef.current.anchorContentX * clamped;
        transformRef.current.ty = local.y - pinchRef.current.anchorContentY * clamped;
        applyTransform();
        return;
      }

      if (panRef.current && e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - panRef.current.lastX;
        const dy = t.clientY - panRef.current.lastY;
        const now = performance.now();
        const dt = Math.max(1, now - panRef.current.lastT);
        transformRef.current.tx += dx;
        transformRef.current.ty += dy;
        // Track velocity in px/frame @ 60fps.
        panRef.current.vx = (dx / dt) * 16;
        panRef.current.vy = (dy / dt) * 16;
        panRef.current.lastX = t.clientX;
        panRef.current.lastY = t.clientY;
        panRef.current.lastT = now;
        if (Math.abs(t.clientX - panRef.current.startX) > 4 || Math.abs(t.clientY - panRef.current.startY) > 4) {
          movedRef.current = true;
        }
        applyTransform();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        // Double-tap detection — only if we did NOT actually drag.
        if (panRef.current && !movedRef.current) {
          const last = lastTapRef.current;
          const now = performance.now();
          const end = e.changedTouches[0];
          if (end) {
            if (last && now - last.t < 320 && Math.hypot(end.clientX - last.x, end.clientY - last.y) < 40) {
              resetView();
              lastTapRef.current = null;
              panRef.current = null;
              pinchRef.current = null;
              return;
            }
            lastTapRef.current = { t: now, x: end.clientX, y: end.clientY };
          }
        }

        // Hand off velocity to the inertia loop.
        if (panRef.current && movedRef.current) {
          const { vx, vy } = panRef.current;
          if (Math.abs(vx) > 0.5 || Math.abs(vy) > 0.5) {
            inertiaVRef.current = { vx, vy };
            startInertia();
          }
        }

        panRef.current = null;
        pinchRef.current = null;
      }
    };

    // ------ Mouse ------

    const onMouseDown = (e: MouseEvent) => {
      // Only primary button.
      if (e.button !== 0) return;
      cancelRaf();
      inertiaVRef.current = null;
      movedRef.current = false;
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTx: transformRef.current.tx,
        startTy: transformRef.current.ty,
        lastX: e.clientX,
        lastY: e.clientY,
        lastT: performance.now(),
        vx: 0,
        vy: 0,
      };
      container.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!panRef.current) return;
      const dx = e.clientX - panRef.current.lastX;
      const dy = e.clientY - panRef.current.lastY;
      const now = performance.now();
      const dt = Math.max(1, now - panRef.current.lastT);
      transformRef.current.tx += dx;
      transformRef.current.ty += dy;
      panRef.current.vx = (dx / dt) * 16;
      panRef.current.vy = (dy / dt) * 16;
      panRef.current.lastX = e.clientX;
      panRef.current.lastY = e.clientY;
      panRef.current.lastT = now;
      if (Math.abs(e.clientX - panRef.current.startX) > 4 || Math.abs(e.clientY - panRef.current.startY) > 4) {
        movedRef.current = true;
      }
      applyTransform();
    };

    const onMouseUp = () => {
      if (panRef.current && movedRef.current) {
        const { vx, vy } = panRef.current;
        if (Math.abs(vx) > 0.5 || Math.abs(vy) > 0.5) {
          inertiaVRef.current = { vx, vy };
          startInertia();
        }
      }
      panRef.current = null;
      container.style.cursor = 'grab';
    };

    const onWheel = (e: WheelEvent) => {
      // Google-Maps desktop convention: ctrl/cmd required for zoom so plain
      // scroll can still scroll the surrounding page. Trackpad pinch gestures
      // on macOS emit wheel with ctrlKey=true automatically.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { x, y } = getLocal(e.clientX, e.clientY);
      // Exponential zoom so each notch feels consistent.
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(transformRef.current.scale * factor, x, y);
    };

    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      resetView();
    };

    // Suppress click-through after a drag.
    const onClickCapture = (e: MouseEvent) => {
      if (movedRef.current) {
        e.stopPropagation();
        e.preventDefault();
        movedRef.current = false;
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('dblclick', onDblClick);
    container.addEventListener('click', onClickCapture, { capture: true });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('dblclick', onDblClick);
      container.removeEventListener('click', onClickCapture, { capture: true } as any);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      cancelRaf();
    };
  }, [applyTransform, cancelRaf, minScale, maxScale, resetView, startInertia, zoomAt]);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl bg-black/20 border border-white/5 select-none"
      style={{
        touchAction: 'none',
        overscrollBehavior: 'contain',
        cursor: 'grab',
        height: 'min(75vh, 820px)',
        minHeight: '520px',
      }}
    >
      <div
        ref={contentRef}
        style={{
          transformOrigin: '0 0',
          willChange: 'transform',
          display: 'inline-block',
        }}
      >
        {children}
      </div>
    </div>
  );
}
