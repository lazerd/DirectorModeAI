/**
 * JTT (Junior Team Tennis) team-format league helpers.
 *
 * The individual-format leagues (compass / round_robin / single_elim) live
 * in leagueUtils.ts. This file owns the team-format concepts: clubs,
 * divisions, matchups, lines, standings.
 */

export type JTTLineType = 'singles' | 'doubles';

export type JTTLineFormat =
  | 'singles_and_doubles'
  | 'singles_only'
  | 'doubles_only'
  | 'custom';

export const DAY_OF_WEEK_LABELS: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

export type DraftDivision = {
  name: string;
  short_code: string;
  day_of_week: number;
  start_time: string;   // "HH:MM"
  end_time: string;     // "HH:MM"
  line_format: JTTLineFormat;
};

export type DraftClub = {
  name: string;
  short_code: string;
  color?: string;
};

export type DraftMatchup = {
  division_short: string;
  match_date: string;       // ISO YYYY-MM-DD
  home_short: string;
  away_short: string;
  start_time?: string;      // optional override
};

/**
 * Generate the line skeleton for a matchup based on the division's line_format.
 * line_number is 1-indexed and contiguous. Used by the seed endpoint to create
 * a default shape; real matchups should be regenerated from attendance via
 * optimizeLines() once check-in is done.
 */
export function linesForFormat(format: JTTLineFormat): Array<{
  line_type: JTTLineType;
  line_number: number;
}> {
  switch (format) {
    case 'singles_and_doubles':
      return [
        { line_type: 'singles', line_number: 1 },
        { line_type: 'doubles', line_number: 2 },
      ];
    case 'singles_only':
      return [{ line_type: 'singles', line_number: 1 }];
    case 'doubles_only':
      return [{ line_type: 'doubles', line_number: 1 }];
    case 'custom':
      return [];
  }
}

/**
 * Given the number of courts at the host club and the attending player count
 * on each side, compute the optimal mix of singles + doubles lines.
 *
 * Goal: get as many players as possible on court, preferring singles when
 * attendance allows (so every kid gets their own court). Singles becomes
 * doubles only when needed to fit everyone.
 *
 * Algorithm (per side, using the smaller side as the binding count):
 *   usable = min(home_attending, away_attending)
 *   - usable ≤ courts           → all singles (S=usable, D=0)
 *   - courts < usable ≤ 2*courts → mix: D = usable - courts, S = 2*courts - usable
 *   - usable > 2*courts         → all doubles (D=courts, S=0); surplus sits
 *
 * When sides have unequal attendance (home=6, away=3 with 4 courts), the
 * smaller side caps participation. The larger side uses only N = usable
 * players; the rest bench.
 *
 * Returns counts + who's benched on each side.
 */
export function optimizeLines(
  courts: number,
  homeAttending: number,
  awayAttending: number
): {
  singles: number;
  doubles: number;
  usable: number;
  benchedHome: number;
  benchedAway: number;
  warning: string | null;
} {
  const c = Math.max(0, Math.floor(courts));
  const ph = Math.max(0, Math.floor(homeAttending));
  const pa = Math.max(0, Math.floor(awayAttending));
  const usable = Math.min(ph, pa);

  if (c === 0 || usable === 0) {
    return {
      singles: 0,
      doubles: 0,
      usable,
      benchedHome: ph,
      benchedAway: pa,
      warning:
        c === 0
          ? 'No courts available for this matchup.'
          : usable === 0 && (ph === 0 || pa === 0)
          ? `${ph === 0 ? 'Home' : 'Away'} has no players checked in.`
          : null,
    };
  }

  let singles: number, doubles: number;
  if (usable <= c) {
    singles = usable;
    doubles = 0;
  } else if (usable <= 2 * c) {
    doubles = usable - c;
    singles = 2 * c - usable;
  } else {
    singles = 0;
    doubles = c;
  }

  const playing = singles + 2 * doubles;
  const benchedHome = ph - playing;
  const benchedAway = pa - playing;

  const warnings: string[] = [];
  if (ph !== pa) {
    const surplus = Math.abs(ph - pa);
    warnings.push(
      `Uneven attendance — ${ph > pa ? 'home' : 'away'} has ${surplus} extra player${surplus === 1 ? '' : 's'} who won't play.`
    );
  }
  if (benchedHome > 0 && ph === pa) {
    warnings.push(
      `${benchedHome} player${benchedHome === 1 ? '' : 's'} per side sitting out (courts are the bottleneck).`
    );
  }

  return {
    singles,
    doubles,
    usable,
    benchedHome: Math.max(0, benchedHome),
    benchedAway: Math.max(0, benchedAway),
    warning: warnings.length > 0 ? warnings.join(' ') : null,
  };
}

