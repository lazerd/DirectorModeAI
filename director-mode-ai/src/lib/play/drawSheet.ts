/**
 * A Racquets IRL draw in the shape the tournament desk's draw sheets take
 * (components/tournament/DrawView, BracketDrawSvg, CompassDrawSvg). Pure, so the
 * phone, the TV board and the server-rendered print sheet all use the same one.
 */
import { courtName, drawKind, type Draw } from './draw';

export type SheetEntry = { id: string; player_name: string; partner_name: string | null; seed: number | null };
export type SheetMatch = {
  id: string; bracket: 'main' | 'consolation'; round: number; slot: number;
  player1_id: string | null; player3_id: string | null;
  score: string | null; winner_side: 'a' | 'b' | null; status: string;
  court: string | null; scheduled_at: string | null;
};

/** Main draw + back draw as separate sheets (FMLC / FFIC). A compass is one sheet. */
export const hasBackDraw = (d: Draw) => drawKind(d.format) !== 'compass' && d.matches.some((m) => m.bracket === 'consolation');

/**
 * `bracket` picks one half (main or back draw). Elimination draws are passed as
 * single elimination so a clean tree gets the drawn sheet; feed-in back draws that
 * aren't a clean tree fall back to the desk's column view by themselves.
 */
export function drawSheet(d: Draw, bracket?: 'main' | 'consolation'): { format: string; entries: SheetEntry[]; matches: SheetMatch[] } {
  const k = drawKind(d.format);
  const format = k === 'compass' || k === 'rr' ? d.format : `single-elim-${d.matchType}`;
  return {
    format,
    entries: d.entries.map((e) => ({ id: e.id, player_name: e.name, partner_name: null, seed: e.bye ? null : e.seed })),
    matches: d.matches
      .filter((m) => !bracket || m.bracket === bracket)
      .map((m) => ({
        id: m.key, bracket: m.bracket, round: m.round, slot: m.slot,
        player1_id: m.player1_id, player3_id: m.player3_id,
        score: m.bye ? null : m.score ?? null,
        winner_side: m.status === 'done' ? (m.winner ?? null) : null,
        status: m.status === 'done' ? 'completed' : m.status,
        court: m.status === 'on_court' && m.court ? courtName(d, m.court) : null,
        scheduled_at: null,
      })),
  };
}
