/**
 * Turning what is physically on a paper scorecard into a result.
 *
 * Captains write a line's score the way tennis scores are written — winner
 * first, "6-1, 6-2" — and circle the winning team. Asking the vision model to
 * reason from that to "did we win, and what is the score from our side" got
 * it wrong on 9/16: Diablo circled, "6-1 6-2" written next to our names, and it
 * reported a win. So the model now only reports what it SEES (which side is
 * circled, the score as written) and this decides the rest.
 */
import { setsFromScore } from './recap';

export type CircledSide = 'ours' | 'theirs' | 'none' | 'unclear';

/** "6-1, 7-6(5), 10-8 RET" → "1-6, 6-7(5), 8-10 RET". Tiebreak points and notes stay put. */
export function flipScore(score: string): string {
  return score.replace(/(\d+)\s*-\s*(\d+)/g, (_m, a: string, b: string) => `${b}-${a}`);
}

/**
 * A result from the circle and the score as written.
 *
 * The circle decides who won. The written score is turned to OUR side by
 * orienting it so the circled team leads on sets: written "6-1, 6-2" with them
 * circled becomes "1-6, 2-6"; written "1-6, 2-6" with them circled was already
 * from our side and is left alone. A split that doesn't say which way it was
 * written (a retirement at a set apiece) is taken as winner-first, the usual
 * way to write a score.
 *
 * Returns null when there is no usable circle — the caller keeps the model's
 * own reading for that line.
 */
export function resultFromCircle(
  circled: CircledSide,
  writtenScore: string | null,
): { won: boolean; score: string | null } | null {
  if (circled !== 'ours' && circled !== 'theirs') return null;
  const won = circled === 'ours';
  const written = writtenScore?.trim() || null;
  if (!written) return { won, score: null };

  const sets = setsFromScore(written); // ours = first number of each set as written
  const writtenWinnerFirst = sets.ours >= sets.theirs;
  const ourSideAlready = won ? writtenWinnerFirst : !writtenWinnerFirst;
  return { won, score: ourSideAlready ? written : flipScore(written) };
}
