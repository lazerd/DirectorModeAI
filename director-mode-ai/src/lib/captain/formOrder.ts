/**
 * Strength order from match results — the junior equivalent of "order by WTN".
 *
 * A 10U player has no WTN and no NTRP, so the strength order is whatever the
 * captain typed in July. After the first JTT match day Darrin could see it was
 * already wrong: Noelle Boone won everything from line 3, Gavin Cohen lost from
 * line 2. This turns played lines into a form number and PROPOSES a new order.
 *
 * What it deliberately does NOT do:
 * - It never applies itself. The captain taps to accept; with 10U kids a
 *   demotion is a conversation, not a calculation.
 * - It does not count raw wins. Winning the line you were seeded at is par;
 *   winning a line above your seed is what moves you. A tight loss costs less
 *   than a 4-0 loss.
 * - It leans on singles. A doubles line is partly the partner, and JTT pairs in
 *   reverse strength order on purpose, so a doubles result says less about one
 *   player than a singles result does.
 * - It moves slowly: at most one place per match day a player has played, so
 *   one bad morning against a strong club can't drop a kid two spots.
 */

export type FormPlayer = {
  id: string;
  name: string;
  /** 1-based strength order today. Unranked players sit after the ranked ones. */
  seed: number;
};

export type FormLine = {
  /** Line number within its own kind: singles 1..n, doubles 1..n. */
  lineNumber: number;
  courtType: 'singles' | 'doubles';
  playerIds: string[];
  /** Did our side win. Null = no result recorded, so the line is ignored. */
  won: boolean | null;
  /** As entered; perspective is read off `won`, not off the order of the numbers. */
  score: string | null;
  /** A defaulted line was never played — it says nothing about anyone. */
  defaulted?: boolean;
};

export type FormMatch = {
  matchId: string;
  /** Chronological order is the caller's job; used only for the movement cap. */
  lines: FormLine[];
};

export type PlayerForm = {
  playerId: string;
  name: string;
  /** Positive = beating their seeding, negative = below it. Arbitrary units. */
  form: number;
  wins: number;
  losses: number;
  /** Match days this player has a played line in. */
  days: number;
  /** Plain sentences, strongest first, for the proposal row. */
  reasons: string[];
};

export type FormProposal = {
  playerId: string;
  name: string;
  from: number;
  to: number;
  form: number;
  reasons: string[];
};

const SINGLES_WEIGHT = 1;
const DOUBLES_WEIGHT = 0.5;
const K = 24;

