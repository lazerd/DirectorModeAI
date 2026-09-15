/**
 * Wild Card — rotating-partner doubles. Pure functions only.
 *
 * The club version of this is an Excel sheet that "randomly assigns players,
 * partners, courts and rotations" for a Saturday social: 12 men + 12 women,
 * a few rounds, a new partner and new opponents every round, and the winner
 * is an individual (partners rotate, so nobody wins as a team).
 *
 * Priorities, in order:
 *   1. No repeat partners.
 *   2. Few repeat opponents.
 *   3. Sit-outs spread evenly, and nobody sits two rounds running.
 *
 * Courts are CAPACITY, not a quota: 8 courts and 22 players uses 5 courts and
 * sits 2. In mixed mode a court is one man + one woman per team; players the
 * mixed courts can't absorb (14 men, 10 women) fill an extra open court before
 * anyone is sat out, and the open-court spot rotates like a sit-out does.
 *
 * Deterministic: the same players + courts + rounds + mode + seed always give
 * the same schedule, so a printed sheet can be regenerated exactly. The
 * director's "Re-shuffle" is just a new seed.
 */

export type WildCardMode = 'mixed' | 'open';

export interface WildCardPlayer {
  id: string;
  gender?: string | null;
}

export interface WildCardCourt {
  /** 0-based court slot in play order. Map to a real court number at write time. */
  slot: number;
  /** 'mixed' = one man + one woman per team. 'open' = any four. */
  kind: 'mixed' | 'open';
  teamA: string[];
  teamB: string[];
}

export interface WildCardRound {
  courts: WildCardCourt[];
  sitOuts: string[];
}

export interface WildCardOptions {
  players: WildCardPlayer[];
  /** Courts available (capacity). */
  courts: number;
  rounds: number;
  mode: WildCardMode;
  seed: number;
  /**
   * Rounds already played or locked. They count toward partner/opponent/sit-out
   * history but are not returned. Used when re-shuffling the rounds that
   * haven't started yet.
   */
  history?: WildCardRound[];
}

// Search weights. A repeat partner must outweigh any number of opponent
// repeats a single swap could fix; open-court rotation is the lightest touch.
const PARTNER_REPEAT = 1000;
const OPPONENT_REPEAT = 10;
const OPEN_COURT_AGAIN = 3;
const RESTARTS = 8;
const ITERATIONS_PER_SLOT = 250;

/** Small, fast, seedable PRNG (mulberry32). Returns [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for the Re-shuffle button. Kept in int4 range for the DB column. */
export function newWildCardSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000) + 1;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * How a round fills the courts: `mixed` courts (2 men + 2 women), `open`
 * courts, and how many sit. Exported so the setup screen can preview it.
 */
export function planWildCardRound(
  men: number,
  women: number,
  courts: number,
  mode: WildCardMode,
): { mixedCourts: number; openCourts: number; sitOuts: number } {
  const total = men + women;
  const cap = Math.max(0, Math.floor(courts));
  if (mode === 'open') {
    const openCourts = Math.min(cap, Math.floor(total / 4));
    return { mixedCourts: 0, openCourts, sitOuts: total - openCourts * 4 };
  }
  const mixedCourts = Math.min(cap, Math.floor(men / 2), Math.floor(women / 2));
  const openCourts = Math.min(cap - mixedCourts, Math.floor((total - mixedCourts * 4) / 4));
  return { mixedCourts, openCourts, sitOuts: total - (mixedCourts + openCourts) * 4 };
}

