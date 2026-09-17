/**
 * CompassDrawSvg — a compass draw drawn the way a draw sheet is actually drawn:
 * names on lines, joined by elbow connectors, each round advancing outward.
 *
 * The centre row is ONE continuous bracket. Round 1 sits in the middle, the East
 * (championship) half runs right through Quarters/Semis/Final, and the West half
 * runs left. North hangs above, South below, and the four corner playoffs sit in
 * the diagonal quadrants — so the sheet is literally a compass.
 *
 * It renders as a single <svg> with a viewBox, so it scales to whatever width it
 * is given and always fits the screen without pan/zoom.
 *
 * Hookless, no server-only imports — same constraints as the rest of DrawView.
 */

export type Entry = {
  id: string;
  player_name: string;
  partner_name: string | null;
  seed: number | null;
};

export type Match = {
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

// ---- geometry -------------------------------------------------------------
export const PW = 172; // width of a player line
export const SEP = 20; // vertical gap between a match's two player lines
// No gap between rounds: with no connector elbows, each round's line starts
// exactly where the previous one ends, emerging from the midpoint of the
// pair that feeds it — the join reads without a line being drawn for it.
const GAP = 0;
export const COL = PW + GAP;
export const PITCH = 56; // vertical distance between Round 1 match centres

const ARM_UP_1 = -108; // North semis row
const ARM_UP_2 = -168; // North final row

/**
 * A placed match. yA/yB are the two player lines' absolute heights — NOT a
 * centre plus a fixed gap. On a real draw sheet a winner's line continues at
 * the centre height of the match they just won, so each round's two lines land
 * on the midpoints of the pair feeding it and the spacing doubles each round.
 */
export type Placed = { m: Match | null; x: number; yA: number; yB: number; flow: 'right' | 'left' };

export const mid = (p: Placed) => (p.yA + p.yB) / 2;

/** A first-round match: two lines a fixed SEP apart, centred on `y`. */
export const seedRow = (m: Match, x: number, y: number, flow: 'right' | 'left'): Placed =>
  ({ m, x, yA: y - SEP / 2, yB: y + SEP / 2, flow });

/** A later-round match: its lines sit on the centres of the pair feeding it. */
export const feedRow = (m: Match, x: number, a: Placed, b: Placed, flow: 'right' | 'left'): Placed =>
  ({ m, x, yA: mid(a), yB: mid(b), flow });

const colorFor: Record<string, string> = {
  r1: '#0f172a',
  east: '#1d4ed8',
  ne: '#0891b2',
  north: '#0d9488',
  nw: '#65a30d',
  west: '#c2410c',
  sw: '#b45309',
  south: '#a16207',
  se: '#57534e',
};

export function compassSizeOf(matches: Array<{ bracket: string; round: number }>): 16 | 8 | null {
  const n = matches.filter((m) => m.bracket === 'main' && m.round === 1).length;
  return n >= 8 ? 16 : n >= 4 ? 8 : null;
}

export default function CompassDrawSvg({
  matches,
  entryById,
  revealAllSeeds = false,
}: {
  matches: Match[];
  entryById: Map<string, Entry>;
  revealAllSeeds?: boolean;
}) {
  const size = compassSizeOf(matches);
  if (!size) return null;

  const pick = (bracket: 'main' | 'consolation', round: number) =>
    matches.filter((m) => m.bracket === bracket && m.round === round).sort((a, b) => a.slot - b.slot);

  const groups: Array<{ id: string; title: string; place: string; note: string; items: Placed[] }> = [];
  /** The single line each draw terminates in, carrying its winner out. */
  const champs: Array<{ x: number; y: number; len: number; entryId: string | null; score: string | null; color: string }> = [];

  const addChamp = (arr: Placed[], color: string, len: number = PW) => {
    const p = arr[0];
    if (!p || !p.m) return;
    const x = p.flow === 'right' ? rightEdge(p) : leftEdge(p) - len;
    const entryId =
      p.m.winner_side === 'a' ? p.m.player1_id
      : p.m.winner_side === 'b' ? p.m.player3_id
      : null;
    const score = p.m.winner_side ? winnerFirst(p.m.score, p.m.winner_side) : null;
    champs.push({ x, y: mid(p), len, entryId, score, color });
  };

  if (size === 16) {
    const r1 = pick('main', 1).map<Placed>((m, j) => seedRow(m, 0, j * PITCH, 'right'));
    const eQ = pick('main', 2).map<Placed>((m, i) => feedRow(m, COL, r1[2 * i], r1[2 * i + 1], 'right'));
    const eS = pick('main', 3).map<Placed>((m, i) => feedRow(m, 2 * COL, eQ[2 * i], eQ[2 * i + 1], 'right'));
    const eF = pick('main', 4).map<Placed>((m) => feedRow(m, 3 * COL, eS[0], eS[1], 'right'));

    const wR = pick('consolation', 1).map<Placed>((m, i) => feedRow(m, 0, r1[2 * i], r1[2 * i + 1], 'left'));
    const wS = pick('consolation', 2).map<Placed>((m, i) => feedRow(m, -COL, wR[2 * i], wR[2 * i + 1], 'left'));
    const wF = pick('consolation', 3).map<Placed>((m) => feedRow(m, -2 * COL, wS[0], wS[1], 'left'));

    // North and South are their own mirrored draws, stacked above and below the
    // main band: two semis on the centre axis, the final out to the right, the
    // corner playoff out to the left — the same shape as the middle band.
    const bottom = (r1.length - 1) * PITCH;
    const NY = ARM_UP_2;          // centre line of the North band
    const SY = bottom - ARM_UP_2; // centre line of the South band
    const SPREAD = 34;

    const nS = pick('consolation', 4).map<Placed>((m, i) => seedRow(m, 0, NY + (i === 0 ? -SPREAD : SPREAD), 'right'));
    const nF = pick('consolation', 5).map<Placed>((m) => feedRow(m, COL, nS[0], nS[1], 'right'));
    const sS = pick('consolation', 6).map<Placed>((m, i) => seedRow(m, 0, SY + (i === 0 ? -SPREAD : SPREAD), 'right'));
    const sF = pick('consolation', 7).map<Placed>((m) => feedRow(m, COL, sS[0], sS[1], 'right'));

    const ne = pick('consolation', 8).map<Placed>((m) => seedRow(m, 3 * COL, NY, 'right'));
    const nw = pick('consolation', 10).map<Placed>((m) => seedRow(m, -2 * COL, NY, 'left'));
    const sw = pick('consolation', 9).map<Placed>((m) => seedRow(m, -2 * COL, SY, 'left'));
    const se = pick('consolation', 11).map<Placed>((m) => seedRow(m, 3 * COL, SY, 'right'));

    addChamp(eF, colorFor.east); addChamp(wF, colorFor.west);
    addChamp(nF, colorFor.north, PW * 0.5); addChamp(sF, colorFor.south, PW * 0.5);
    addChamp(ne, colorFor.ne); addChamp(nw, colorFor.nw);
    addChamp(sw, colorFor.sw); addChamp(se, colorFor.se);

    groups.push(
      { id: 'r1', title: 'Round 1', place: 'All 16', note: 'Everyone starts here', items: r1 },
      { id: 'east', title: 'East', place: '1st – 2nd', note: 'Win and keep going', items: [...eQ, ...eS, ...eF] },
      { id: 'west', title: 'West', place: '9th – 10th', note: 'Lost Round 1', items: [...wR, ...wS, ...wF] },
      { id: 'north', title: 'North', place: '5th – 6th', note: 'Lost the East quarters', items: [...nS, ...nF] },
      { id: 'south', title: 'South', place: '13th – 14th', note: 'Lost again in West', items: [...sS, ...sF] },
      { id: 'ne', title: 'Northeast', place: '3rd – 4th', note: 'Lost the East semi', items: ne },
      { id: 'nw', title: 'Northwest', place: '7th – 8th', note: 'Lost in North', items: nw },
      { id: 'sw', title: 'Southwest', place: '11th – 12th', note: 'Lost in West', items: sw },
      { id: 'se', title: 'Southeast', place: '15th – 16th', note: 'Lost in South', items: se },
    );
  } else {
    const r1 = pick('main', 1).map<Placed>((m, j) => seedRow(m, 0, j * PITCH, 'right'));
    const eS = pick('main', 2).map<Placed>((m, i) => feedRow(m, COL, r1[2 * i], r1[2 * i + 1], 'right'));
    const eF = pick('main', 3).map<Placed>((m) => feedRow(m, 2 * COL, eS[0], eS[1], 'right'));
    const wS = pick('consolation', 1).map<Placed>((m, i) => feedRow(m, 0, r1[2 * i], r1[2 * i + 1], 'left'));
    const wF = pick('consolation', 2).map<Placed>((m) => feedRow(m, -COL, wS[0], wS[1], 'left'));
    const bottom = (r1.length - 1) * PITCH;
    const nF = pick('main', 4).map<Placed>((m) => seedRow(m, COL, ARM_UP_1, 'right'));
    const sF = pick('consolation', 3).map<Placed>((m) => seedRow(m, -COL, bottom - ARM_UP_1, 'left'));

    addChamp(eF, colorFor.east); addChamp(wF, colorFor.west);
    addChamp(nF, colorFor.north, PW * 0.5); addChamp(sF, colorFor.south, PW * 0.5);

    groups.push(
      { id: 'r1', title: 'Round 1', place: 'All 8', note: 'Everyone starts here', items: r1 },
      { id: 'east', title: 'East', place: '1st – 2nd', note: 'Win and keep going', items: [...eS, ...eF] },
      { id: 'west', title: 'West', place: '5th – 6th', note: 'Lost Round 1', items: [...wS, ...wF] },
      { id: 'north', title: 'North', place: '3rd – 4th', note: 'Lost the semi', items: nF },
      { id: 'south', title: 'South', place: '7th – 8th', note: 'Lost again', items: sF },
    );
  }

  const all = groups.flatMap((g) => g.items);
  const xs = all.flatMap((p) => [leftEdge(p), rightEdge(p)])
    .concat(champs.flatMap((c) => [c.x, c.x + c.len]));
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
      aria-label="Compass draw"
    >
      <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="#ffffff" />

      {groups.map((g) => {
        const it = g.items;
        if (it.length === 0) return null;
        const gx = it.reduce((s, p) => s + (p.flow === 'right' ? p.x : p.x - PW), 0) / it.length;
        const gy = Math.min(...it.map((p) => p.yA)) - 34;
        return (
          <text key={`h-${g.id}`} x={gx + PW / 2} y={gy} textAnchor="middle"
                fontSize={13} fontWeight={700} fill={colorFor[g.id]}
                style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
            {g.title}
            <tspan fontSize={10.5} fontWeight={600} fill="#64748b"> · {g.place}</tspan>
            <tspan x={gx + PW / 2} dy={13} fontSize={9.5} fontWeight={400} fill="#94a3b8">
              {g.note}
            </tspan>
          </text>
        );
      })}

      {champs.map((c, i) => {
        const e = c.entryId ? entryById.get(c.entryId) : undefined;
        const name = e
          ? e.partner_name ? `${e.player_name} / ${e.partner_name}` : e.player_name
          : null;
        return (
          <g key={`c-${i}`}>
            <path d={`M ${c.x} ${c.y} H ${c.x + c.len}`} stroke="#111827"
                  strokeOpacity={name ? 0.9 : 0.35} strokeWidth={name ? 1.4 : 1} fill="none" />
            {name && (
              <text x={c.x + c.len / 2} y={c.y - 6} textAnchor="middle" fontSize={12.5}
                    fontWeight={700} fill={c.color}
                    style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
                {name}
              </text>
            )}
            {name && c.score && (
              <text x={c.x + c.len / 2} y={c.y + 13} textAnchor="middle" fontSize={9.5}
                    fill="#64748b" style={{ fontFamily: 'ui-monospace, monospace' }}>
                {c.score}
              </text>
            )}
          </g>
        );
      })}

      {groups.map((g) =>
        g.items.map((p, i) =>
          p.m ? (
            <MatchLines key={`${g.id}-${i}`} p={p} entryById={entryById}
                        revealAllSeeds={revealAllSeeds} color={colorFor[g.id]}
                        tieBothSides={g.id === 'r1'} />
          ) : null
        )
      )}
    </svg>
  );
}

