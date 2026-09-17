/**
 * flexCompassAdapter — the /flex hub's compass data, in the shape the shared
 * draw sheet renders.
 *
 * The flex hub is the third place a compass gets drawn (after the tournament
 * print route and the league bracket view), and it holds the loosest data of
 * the three: a `Record<'main:1' | 'consolation:4' | …, MatchT[]>` where each
 * MatchT names its two players as plain strings rather than referencing entry
 * rows. Array order is the slot.
 *
 * So entries are synthesised here — a player's name IS their id, which is safe
 * because within one draw a name identifies a person and nothing downstream
 * needs a real row. Seeds come out null; the flex data doesn't carry them and
 * inventing them would be worse than omitting them.
 */

export type FlexMatch = {
  token: string;
  a: string;
  b: string;
  score: string;
  winner_side: 'a' | 'b' | null;
  status: string;
  label?: string;
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

/** Placeholders the flex data uses for "nobody here yet". */
const isBlank = (n: string | null | undefined) =>
  !n || !n.trim() || n.trim() === '—' || n.trim() === '-' || n.trim().toUpperCase() === 'TBD';

export function adaptFlexCompass(
  stages: Record<string, FlexMatch[]>
): { entries: SheetEntry[]; matches: SheetMatch[] } | null {
  const entries = new Map<string, SheetEntry>();
  const nameId = (n: string): string | null => {
    if (isBlank(n)) return null;
    const id = n.trim();
    if (!entries.has(id)) entries.set(id, { id, player_name: id, partner_name: null, seed: null });
    return id;
  };

  const matches: SheetMatch[] = [];
  for (const [key, list] of Object.entries(stages)) {
    const m = key.match(/^(main|consolation):(\d+)$/);
    if (!m) continue; // an unrecognised stage key means we don't understand this draw
    const bracket = m[1] as 'main' | 'consolation';
    const round = Number(m[2]);
    list.forEach((row, i) => {
      matches.push({
        id: row.token || `${key}:${i}`,
        bracket,
        round,
        slot: i + 1,
        player1_id: nameId(row.a),
        player3_id: nameId(row.b),
        score: row.score || null,
        winner_side: row.winner_side,
        status: row.status,
        court: null,
        scheduled_at: null,
      });
    });
  }

  // The sheet needs a recognisable Round 1 (8 for a 16-draw, 4 for an 8-draw).
  const r1 = matches.filter((x) => x.bracket === 'main' && x.round === 1).length;
  if (r1 < 4) return null;

  return { entries: [...entries.values()], matches };
}