/**
 * Build the line skeleton (line_type + line_number) for N singles + M doubles,
 * with singles first, then doubles. 1-indexed, contiguous.
 */
export function buildLineSkeleton(
  singles: number,
  doubles: number
): Array<{ line_type: JTTLineType; line_number: number }> {
  const lines: Array<{ line_type: JTTLineType; line_number: number }> = [];
  let n = 1;
  for (let i = 0; i < singles; i++) lines.push({ line_type: 'singles', line_number: n++ });
  for (let i = 0; i < doubles; i++) lines.push({ line_type: 'doubles', line_number: n++ });
  return lines;
}

/**
 * Lamorinda JTT Summer 2026 seed data — last year's schedule with dates
 * updated to 2026 Tuesdays/Thursdays, skipping the July 4 week.
 */
export const LAMORINDA_2026 = {
  leagueName: 'Lamorinda JTT Summer 2026',
  leagueSlug: 'lamorinda-jtt-summer-2026',
  start_date: '2026-06-09',
  end_date: '2026-07-21',
  clubs: [
    { name: 'OCC', short_code: 'OCC' },
    { name: 'MCC', short_code: 'MCC' },
    { name: 'Rancho Colorados', short_code: 'RAN' },
    { name: 'Sleepy Hollow', short_code: 'SH' },
    { name: 'Meadow', short_code: 'MDW' },
  ] as DraftClub[],
  divisions: [
    {
      name: '10 & Under',
      short_code: '10U',
      day_of_week: 2, // Tuesday
      start_time: '13:00',
      end_time: '14:00',
      line_format: 'singles_and_doubles',
    },
    {
      name: '12 & Under',
      short_code: '12U',
      day_of_week: 2,
      start_time: '14:00',
      end_time: '15:00',
      line_format: 'singles_and_doubles',
    },
    {
      name: '13 & Over',
      short_code: '13O',
      day_of_week: 2,
      start_time: '15:00',
      end_time: '16:00',
      line_format: 'singles_and_doubles',
    },
    {
      name: 'Open',
      short_code: 'OPEN',
      day_of_week: 4, // Thursday
      start_time: '13:00',
      end_time: '14:30',
      line_format: 'singles_and_doubles',
    },
  ] as DraftDivision[],
  // Which clubs play in which division. Meadow is 10U-only.
  divisionClubs: {
    '10U': ['OCC', 'MCC', 'RAN', 'SH', 'MDW'],
    '12U': ['OCC', 'MCC', 'RAN', 'SH'],
    '13O': ['OCC', 'MCC', 'RAN', 'SH'],
    OPEN: ['OCC', 'MCC', 'RAN', 'SH'],
  } as Record<string, string[]>,
  matchups: [
    // Tuesday 10U, 12U, 13O — notation "AWAY @ HOME"
    // Jun 9
    { division_short: '10U', match_date: '2026-06-09', away_short: 'OCC', home_short: 'MCC' },
    { division_short: '10U', match_date: '2026-06-09', away_short: 'RAN', home_short: 'SH' },
    // Meadow bye

    { division_short: '12U', match_date: '2026-06-09', away_short: 'OCC', home_short: 'MCC' },
    { division_short: '12U', match_date: '2026-06-09', away_short: 'RAN', home_short: 'SH' },

    { division_short: '13O', match_date: '2026-06-09', away_short: 'OCC', home_short: 'MCC' },
    { division_short: '13O', match_date: '2026-06-09', away_short: 'RAN', home_short: 'SH' },

    // Jun 16
    { division_short: '10U', match_date: '2026-06-16', away_short: 'SH', home_short: 'MCC' },
    { division_short: '10U', match_date: '2026-06-16', away_short: 'MDW', home_short: 'OCC' },
    // Rancho bye (10U)

    { division_short: '12U', match_date: '2026-06-16', away_short: 'SH', home_short: 'MCC' },
    { division_short: '12U', match_date: '2026-06-16', away_short: 'RAN', home_short: 'OCC' },

    { division_short: '13O', match_date: '2026-06-16', away_short: 'SH', home_short: 'MCC' },
    { division_short: '13O', match_date: '2026-06-16', away_short: 'RAN', home_short: 'OCC' },

    // Jun 23
    { division_short: '10U', match_date: '2026-06-23', away_short: 'MDW', home_short: 'SH' },
    { division_short: '10U', match_date: '2026-06-23', away_short: 'MCC', home_short: 'RAN' },
    // OCC bye (10U)

    { division_short: '12U', match_date: '2026-06-23', away_short: 'OCC', home_short: 'SH' },
    { division_short: '12U', match_date: '2026-06-23', away_short: 'MCC', home_short: 'RAN' },

    { division_short: '13O', match_date: '2026-06-23', away_short: 'OCC', home_short: 'SH' },
    { division_short: '13O', match_date: '2026-06-23', away_short: 'MCC', home_short: 'RAN' },

    // (Jun 30 / Jul 2 skipped for July 4)

    // Jul 7
    { division_short: '10U', match_date: '2026-07-07', away_short: 'SH', home_short: 'RAN' },
    { division_short: '10U', match_date: '2026-07-07', away_short: 'MDW', home_short: 'OCC' },
    // MCC bye (10U)

    { division_short: '12U', match_date: '2026-07-07', away_short: 'SH', home_short: 'RAN' },
    { division_short: '12U', match_date: '2026-07-07', away_short: 'MCC', home_short: 'OCC' },

    { division_short: '13O', match_date: '2026-07-07', away_short: 'SH', home_short: 'RAN' },
    { division_short: '13O', match_date: '2026-07-07', away_short: 'MCC', home_short: 'OCC' },

    // Jul 14
    { division_short: '10U', match_date: '2026-07-14', away_short: 'OCC', home_short: 'RAN' },
    { division_short: '10U', match_date: '2026-07-14', away_short: 'MDW', home_short: 'MCC' },
    // SH bye (10U)

    { division_short: '12U', match_date: '2026-07-14', away_short: 'OCC', home_short: 'RAN' },
    { division_short: '12U', match_date: '2026-07-14', away_short: 'SH', home_short: 'MCC' },

    { division_short: '13O', match_date: '2026-07-14', away_short: 'OCC', home_short: 'RAN' },
    { division_short: '13O', match_date: '2026-07-14', away_short: 'SH', home_short: 'MCC' },

    // Thursday Open
    { division_short: 'OPEN', match_date: '2026-06-11', away_short: 'OCC', home_short: 'MCC' },
    { division_short: 'OPEN', match_date: '2026-06-11', away_short: 'RAN', home_short: 'SH' },

    { division_short: 'OPEN', match_date: '2026-06-18', away_short: 'SH', home_short: 'MCC' },
    { division_short: 'OPEN', match_date: '2026-06-18', away_short: 'RAN', home_short: 'OCC' },

    { division_short: 'OPEN', match_date: '2026-06-25', away_short: 'OCC', home_short: 'SH' },
    { division_short: 'OPEN', match_date: '2026-06-25', away_short: 'MCC', home_short: 'RAN' },

    { division_short: 'OPEN', match_date: '2026-07-09', away_short: 'SH', home_short: 'RAN' },
    { division_short: 'OPEN', match_date: '2026-07-09', away_short: 'MCC', home_short: 'OCC' },

    { division_short: 'OPEN', match_date: '2026-07-16', away_short: 'OCC', home_short: 'RAN' },
    { division_short: 'OPEN', match_date: '2026-07-16', away_short: 'SH', home_short: 'MCC' },
  ] as DraftMatchup[],
} as const;