/** Games won and lost, oriented by the result rather than by how it was typed. */
export function gamesFrom(score: string | null | undefined, won: boolean): { for: number; against: number } | null {
  const nums = [...String(score || '').matchAll(/(\d+)\s*-\s*(\d+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
  if (nums.length < 2) return null;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < nums.length - 1; i += 2) {
    hi += Math.max(nums[i], nums[i + 1]);
    lo += Math.min(nums[i], nums[i + 1]);
  }
  return won ? { for: hi, against: lo } : { for: lo, against: hi };
}

/**
 * How likely a player seeded `seed` is to win the line they were put on.
 *
 * Both teams field their own order, so line 2 usually meets the other club's
 * number 2: a player on the line matching their seed is a coin flip. Playing
 * above your seed (a 3 covering line 1) is expected to lose; below it is
 * expected to win, and winning there proves nothing.
 */
export function expectedWin(seed: number, lineNumber: number): number {
  return 1 / (1 + 10 ** ((seed - lineNumber) / 2));
}

/** One line's contribution to a player's form. */
function delta(line: FormLine, seed: number): number {
  const won = line.won === true;
  const games = gamesFrom(line.score, won);
  // A win with no score recorded still counts, just without the margin.
  const share = games && games.for + games.against > 0 ? (games.for - games.against) / (games.for + games.against) : won ? 0.5 : -0.5;
  const performance = 0.5 + 0.5 * Math.max(-1, Math.min(1, share));
  const weight = line.courtType === 'singles' ? SINGLES_WEIGHT : DOUBLES_WEIGHT;
  // Doubles lines pair in reverse order, so the line number says nothing about
  // the opposition a player faced: par is a coin flip.
  const expected = line.courtType === 'singles' ? expectedWin(seed, line.lineNumber) : 0.5;
  return K * weight * (performance - expected);
}

const ordinal = (n: number) => `#${n}`;

export function playerForm(players: FormPlayer[], matches: FormMatch[]): PlayerForm[] {
  const seedOf = new Map(players.map((p) => [p.id, p.seed]));
  const out = new Map<string, PlayerForm>(
    players.map((p) => [p.id, { playerId: p.id, name: p.name, form: 0, wins: 0, losses: 0, days: 0, reasons: [] }]),
  );

  for (const m of matches) {
    const seenThisDay = new Set<string>();
    for (const line of m.lines) {
      if (line.defaulted || line.won == null) continue;
      for (const pid of line.playerIds) {
        const row = out.get(pid);
        const seed = seedOf.get(pid);
        if (!row || seed == null) continue;
        row.form += delta(line, seed);
        if (line.won) row.wins += 1;
        else row.losses += 1;
        if (!seenThisDay.has(pid)) {
          seenThisDay.add(pid);
          row.days += 1;
        }
        const games = gamesFrom(line.score, line.won);
        const margin = games ? ` ${games.for}-${games.against}` : '';
        const where = line.courtType === 'singles' ? `singles ${ordinal(line.lineNumber)}` : `doubles ${ordinal(line.lineNumber)}`;
        row.reasons.push(`${line.won ? 'Won' : 'Lost'} at ${where}${margin}`);
      }
    }
  }

  return players.map((p) => out.get(p.id) as PlayerForm);
}

/**
 * The proposed order: strongest form first, but nobody moves more than one
 * place per match day they have played.
 */
export function proposeOrder(
  players: FormPlayer[],
  matches: FormMatch[],
): { order: string[]; proposals: FormProposal[]; form: PlayerForm[] } {
  const form = playerForm(players, matches);
  const formOf = new Map(form.map((f) => [f.playerId, f]));
  const current = [...players].sort((a, b) => a.seed - b.seed);
  const currentIndex = new Map(current.map((p, i) => [p.id, i]));

  /*
   * Swap neighbours, biggest disagreement first, and give each player a budget
   * of one swap per match day they have played.
   *
   * Sorting by form and then clamping how far anyone may travel doesn't work:
   * clamping one player's move shifts everyone below them, so after one match
   * day Noelle came out at #1 — two places — because Miles dropped past her.
   * A swap moves exactly two players by exactly one place, so the budget is
   * the guarantee, not an afterthought.
   */
  const order = current.map((p) => p.id);
  const budget = new Map(order.map((id) => [id, formOf.get(id)?.days ?? 0]));
  const formValue = (id: string) => formOf.get(id)?.form ?? 0;

  for (let guard = 0; guard < players.length * players.length; guard++) {
    let best = -1;
    let bestGap = 0;
    for (let i = 0; i < order.length - 1; i++) {
      const a = order[i];
      const b = order[i + 1];
      /*
       * `b` is the one climbing, `a` the one dropping. The climber must have
       * played — a result is the only thing that earns a place. The player
       * dropping may be someone who hasn't played (a teammate who missed the
       * day shouldn't block everyone below them), and then spends no budget.
       * What is NOT allowed is dropping a player who did play below one who
       * didn't: Paloma lost a close doubles and fell behind a kid who wasn't
       * there, which is not something a result should ever do.
       */
      const played = (id: string) => (formOf.get(id)?.days ?? 0) > 0;
      if (!played(b) || !budget.get(b)) continue;
      if (played(a) && !budget.get(a)) continue;
      const gap = formValue(b) - formValue(a);
      if (gap > bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    if (best < 0) break;
    const a = order[best];
    const b = order[best + 1];
    order[best] = b;
    order[best + 1] = a;
    for (const id of [a, b]) {
      if ((formOf.get(id)?.days ?? 0) > 0) budget.set(id, (budget.get(id) as number) - 1);
    }
  }
  const proposals: FormProposal[] = [];
  order.forEach((id, i) => {
    const from = (currentIndex.get(id) as number) + 1;
    const to = i + 1;
    if (from === to) return;
    const f = formOf.get(id);
    proposals.push({
      playerId: id,
      name: f?.name ?? '',
      from,
      to,
      form: Math.round((f?.form ?? 0) * 10) / 10,
      reasons: f?.reasons ?? [],
    });
  });

  // Biggest climbers first: that is the row a captain wants to read.
  proposals.sort((a, b) => a.to - b.to);
  return { order, proposals, form };
}