export function generateWildCard(opts: WildCardOptions): WildCardRound[] {
  const rng = seededRandom(opts.seed);
  // Sort by id so the input order (strength drag, check-in order) can't change
  // the schedule a seed produces.
  const players = [...opts.players].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const N = players.length;
  const indexOf = new Map(players.map((p, i) => [p.id, i] as const));

  // Role per player: 0 = plays a man's spot, 1 = a woman's. In open mode
  // everyone is role 0. A player with no recorded gender fills whichever side
  // is short, so one missing field doesn't throw a mixed court away.
  const role = new Uint8Array(N);
  if (opts.mode === 'mixed') {
    let men = 0;
    let women = 0;
    const unknown: number[] = [];
    players.forEach((p, i) => {
      const g = (p.gender || '').toLowerCase();
      if (g === 'male') { role[i] = 0; men++; }
      else if (g === 'female') { role[i] = 1; women++; }
      else unknown.push(i);
    });
    for (const i of unknown) {
      if (women < men) { role[i] = 1; women++; } else { role[i] = 0; men++; }
    }
  }

  const partner = new Uint16Array(N * N);
  const opponent = new Uint16Array(N * N);
  const sits = new Uint16Array(N);
  const openCount = new Uint16Array(N);
  let satLast = new Uint8Array(N);

  const record = (round: WildCardRound) => {
    const next = new Uint8Array(N);
    for (const id of round.sitOuts) {
      const i = indexOf.get(id);
      if (i === undefined) continue;
      sits[i]++;
      next[i] = 1;
    }
    for (const court of round.courts) {
      const a = court.teamA.map((id) => indexOf.get(id)).filter((i): i is number => i !== undefined);
      const b = court.teamB.map((id) => indexOf.get(id)).filter((i): i is number => i !== undefined);
      for (const team of [a, b]) {
        if (team.length === 2) {
          partner[team[0] * N + team[1]]++;
          partner[team[1] * N + team[0]]++;
        }
      }
      for (const x of a) for (const y of b) {
        opponent[x * N + y]++;
        opponent[y * N + x]++;
      }
      if (court.kind === 'open' && opts.mode === 'mixed') {
        for (const i of [...a, ...b]) openCount[i]++;
      }
    }
    satLast = next;
  };

  for (const h of opts.history || []) record(h);

  const out: WildCardRound[] = [];
  if (N < 4) return out;

  for (let r = 0; r < opts.rounds; r++) {
    const menIdx: number[] = [];
    const womenIdx: number[] = [];
    for (let i = 0; i < N; i++) (role[i] === 0 ? menIdx : womenIdx).push(i);

    const plan = planWildCardRound(menIdx.length, womenIdx.length, opts.courts, opts.mode);
    const K = plan.mixedCourts;
    const E = plan.openCourts;

    // Who sits: fewest sit-outs so far, then whoever did NOT sit last round,
    // then the seed. A side can only give up players the mixed courts don't need.
    const order = shuffleInPlace(Array.from({ length: N }, (_, i) => i), rng)
      .sort((x, y) => (sits[x] - sits[y]) || (satLast[x] - satLast[y]));
    const canSit = [menIdx.length - 2 * K, womenIdx.length - 2 * K];
    const sitSet = new Set<number>();
    for (const i of order) {
      if (sitSet.size >= plan.sitOuts) break;
      const side = opts.mode === 'open' ? 0 : role[i];
      if (opts.mode === 'mixed' && canSit[side] <= 0) continue;
      sitSet.add(i);
      canSit[side]--;
    }

    // Slots: court c occupies [4c .. 4c+3] = A1, A2, B1, B2. On a mixed court
    // A1/B1 are men's spots and A2/B2 women's; swaps keep that shape, so every
    // candidate the search visits is a legal round.
    const slots = 4 * (K + E);
    const slotRole = new Int8Array(slots).fill(-1); // -1 = any
    for (let c = 0; c < K; c++) {
      slotRole[4 * c] = 0; slotRole[4 * c + 2] = 0;
      slotRole[4 * c + 1] = 1; slotRole[4 * c + 3] = 1;
    }

    const courtCost = (a: Int32Array, c: number): number => {
      const a1 = a[4 * c], a2 = a[4 * c + 1], b1 = a[4 * c + 2], b2 = a[4 * c + 3];
      let cost = PARTNER_REPEAT * (partner[a1 * N + a2] + partner[b1 * N + b2]);
      cost += OPPONENT_REPEAT * (
        opponent[a1 * N + b1] + opponent[a1 * N + b2] + opponent[a2 * N + b1] + opponent[a2 * N + b2]
      );
      if (c >= K && opts.mode === 'mixed') {
        cost += OPEN_COURT_AGAIN * (openCount[a1] + openCount[a2] + openCount[b1] + openCount[b2]);
      }
      return cost;
    };

    const playingMen = menIdx.filter((i) => !sitSet.has(i));
    const playingWomen = womenIdx.filter((i) => !sitSet.has(i));

    let best: Int32Array | null = null;
    let bestCost = Infinity;

    for (let restart = 0; restart < RESTARTS && slots > 0; restart++) {
      const assign = new Int32Array(slots);
      const m = shuffleInPlace([...playingMen], rng);
      const w = shuffleInPlace([...playingWomen], rng);
      for (let c = 0; c < K; c++) {
        assign[4 * c] = m.pop()!; assign[4 * c + 2] = m.pop()!;
        assign[4 * c + 1] = w.pop()!; assign[4 * c + 3] = w.pop()!;
      }
      const rest = shuffleInPlace([...m, ...w], rng);
      for (let s = 4 * K; s < slots; s++) assign[s] = rest.pop()!;

      const costs = Array.from({ length: K + E }, (_, c) => courtCost(assign, c));
      let total = costs.reduce((x, y) => x + y, 0);

      const iterations = ITERATIONS_PER_SLOT * slots;
      for (let it = 0; it < iterations && total > 0; it++) {
        const i = Math.floor(rng() * slots);
        const j = Math.floor(rng() * slots);
        if (i === j) continue;
        const ci = i >> 2, cj = j >> 2;
        // Within one court, swapping teammates' seats changes nothing.
        if (ci === cj && (i >> 1) === (j >> 1)) continue;
        if (slotRole[i] !== -1 && role[assign[j]] !== slotRole[i]) continue;
        if (slotRole[j] !== -1 && role[assign[i]] !== slotRole[j]) continue;

        const before = ci === cj ? costs[ci] : costs[ci] + costs[cj];
        const t = assign[i]; assign[i] = assign[j]; assign[j] = t;
        const ni = courtCost(assign, ci);
        const nj = ci === cj ? ni : courtCost(assign, cj);
        const after = ci === cj ? ni : ni + nj;
        // Accept sideways moves too — they walk the plateaus between local minima.
        if (after <= before) {
          costs[ci] = ni;
          costs[cj] = nj;
          total += after - before;
        } else {
          assign[j] = assign[i]; assign[i] = t;
        }
      }

      if (total < bestCost) {
        bestCost = total;
        best = assign;
        if (total === 0) break;
      }
    }

    // Court order is shuffled too, so the same group isn't always on court 1.
    const courtOrder = shuffleInPlace(Array.from({ length: K + E }, (_, c) => c), rng);
    const ids = (i: number) => players[i].id;
    const round: WildCardRound = {
      courts: courtOrder.map((c, slot) => ({
        slot,
        kind: c < K ? 'mixed' : 'open',
        teamA: [ids(best![4 * c]), ids(best![4 * c + 1])],
        teamB: [ids(best![4 * c + 2]), ids(best![4 * c + 3])],
      })),
      sitOuts: order.filter((i) => sitSet.has(i)).map(ids).sort(),
    };
    out.push(round);
    record(round);
  }

  return out;
}