export type ClubStanding = {
  club_id: string;
  club_name: string;
  club_short: string;
  matchups_played: number;
  matchups_won: number;
  matchups_lost: number;
  matchups_tied: number;
  lines_won: number;
  lines_lost: number;
  points: number;             // 2 for win, 1 for tie, 0 for loss (standard JTT)
};

/**
 * Compute standings for a division from completed matchups + their lines.
 * JTT points: 2 = win, 1 = tie, 0 = loss.
 * Sort by points desc, then line differential, then lines_won.
 */
export function computeDivisionStandings(
  clubs: Array<{ id: string; name: string; short_code: string }>,
  matchups: Array<{
    home_club_id: string;
    away_club_id: string;
    home_lines_won: number;
    away_lines_won: number;
    winner: 'home' | 'away' | 'tie' | null;
    status: string;
  }>
): ClubStanding[] {
  const byClub = new Map<string, ClubStanding>();
  for (const c of clubs) {
    byClub.set(c.id, {
      club_id: c.id,
      club_name: c.name,
      club_short: c.short_code,
      matchups_played: 0,
      matchups_won: 0,
      matchups_lost: 0,
      matchups_tied: 0,
      lines_won: 0,
      lines_lost: 0,
      points: 0,
    });
  }

  for (const m of matchups) {
    if (m.status !== 'completed') continue;
    const home = byClub.get(m.home_club_id);
    const away = byClub.get(m.away_club_id);
    if (!home || !away) continue;

    home.matchups_played += 1;
    away.matchups_played += 1;
    home.lines_won += m.home_lines_won;
    home.lines_lost += m.away_lines_won;
    away.lines_won += m.away_lines_won;
    away.lines_lost += m.home_lines_won;

    if (m.winner === 'home') {
      home.matchups_won += 1;
      home.points += 2;
      away.matchups_lost += 1;
    } else if (m.winner === 'away') {
      away.matchups_won += 1;
      away.points += 2;
      home.matchups_lost += 1;
    } else if (m.winner === 'tie') {
      home.matchups_tied += 1;
      away.matchups_tied += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  return Array.from(byClub.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const aDiff = a.lines_won - a.lines_lost;
    const bDiff = b.lines_won - b.lines_lost;
    if (bDiff !== aDiff) return bDiff - aDiff;
    return b.lines_won - a.lines_won;
  });
}

export type PlayerRecord = {
  roster_id: string;
  player_name: string;
  club_short: string;
  singles_wins: number;
  singles_losses: number;
  doubles_wins: number;
  doubles_losses: number;
  total_wins: number;
  total_losses: number;
  winPct: number;
};

/**
 * Compute per-player records within a division from completed lines.
 */
export function computePlayerRecords(
  rosters: Array<{ id: string; player_name: string; club_id: string }>,
  clubsById: Map<string, { short_code: string }>,
  lines: Array<{
    line_type: 'singles' | 'doubles';
    home_player1_id: string | null;
    home_player2_id: string | null;
    away_player1_id: string | null;
    away_player2_id: string | null;
    winner: 'home' | 'away' | null;
    status: string;
  }>
): PlayerRecord[] {
  const byRoster = new Map<string, PlayerRecord>();
  for (const r of rosters) {
    byRoster.set(r.id, {
      roster_id: r.id,
      player_name: r.player_name,
      club_short: clubsById.get(r.club_id)?.short_code || '',
      singles_wins: 0,
      singles_losses: 0,
      doubles_wins: 0,
      doubles_losses: 0,
      total_wins: 0,
      total_losses: 0,
      winPct: 0,
    });
  }

  for (const line of lines) {
    if (line.status !== 'completed' || !line.winner) continue;
    const homeIds = [line.home_player1_id, line.home_player2_id].filter(Boolean) as string[];
    const awayIds = [line.away_player1_id, line.away_player2_id].filter(Boolean) as string[];

    const winners = line.winner === 'home' ? homeIds : awayIds;
    const losers = line.winner === 'home' ? awayIds : homeIds;

    for (const id of winners) {
      const rec = byRoster.get(id);
      if (!rec) continue;
      if (line.line_type === 'singles') rec.singles_wins += 1;
      else rec.doubles_wins += 1;
      rec.total_wins += 1;
    }
    for (const id of losers) {
      const rec = byRoster.get(id);
      if (!rec) continue;
      if (line.line_type === 'singles') rec.singles_losses += 1;
      else rec.doubles_losses += 1;
      rec.total_losses += 1;
    }
  }

  for (const rec of byRoster.values()) {
    const total = rec.total_wins + rec.total_losses;
    rec.winPct = total === 0 ? 0 : rec.total_wins / total;
  }

  return Array.from(byRoster.values()).sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    return b.total_wins - a.total_wins;
  });
}