export const leftEdge = (p: Placed) => (p.flow === 'right' ? p.x : p.x - PW);
export const rightEdge = (p: Placed) => leftEdge(p) + PW;

export function MatchLines({
  p, entryById, revealAllSeeds, color, tieBothSides = false,
}: {
  p: Placed;
  entryById: Map<string, Entry>;
  revealAllSeeds: boolean;
  color: string;
  /**
   * Compass only: Round 1 feeds East off its right edge and West off its left,
   * so its pairing bar is drawn on BOTH sides. Every other round — and every
   * normal one-directional draw — ties on one side only.
   */
  tieBothSides?: boolean;
}) {
  const m = p.m!;
  const left = p.flow === 'right' ? p.x : p.x - PW;
  const a = m.player1_id ? entryById.get(m.player1_id) : undefined;
  const b = m.player3_id ? entryById.get(m.player3_id) : undefined;
  const yA = p.yA;
  const yB = p.yB;
  return (
    <g>
      <PlayerLine x={left} y={yA} entry={a} won={m.winner_side === 'a'} score={sideScore(m.score, 'a')} revealAllSeeds={revealAllSeeds} color={color} />
      <PlayerLine x={left} y={yB} entry={b} won={m.winner_side === 'b'} score={sideScore(m.score, 'b')} revealAllSeeds={revealAllSeeds} color={color} />
      {/* the vertical tie joining the pair, as on a printed draw sheet */}
      <path d={`M ${p.flow === 'right' ? left + PW : left} ${yA} V ${yB}`}
            stroke="#111827" strokeOpacity={0.85} strokeWidth={1.1} fill="none" />
      {tieBothSides && (
        <path d={`M ${p.flow === 'right' ? left : left + PW} ${yA} V ${yB}`}
              stroke="#111827" strokeOpacity={0.85} strokeWidth={1.1} fill="none" />
      )}
    </g>
  );
}

