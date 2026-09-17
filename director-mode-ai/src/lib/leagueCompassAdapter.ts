/**
 * leagueCompassAdapter — translates a league compass flight into the shape the
 * tournament draw sheet renders.
 *
 * Two independent compass implementations grew up in this codebase. The
 * tournament side stores flat `(bracket, round, slot)` rows; the league side
 * stores `bracket_position` strings ('R1-M1', 'E-R2-M2', 'NE-FINAL') plus
 * `match_index`. Rather than keep two renderers, this maps the league shape
 * onto the tournament one so both can use `CompassDrawSvg`.
 *
 * Only the 8-player flight is mapped, because that is the only size that
 * actually exists in league data and the only one whose structure lines up.
 * The league's 16-player variant is a genuinely different format — four
 * quadrants each carrying their own semis, final and 3rd-place match — so it
 * is left alone and keeps the older renderer. Returning null is the signal.
 *
 * Note on naming: the league labels the 1st–2nd final 'NE-FINAL'. A true
 * compass puts the championship East, which is what the draw sheet shows. The
 * PLACES are identical either way; only the direction label differs.
 */

export type LeagueEntry = {
  id: string;
  captain_name: string;
  partner_name: string | null;
  seed_in_flight: number | null;
};

export type LeagueMatch = {
  id: string;
  round: number;
  match_index: number;
  bracket_position: string | null;
  entry_a_id: string | null;
  entry_b_id: string | null;
  score: string | null;
  winner_entry_id: string | null;
  status: string;
};

export type SheetEntry = {
  id: string;
  player_name: string;
  partner_name: string | null;
  seed: number | null;
};

export type SheetMatch = {
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

/** bracket_position → where that match lives on the tournament draw sheet. */
const EIGHT: Record<string, { bracket: 'main' | 'consolation'; round: number; slot: number }> = {
  'R1-M1': { bracket: 'main', round: 1, slot: 1 },
  'R1-M2': { bracket: 'main', round: 1, slot: 2 },
  'R1-M3': { bracket: 'main', round: 1, slot: 3 },
  'R1-M4': { bracket: 'main', round: 1, slot: 4 },
  // East: Round 1 winners, playing for 1st–2nd
  'E-R2-M1': { bracket: 'main', round: 2, slot: 1 },
  'E-R2-M2': { bracket: 'main', round: 2, slot: 2 },
  'NE-FINAL': { bracket: 'main', round: 3, slot: 1 },
  // 3rd–4th playoff (North on the sheet)
  'SE-FINAL': { bracket: 'main', round: 4, slot: 1 },
  // West: Round 1 losers, playing for 5th–6th
  'W-R2-M1': { bracket: 'consolation', round: 1, slot: 1 },
  'W-R2-M2': { bracket: 'consolation', round: 1, slot: 2 },
  'NW-FINAL': { bracket: 'consolation', round: 2, slot: 1 },
  // 7th–8th playoff (South on the sheet)
  'SW-FINAL': { bracket: 'consolation', round: 3, slot: 1 },
};

/**
 * league_matches.score is stored WINNER-first; tournament_matches.score is
 * stored relative to side A. The draw sheet reads the tournament convention,
 * so flip league scores when side B won, or every line shows the loser's games
 * against the winner's name.
 */
function toSideARelative(score: string | null, winner: 'a' | 'b' | null): string | null {
  if (!score || winner !== 'b') return score;
  const tail = score.match(/,?\s*(RET|W\/O|WO|DEF)\s*$/i)?.[0] ?? '';
  const body = tail ? score.slice(0, score.length - tail.length) : score;
  const flipped = body
    .split(',')
    .map((set) => {
      const mm = set.trim().match(/^(\d+)-(\d+)$/);
      return mm ? `${mm[2]}-${mm[1]}` : set.trim();
    })
    .join(', ');
  return flipped + tail;
}

export function adaptLeagueCompass(
  flightSize: number,
  entries: LeagueEntry[],
  matches: LeagueMatch[]
): { entries: SheetEntry[]; matches: SheetMatch[] } | null {
  if (flightSize !== 8) return null;

  const mapped: SheetMatch[] = [];
  for (const m of matches) {
    const at = m.bracket_position ? EIGHT[m.bracket_position] : undefined;
    if (!at) return null; // an unexpected position means we don't understand this draw

    let winner_side: 'a' | 'b' | null = null;
    if (m.winner_entry_id) {
      winner_side =
        m.winner_entry_id === m.entry_a_id ? 'a'
        : m.winner_entry_id === m.entry_b_id ? 'b'
        : null;
    }

    mapped.push({
      id: m.id,
      bracket: at.bracket,
      round: at.round,
      slot: at.slot,
      player1_id: m.entry_a_id,
      player3_id: m.entry_b_id,
      score: toSideARelative(m.score, winner_side),
      winner_side,
      status: m.status,
      court: null,
      scheduled_at: null,
    });
  }

  // The sheet needs a full Round 1 to recognise the draw at all.
  if (mapped.filter((m) => m.bracket === 'main' && m.round === 1).length < 4) return null;

  return {
    entries: entries.map((e) => ({
      id: e.id,
      player_name: e.captain_name,
      partner_name: e.partner_name,
      seed: e.seed_in_flight,
    })),
    matches: mapped,
  };
}