/** Quality report for a schedule (plus any history it was built on). */
export function wildCardStats(rounds: WildCardRound[]): {
  repeatPartners: number;
  repeatOpponents: number;
  sitOuts: Record<string, number>;
  backToBackSitOuts: number;
} {
  const partners = new Map<string, number>();
  const opponents = new Map<string, number>();
  const sitOuts: Record<string, number> = {};
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
  let backToBackSitOuts = 0;
  let prev = new Set<string>();

  for (const round of rounds) {
    for (const c of round.courts) {
      for (const t of [c.teamA, c.teamB]) if (t.length === 2) bump(partners, key(t[0], t[1]));
      for (const x of c.teamA) for (const y of c.teamB) bump(opponents, key(x, y));
    }
    for (const id of round.sitOuts) {
      sitOuts[id] = (sitOuts[id] || 0) + 1;
      if (prev.has(id)) backToBackSitOuts++;
    }
    prev = new Set(round.sitOuts);
  }

  const repeats = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + Math.max(0, n - 1), 0);
  return {
    repeatPartners: repeats(partners),
    repeatOpponents: repeats(opponents),
    sitOuts,
    backToBackSitOuts,
  };
}

// ---------------------------------------------------------------------------
// Storage mapping. A Wild Card round is stored like every mixer round: one
// `matches` row per court (Team 1 = player1 + player3, Team 2 = player2 +
// player4) and one row per sit-out with only player1 set — the shape RoundsTab,
// the score dialog and the standings already read.
// ---------------------------------------------------------------------------

export interface MatchRowLite {
  court_number: number;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
}

