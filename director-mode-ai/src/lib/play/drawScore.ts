/**
 * Turning what a player typed into the score a draw stores. Server-side (and tests):
 * it uses MixerMode's canonicalScore, which lives next to the DB scoring code, so the
 * browser bundle keeps importing only ./draw.
 *
 * Scores are typed WINNER-FIRST ("we won 6-4 3-6 10-7"), the same as the tournament desk.
 * Stored player1-first, so every standings / grid reader reads them the same way.
 */
import { canonicalScore } from '@/lib/tournamentScoring';
import { DrawError, applyResult, fillCourts, parseSets, setsText, winnerOfScore, type Draw, type DrawHow } from './draw';

export function drawScoreText(raw: string | null | undefined, winner: 'a' | 'b', how: DrawHow | null = null): string {
  if (winner !== 'a' && winner !== 'b') throw new DrawError('Pick who won.');
  if (how === 'W/O' || how === 'DEF') return how;
  if (how === 'RET') {
    if (!raw || !String(raw).trim()) return 'RET';
    // A retirement can stop mid-set (2-2) and the winner may be behind, so no orientation guessing:
    // winner-first as typed, flipped when side B won.
    const sets = parseSets(String(raw), { allowTiedLast: true });
    const p1 = winner === 'a' ? sets : sets.map(([x, y]) => [y, x] as [number, number]);
    return `${setsText(p1)}, RET`;
  }
  const sets = parseSets(String(raw ?? ''));
  const p1 = canonicalScore(setsText(sets), winner);
  if (winnerOfScore(p1) !== winner) throw new DrawError('That score says the other side won. Type the winner’s games first, like 6-4 3-6 10-7.');
  return p1;
}

/** Score a match and refill the courts: what the 'draw_score' / 'draw_walkover' actions do. */
export function scoreDraw(d: Draw, key: string, winner: 'a' | 'b', raw: string | null | undefined, how: DrawHow | null, now: string): Draw {
  return fillCourts(applyResult(d, key, winner, drawScoreText(raw, winner, how), { how, now }), now);
}

/** A fix after the event ended: the result changes, nothing goes on a court. */
export function scoreOnly(d: Draw, key: string, winner: 'a' | 'b', raw: string | null | undefined, how: DrawHow | null, now: string): Draw {
  return applyResult(d, key, winner, drawScoreText(raw, winner, how), { how, now });
}

/** The host's doubles pairs as sent by the page: two different players each, nobody twice, all on this event. */
export function cleanPairs(v: unknown, known: Set<string>): string[][] {
  const raw = Array.isArray(v) ? v : [];
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const p of raw.slice(0, 48)) {
    if (!Array.isArray(p) || p.length !== 2) throw new DrawError('Each pair needs exactly two players.');
    const [a, b] = p.map((x) => (typeof x === 'string' ? x.trim().slice(0, 60) : ''));
    if (!a || !b || a === b) throw new DrawError('Each pair needs two different players.');
    if (!known.has(a) || !known.has(b)) throw new DrawError('That player isn’t on this one.');
    if (seen.has(a) || seen.has(b)) throw new DrawError('A player can only be in one pair.');
    seen.add(a); seen.add(b);
    out.push([a, b]);
  }
  return out;
}