/**
 * Recompute strength-ladder positions for one club's roster in one division,
 * based on completed line results across the season.
 *
 * Sort rule:
 *   1. (wins - losses) desc       — net results first
 *   2. total wins desc            — volume tiebreaker
 *   3. current ladder_position asc — keep coach's original order for players
 *                                    with identical records (stable enough so
 *                                    clicking "Re-ladder" with no new results
 *                                    doesn't shuffle things)
 *
 * Players with zero completed lines keep their manual slot relative to each
 * other (so pre-season coach ordering is preserved until results exist).
 *
 * Returns a list of { rosterId, newPosition } ready to be UPDATEd.
 */
export function recomputeLadder(
  rosters: Array<{
    id: string;
    ladder_position: number | null;
    status: string;
  }>,
  lines: Array<{
    home_player1_id: string | null;
    home_player2_id: string | null;
    away_player1_id: string | null;
    away_player2_id: string | null;
    winner: 'home' | 'away' | null;
    status: string;
  }>
): Array<{ rosterId: string; newPosition: number }> {
  const record = new Map<string, { wins: number; losses: number }>();
  for (const r of rosters) record.set(r.id, { wins: 0, losses: 0 });

  for (const line of lines) {
    if (line.status !== 'completed' || !line.winner) continue;
    const homeIds = [line.home_player1_id, line.home_player2_id].filter(
      Boolean
    ) as string[];
    const awayIds = [line.away_player1_id, line.away_player2_id].filter(
      Boolean
    ) as string[];
    const winners = line.winner === 'home' ? homeIds : awayIds;
    const losers = line.winner === 'home' ? awayIds : homeIds;
    for (const id of winners) {
      const r = record.get(id);
      if (r) r.wins += 1;
    }
    for (const id of losers) {
      const r = record.get(id);
      if (r) r.losses += 1;
    }
  }

  const sorted = [...rosters].sort((a, b) => {
    const ra = record.get(a.id) || { wins: 0, losses: 0 };
    const rb = record.get(b.id) || { wins: 0, losses: 0 };
    const diffA = ra.wins - ra.losses;
    const diffB = rb.wins - rb.losses;
    if (diffB !== diffA) return diffB - diffA;
    if (rb.wins !== ra.wins) return rb.wins - ra.wins;
    return (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999);
  });

  return sorted.map((r, i) => ({ rosterId: r.id, newPosition: i + 1 }));
}