export function wildCardRoundToRows(
  round: WildCardRound,
  courtNumberFor: (slot: number) => number,
): MatchRowLite[] {
  const rows: MatchRowLite[] = round.courts.map((c) => ({
    court_number: courtNumberFor(c.slot),
    player1_id: c.teamA[0] ?? null,
    player3_id: c.teamA[1] ?? null,
    player2_id: c.teamB[0] ?? null,
    player4_id: c.teamB[1] ?? null,
  }));
  round.sitOuts.forEach((id, i) => {
    rows.push({
      court_number: courtNumberFor(round.courts.length + i),
      player1_id: id,
      player2_id: null,
      player3_id: null,
      player4_id: null,
    });
  });
  return rows;
}

/** Inverse of wildCardRoundToRows, for feeding played rounds back in as history. */
export function rowsToWildCardRound(rows: MatchRowLite[]): WildCardRound {
  const courts: WildCardCourt[] = [];
  const sitOuts: string[] = [];
  const sorted = [...rows].sort((a, b) => a.court_number - b.court_number);
  for (const r of sorted) {
    const isSitOut = r.player1_id && !r.player2_id && !r.player3_id && !r.player4_id;
    if (isSitOut) {
      sitOuts.push(r.player1_id!);
      continue;
    }
    const teamA = [r.player1_id, r.player3_id].filter((x): x is string => !!x);
    const teamB = [r.player2_id, r.player4_id].filter((x): x is string => !!x);
    if (teamA.length === 0 || teamB.length === 0) continue;
    courts.push({ slot: courts.length, kind: 'open', teamA, teamB });
  }
  return { courts, sitOuts };
}

// ---------------------------------------------------------------------------
// Individual standings. Partners rotate, so the Wild Card crowns a person:
// most games won, then most rounds won, then best game difference.
// ---------------------------------------------------------------------------

export interface WildCardScoredMatch extends MatchRowLite {
  team1_score: number | null;
  team2_score: number | null;
  winner_team: number | null;
}

export interface WildCardStanding {
  id: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  gamesWon: number;
  gamesLost: number;
  /** "1", "2", "T-3" … */
  rank: string;
}

export function computeWildCardStandings(
  players: { id: string; name: string }[],
  matches: WildCardScoredMatch[],
): WildCardStanding[] {
  const rows = new Map<string, WildCardStanding>(
    players.map((p) => [p.id, { id: p.id, name: p.name, played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, rank: '' }]),
  );

  for (const m of matches) {
    const s1 = m.team1_score ?? 0;
    const s2 = m.team2_score ?? 0;
    const scored = m.winner_team != null || s1 > 0 || s2 > 0;
    if (!scored) continue;
    const winner = m.winner_team ?? (s1 > s2 ? 1 : s2 > s1 ? 2 : null);
    const sides: Array<[Array<string | null>, number, number, number]> = [
      [[m.player1_id, m.player3_id], s1, s2, 1],
      [[m.player2_id, m.player4_id], s2, s1, 2],
    ];
    if (!m.player2_id && !m.player4_id) continue; // a sit-out row
    for (const [ids, gw, gl, side] of sides) {
      for (const id of ids) {
        const row = id ? rows.get(id) : undefined;
        if (!row) continue;
        row.played++;
        row.gamesWon += gw;
        row.gamesLost += gl;
        if (winner === side) row.wins++;
        else if (winner != null) row.losses++;
      }
    }
  }

  const list = [...rows.values()].sort(
    (a, b) =>
      b.gamesWon - a.gamesWon ||
      b.wins - a.wins ||
      (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost) ||
      a.name.localeCompare(b.name),
  );
  const same = (a: WildCardStanding, b: WildCardStanding) =>
    a.gamesWon === b.gamesWon && a.wins === b.wins && a.gamesWon - a.gamesLost === b.gamesWon - b.gamesLost;
  list.forEach((row, i) => {
    if (i > 0 && same(row, list[i - 1])) {
      const prev = list[i - 1];
      if (!prev.rank.startsWith('T-')) prev.rank = `T-${prev.rank}`;
      row.rank = prev.rank;
    } else {
      row.rank = String(i + 1);
    }
  });
  return list;
}

/** "Wild Card: rotating partners" in the club's words, for badges and headers. */
export const WILD_CARD_LABEL = 'Wild Card: rotating partners';