function PlayerLine({
  x, y, entry, won, score, revealAllSeeds, color,
}: {
  x: number; y: number; entry: Entry | undefined; won: boolean;
  score: string; revealAllSeeds: boolean; color: string;
}) {
  const name = entry
    ? entry.partner_name ? `${entry.player_name} / ${entry.partner_name}` : entry.player_name
    : '';
  const showSeed = entry?.seed != null && (revealAllSeeds || entry.seed <= 4);
  return (
    <g>
      <path d={`M ${x} ${y} H ${x + PW}`} stroke={entry ? '#111827' : '#d7dee8'}
            strokeWidth={1} fill="none" />
      {showSeed && (
        <text x={x + 2} y={y - 4} fontSize={8.5} fontWeight={700} fill="#94a3b8"
              style={{ fontFamily: 'ui-monospace, monospace' }}>
          {entry!.seed}
        </text>
      )}
      <text
        x={x + (showSeed ? 15 : 4)} y={y - 4}
        fontSize={11.5} fontWeight={won ? 700 : 400}
        fill={entry ? (won ? color : '#475569') : '#c7d2de'}
        fontStyle={entry ? undefined : 'italic'}
        style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
      >
        {name || 'TBD'}
      </text>
      {score && (
        <text x={x + PW - 3} y={y - 4} textAnchor="end" fontSize={10}
              fill={won ? '#0f172a' : '#94a3b8'}
              style={{ fontFamily: 'ui-monospace, monospace' }}>
          {score}
        </text>
      )}
    </g>
  );
}

/** Scores are stored from side A's view; a champion's line reads winner-first. */
export function winnerFirst(score: string | null, winner: 'a' | 'b'): string | null {
  if (!score || winner === 'a') return score;
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

function sideScore(score: string | null, side: 'a' | 'b'): string {
  if (!score) return '';
  const cleaned = score.replace(/,?\s*(RET|W\/O|WO|DEF)\s*$/i, '').trim();
  if (!cleaned) return '';
  const games: string[] = [];
  for (const part of cleaned.split(/[,\s]+/).filter(Boolean)) {
    const mm = part.match(/^(\d+)-(\d+)$/);
    if (!mm) return '';
    games.push(side === 'a' ? mm[1] : mm[2]);
  }
  return games.join(' ');
}
