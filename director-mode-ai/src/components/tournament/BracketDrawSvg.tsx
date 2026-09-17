/**
 * BracketDrawSvg — a standard elimination draw, drawn with the same engine as
 * the compass sheet (see CompassDrawSvg, which owns the geometry).
 *
 * Same rules, because they're what a printed sheet does: names sit on lines,
 * each round's two lines land on the CENTRE of the two matches feeding it so
 * spacing doubles outward, rounds butt together so the join reads without a
 * connector, and every bracket terminates in a winner line with the score
 * written under it, winner-first.
 *
 * The one compass-specific flourish is left out: Round 1 ties on one side only,
 * because a normal draw feeds one direction.
 *
 * Scope is deliberately narrow. Only draws whose every round is exactly half
 * the previous one are laid out here. Feed-in formats (FMLC/FFIC) inject
 * players mid-bracket, so the pairwise assumption doesn't hold and they keep
 * the column renderer — `layoutBracket` returns null and DrawView falls back.
 */

import {
  PW, SEP, COL, PITCH,
  mid, seedRow, feedRow, leftEdge, rightEdge,
  MatchLines, winnerFirst,
  type Entry, type Match, type Placed,
} from './CompassDrawSvg';

const BRACKET_GAP = 96; // vertical space between the main and consolation draws

type Round = { round: number; label: string; items: Placed[] };
type Section = { bracket: 'main' | 'consolation'; title: string; rounds: Round[] };

function roundLabel(round: number, totalRounds: number, bracket: 'main' | 'consolation'): string {
  if (round === totalRounds) return bracket === 'consolation' ? 'Consolation Final' : 'Final';
  if (round === totalRounds - 1) return 'Semifinals';
  if (round === totalRounds - 2) return 'Quarterfinals';
  return `Round of ${2 ** (totalRounds - round + 1)}`;
}

/** Lay out one bracket top-down from `yTop`. Null if it isn't a clean tree. */
function layoutOne(
  bracket: 'main' | 'consolation',
  matches: Match[],
  yTop: number
): { rounds: Round[]; height: number } | null {
  const nums = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  if (nums.length === 0) return null;

  const byRound = nums.map((r) =>
    matches.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot)
  );
  // Every round must be exactly half the one before it, ending at a single final.
  for (let i = 1; i < byRound.length; i++) {
    if (byRound[i].length !== byRound[i - 1].length / 2) return null;
  }
  if (byRound[byRound.length - 1].length !== 1) return null;

  const total = nums.length;
  const rounds: Round[] = [];
  let prev: Placed[] = [];
  for (let i = 0; i < byRound.length; i++) {
    const items =
      i === 0
        ? byRound[0].map((m, j) => seedRow(m, 0, yTop + j * PITCH, 'right'))
        : byRound[i].map((m, k) => feedRow(m, i * COL, prev[2 * k], prev[2 * k + 1], 'right'));
    rounds.push({ round: nums[i], label: roundLabel(nums[i], total, bracket), items });
    prev = items;
  }
  const height = (byRound[0].length - 1) * PITCH + SEP;
  return { rounds, height };
}

export function layoutBracket(matches: Match[]): Section[] | null {
  const sections: Section[] = [];
  let y = 0;
  for (const bracket of ['main', 'consolation'] as const) {
    const sub = matches.filter((m) => m.bracket === bracket);
    if (sub.length === 0) continue;
    const laid = layoutOne(bracket, sub, y);
    if (!laid) return null;
    sections.push({
      bracket,
      title: bracket === 'main' ? 'Main Draw' : 'Consolation',
      rounds: laid.rounds,
    });
    y += laid.height + BRACKET_GAP;
  }
  return sections.length ? sections : null;
}

export default function BracketDrawSvg({
  matches,
  entryById,
  revealAllSeeds = false,
}: {
  matches: Match[];
  entryById: Map<string, Entry>;
  revealAllSeeds?: boolean;
}) {
  const sections = layoutBracket(matches);
  if (!sections) return null;

  const all = sections.flatMap((s) => s.rounds.flatMap((r) => r.items));

  // Winner line off each bracket's final.
  const champs = sections.flatMap((s) => {
    const last = s.rounds[s.rounds.length - 1].items[0];
    if (!last?.m) return [];
    const entryId =
      last.m.winner_side === 'a' ? last.m.player1_id
      : last.m.winner_side === 'b' ? last.m.player3_id
      : null;
    return [{
      x: rightEdge(last),
      y: mid(last),
      entryId,
      score: last.m.winner_side ? winnerFirst(last.m.score, last.m.winner_side) : null,
    }];
  });

  const xs = all.flatMap((p) => [leftEdge(p), rightEdge(p)]).concat(champs.flatMap((c) => [c.x, c.x + PW]));
  const ys = all.flatMap((p) => [p.yA, p.yB]);
  const PAD = 54;
  const minX = Math.min(...xs) - PAD;
  const maxX = Math.max(...xs) + PAD;
  const minY = Math.min(...ys) - PAD - 18;
  const maxY = Math.max(...ys) + PAD;

  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      className="w-full h-auto mx-auto block"
      // Never scale a small draw UP past its natural size, or a 3-round bracket
      // balloons to fill a wide screen and the type goes with it.
      style={{ maxWidth: maxX - minX, maxHeight: '78vh' }}
      role="img"
      aria-label="Tournament draw"
    >
      <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="#ffffff" />

      {sections.map((s) =>
        s.rounds.map((r) => {
          const top = Math.min(...r.items.map((p) => p.yA));
          return (
            <text
              key={`h-${s.bracket}-${r.round}`}
              x={leftEdge(r.items[0]) + PW / 2}
              y={top - 16}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="#334155"
              style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
            >
              {r.label}
              {r.round === s.rounds[0].round && (
                <tspan fontSize={10} fontWeight={600} fill="#94a3b8"> · {s.title}</tspan>
              )}
            </text>
          );
        })
      )}

      {champs.map((c, i) => {
        const e = c.entryId ? entryById.get(c.entryId) : undefined;
        const name = e
          ? e.partner_name ? `${e.player_name} / ${e.partner_name}` : e.player_name
          : null;
        return (
          <g key={`c-${i}`}>
            <path d={`M ${c.x} ${c.y} H ${c.x + PW}`} stroke="#111827"
                  strokeOpacity={name ? 0.9 : 0.35} strokeWidth={name ? 1.4 : 1} fill="none" />
            {name && (
              <text x={c.x + PW / 2} y={c.y - 6} textAnchor="middle" fontSize={12.5}
                    fontWeight={700} fill="#111827"
                    style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
                {name}
              </text>
            )}
            {name && c.score && (
              <text x={c.x + PW / 2} y={c.y + 13} textAnchor="middle" fontSize={9.5}
                    fill="#64748b" style={{ fontFamily: 'ui-monospace, monospace' }}>
                {c.score}
              </text>
            )}
          </g>
        );
      })}

      {sections.map((s) =>
        s.rounds.map((r) =>
          r.items.map((p, i) =>
            p.m ? (
              <MatchLines key={`${s.bracket}-${r.round}-${i}`} p={p} entryById={entryById}
                          revealAllSeeds={revealAllSeeds} color="#1d4ed8" />
            ) : null
          )
        )
      )}
    </svg>
  );
}