/**
 * Auto-assign players to the lines of a matchup based on each club's
 * current strength ladder. Returns a map of line.id → patch.
 *
 * Strategy (for the Lamorinda singles+doubles format):
 *   - Skip lines that already have both sides set (respect coach overrides)
 *   - Walk lines in order; for each, pull top-N unassigned players from each side
 *   - "Unassigned" = not already slotted elsewhere in this matchup
 *   - A player assigned to a singles line is NOT reused in a doubles line the
 *     same day (prevents top kid playing everything)
 */
export function autoAssignByStrength(
  lines: Array<{
    id: string;
    line_type: 'singles' | 'doubles';
    line_number: number;
    home_player1_id: string | null;
    home_player2_id: string | null;
    away_player1_id: string | null;
    away_player2_id: string | null;
  }>,
  homeRosters: Array<{ id: string; ladder_position: number | null; status: string }>,
  awayRosters: Array<{ id: string; ladder_position: number | null; status: string }>
): Array<{
  id: string;
  home_player1_id: string | null;
  home_player2_id: string | null;
  away_player1_id: string | null;
  away_player2_id: string | null;
}> {
  const sortedHome = homeRosters
    .filter(r => r.status === 'active')
    .sort((a, b) => (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999));
  const sortedAway = awayRosters
    .filter(r => r.status === 'active')
    .sort((a, b) => (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999));

  const usedHome = new Set<string>();
  const usedAway = new Set<string>();

  // Pre-register anyone already manually assigned in any line
  for (const line of lines) {
    if (line.home_player1_id) usedHome.add(line.home_player1_id);
    if (line.home_player2_id) usedHome.add(line.home_player2_id);
    if (line.away_player1_id) usedAway.add(line.away_player1_id);
    if (line.away_player2_id) usedAway.add(line.away_player2_id);
  }

  const sortedLines = [...lines].sort((a, b) => a.line_number - b.line_number);
  const patches: Array<{
    id: string;
    home_player1_id: string | null;
    home_player2_id: string | null;
    away_player1_id: string | null;
    away_player2_id: string | null;
  }> = [];

  const takeNext = (
    sorted: Array<{ id: string }>,
    used: Set<string>
  ): string | null => {
    for (const r of sorted) {
      if (!used.has(r.id)) {
        used.add(r.id);
        return r.id;
      }
    }
    return null;
  };

  for (const line of sortedLines) {
    const need = line.line_type === 'doubles' ? 2 : 1;
    const patch = {
      id: line.id,
      home_player1_id: line.home_player1_id,
      home_player2_id: line.home_player2_id,
      away_player1_id: line.away_player1_id,
      away_player2_id: line.away_player2_id,
    };
    let changed = false;
    if (!patch.home_player1_id) {
      const pid = takeNext(sortedHome, usedHome);
      if (pid) {
        patch.home_player1_id = pid;
        changed = true;
      }
    }
    if (need === 2 && !patch.home_player2_id) {
      const pid = takeNext(sortedHome, usedHome);
      if (pid) {
        patch.home_player2_id = pid;
        changed = true;
      }
    }
    if (!patch.away_player1_id) {
      const pid = takeNext(sortedAway, usedAway);
      if (pid) {
        patch.away_player1_id = pid;
        changed = true;
      }
    }
    if (need === 2 && !patch.away_player2_id) {
      const pid = takeNext(sortedAway, usedAway);
      if (pid) {
        patch.away_player2_id = pid;
        changed = true;
      }
    }
    if (changed) patches.push(patch);
  }

  return patches;
}
