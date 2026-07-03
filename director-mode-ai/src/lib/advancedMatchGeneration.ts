// Advanced multi-round match generation with rotation logic

interface Player {
  player_id: string;
  name: string;
  gender?: string;
  wins?: number;
  losses?: number;
  games_won?: number;
  games_lost?: number;
  team_id?: string;
  strength_order?: number;
}

export type GenerationMode = 'multi-random' | 'single-r1-balanced' | 'single-rN-tiered';

interface Pairing {
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
}

interface MatchHistory {
  playerId: string;
  partners: Set<string>;
  opponents: Set<string>;
  timesPlayed: number;
  byeCount: number;
  singlesPlayed: number;
}

interface TeamBattleConfig {
  singlesCourts: number;
  doublesCourts: number;
  team1Id: string;
  team2Id: string;
}

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class RoundGenerator {
  private matchHistory: Map<string, MatchHistory> = new Map();
  private teamBattleConfig: TeamBattleConfig | null = null;
  private randomize: boolean = false;
  private mode: GenerationMode = 'multi-random';

  constructor(private players: Player[], private numCourts: number, private format: string) {
    players.forEach(p => {
      this.matchHistory.set(p.player_id, {
        playerId: p.player_id,
        partners: new Set(),
        opponents: new Set(),
        timesPlayed: 0,
        byeCount: 0,
        singlesPlayed: 0,
      });
    });
  }

  public setRandomize(randomize: boolean): void {
    this.randomize = randomize;
  }

  public setMode(mode: GenerationMode): void {
    this.mode = mode;
  }

  public setTeamBattleConfig(config: TeamBattleConfig): void {
    this.teamBattleConfig = config;
  }

  private getHistory(playerId: string): MatchHistory | undefined {
    return this.matchHistory.get(playerId);
  }

  private hasPlayedWith(p1: string, p2: string): boolean {
    const history = this.getHistory(p1);
    return history ? history.partners.has(p2) : false;
  }

  private hasPlayedAgainst(p1: string, p2: string): boolean {
    const history = this.getHistory(p1);
    return history ? history.opponents.has(p2) : false;
  }

  public seedMatchHistory(historicalMatches: Array<{
    player1_id: string | null;
    player2_id: string | null;
    player3_id: string | null;
    player4_id: string | null;
  }>): void {
    historicalMatches.forEach(match => {
      if (match.player1_id && match.player2_id) {
        this.recordMatch(
          match.player1_id,
          match.player2_id,
          match.player3_id,
          match.player4_id
        );
      }
    });
  }

  private recordMatch(p1: string, p2: string, p3: string | null, p4: string | null): void {
    const allPlayersExist = [p1, p2, p3, p4].filter(Boolean).every(pid => this.matchHistory.has(pid!));
    if (!allPlayersExist) return;

    if (p3) {
      const h1 = this.getHistory(p1);
      const h3 = this.getHistory(p3);
      if (h1 && h3) {
        h1.partners.add(p3);
        h3.partners.add(p1);
      }
    }
    if (p4) {
      const h2 = this.getHistory(p2);
      const h4 = this.getHistory(p4);
      if (h2 && h4) {
        h2.partners.add(p4);
        h4.partners.add(p2);
      }
    }

    [p1, p3].filter(Boolean).forEach(teammate => {
      [p2, p4].filter(Boolean).forEach(opponent => {
        if (teammate && opponent) {
          const hTeammate = this.getHistory(teammate);
          const hOpponent = this.getHistory(opponent);
          if (hTeammate && hOpponent) {
            hTeammate.opponents.add(opponent);
            hOpponent.opponents.add(teammate);
          }
        }
      });
    });

    [p1, p2, p3, p4].filter(Boolean).forEach(pid => {
      if (pid) {
        const history = this.getHistory(pid);
        if (history) history.timesPlayed++;
      }
    });

    if (!p3 && !p4) {
      [p1, p2].forEach(pid => {
        const history = this.getHistory(pid);
        if (history) history.singlesPlayed++;
      });
    }
  }

  private scoreMatchup(p1: string, p2: string, p3: string | null, p4: string | null): number {
    let score = 0;

    const playCount = [p1, p2, p3, p4].filter(Boolean).reduce((sum, pid) => {
      const history = pid ? this.getHistory(pid) : null;
      return sum + (history ? history.timesPlayed : 0);
    }, 0);
    score -= playCount * 10;

    // Partner repeats are a HARD penalty — treat as near-forbidden
    if (p3 && this.hasPlayedWith(p1, p3)) score -= 10000;
    if (p4 && this.hasPlayedWith(p2, p4)) score -= 10000;

    // Opponent repeats are a soft penalty — avoid but tolerate when unavoidable
    if (this.hasPlayedAgainst(p1, p2)) score -= 200;
    if (p3 && p4 && this.hasPlayedAgainst(p3, p4)) score -= 200;
    if (p3 && p4 && this.hasPlayedAgainst(p1, p4)) score -= 200;
    if (p3 && p4 && this.hasPlayedAgainst(p2, p3)) score -= 200;

    // Jitter is always light — it must NEVER overwhelm history penalties
    score += Math.random() * 50 - 25;

    return score;
  }

  // Score a specific 4-player court config (p1+p3 vs p2+p4) given current history.
  private scoreCourtConfig(p1: string, p2: string, p3: string, p4: string): number {
    let score = 0;
    if (this.hasPlayedWith(p1, p3)) score -= 10000;
    if (this.hasPlayedWith(p2, p4)) score -= 10000;
    if (this.hasPlayedAgainst(p1, p2)) score -= 200;
    if (this.hasPlayedAgainst(p1, p4)) score -= 200;
    if (this.hasPlayedAgainst(p3, p2)) score -= 200;
    if (this.hasPlayedAgainst(p3, p4)) score -= 200;
    return score;
  }

  // Given 4 players a,b,c,d (already assigned to a court), pick the partner config
  // with fewest repeats. `preferBalanced` rewards the (a+d) vs (b+c) pattern when ties.
  private pickBestCourtConfig(a: Player, b: Player, c: Player, d: Player, preferBalanced: boolean): Pairing {
    // All 3 unique partner configurations, expressed as (p1, p2, p3, p4) with p1+p3 = Team A, p2+p4 = Team B
    const configs: Array<{ p1: Player; p2: Player; p3: Player; p4: Player; bonus: number }> = [
      { p1: a, p2: c, p3: b, p4: d, bonus: 0 },                     // {a,b} vs {c,d}
      { p1: a, p2: b, p3: c, p4: d, bonus: 0 },                     // {a,c} vs {b,d}
      { p1: a, p2: b, p3: d, p4: c, bonus: preferBalanced ? 100 : 0 }, // {a,d} vs {b,c}  (balanced)
    ];

    let best = configs[0];
    let bestScore = -Infinity;
    for (const cfg of configs) {
      const s = this.scoreCourtConfig(cfg.p1.player_id, cfg.p2.player_id, cfg.p3.player_id, cfg.p4.player_id)
        + cfg.bonus
        + (Math.random() * 10 - 5);
      if (s > bestScore) {
        bestScore = s;
        best = cfg;
      }
    }

    return {
      player1_id: best.p1.player_id,
      player2_id: best.p2.player_id,
      player3_id: best.p3.player_id,
      player4_id: best.p4.player_id,
    };
  }

  // Assign byes to players with the FEWEST byes so far, random tiebreak.
  private selectByes(active: Player[], byesNeeded: number): { byes: Player[]; playable: Player[] } {
    if (byesNeeded <= 0) return { byes: [], playable: [...active] };
    const sorted = [...active].sort((a, b) => {
      const bA = this.getHistory(a.player_id)?.byeCount ?? 0;
      const bB = this.getHistory(b.player_id)?.byeCount ?? 0;
      if (bA !== bB) return bA - bB;
      return Math.random() - 0.5;
    });
    return { byes: sorted.slice(0, byesNeeded), playable: sorted.slice(byesNeeded) };
  }

  // Standings rank for tiered mode: games_won desc, wins desc, strength_order asc.
  private standingsKey(p: Player): [number, number, number] {
    return [-(p.games_won ?? 0), -(p.wins ?? 0), p.strength_order ?? 999999];
  }

  private compareStandings(a: Player, b: Player): number {
    const kA = this.standingsKey(a);
    const kB = this.standingsKey(b);
    if (kA[0] !== kB[0]) return kA[0] - kB[0];
    if (kA[1] !== kB[1]) return kA[1] - kB[1];
    return kA[2] - kB[2];
  }

  private compareStrength(a: Player, b: Player): number {
    return (a.strength_order ?? 999999) - (b.strength_order ?? 999999);
  }

  generateMultipleRounds(numRounds: number): Pairing[][] {
    const allRounds: Pairing[][] = [];

    for (let round = 0; round < numRounds; round++) {
      const pairings = this.generateRound(round + 1);
      allRounds.push(pairings);
      
      pairings.forEach(pair => {
        if (pair.player1_id && pair.player2_id) {
          this.recordMatch(
            pair.player1_id,
            pair.player2_id,
            pair.player3_id,
            pair.player4_id
          );
        }
      });
    }

    return allRounds;
  }

  private generateRound(roundNumber: number): Pairing[] {
    if (this.format === "team-battle" && this.teamBattleConfig) {
      return this.generateTeamBattleRound(roundNumber);
    } else if (this.format === "singles") {
      return this.generateSinglesRound(roundNumber);
    } else if (this.format === "mixed-doubles") {
      return this.generateMixedDoublesRound(roundNumber);
    } else if (this.format === "maximize-courts") {
      return this.generateMaximizeCourtsRound();
    } else {
      return this.generateDoublesRound(roundNumber);
    }
  }

  // TEAM BATTLE: line-based matchups by strength order, like real team tennis.
  // Singles lines come off the top of each roster (court 1 = the two #1s),
  // doubles fill below with adjacent-rank partners, pair k vs pair k.
  // Fresh matchups trump line purity: a repeat opponent/partner (-450) loses
  // to any fresh choice within the 3-line search window (-100/line), so every
  // round produces different matchups until the window is exhausted. The hard
  // window cap is what guarantees a #1 can never draw the other team's bottom
  // player. `randomize` is intentionally ignored here: shuffling would
  // destroy strength alignment.
  private generateTeamBattleRound(roundNumber: number): Pairing[] {
    const config = this.teamBattleConfig!;
    const pairings: Pairing[] = [];

    const byStrength = (players: Player[]) => [...players].sort((a, b) => this.compareStrength(a, b));

    // Fair bye rotation: fewest byes sit first; among ties, most matches played.
    // (Bye matches aren't seeded into history, so a prior bye shows up as a
    // lower timesPlayed and protects that player from sitting twice.)
    const pickByes = (team: Player[], byesNeeded: number): Player[] => {
      if (byesNeeded <= 0) return [];
      const sorted = [...team].sort((a, b) => {
        const hA = this.getHistory(a.player_id);
        const hB = this.getHistory(b.player_id);
        const byeDiff = (hA?.byeCount ?? 0) - (hB?.byeCount ?? 0);
        if (byeDiff !== 0) return byeDiff;
        const playDiff = (hB?.timesPlayed ?? 0) - (hA?.timesPlayed ?? 0);
        if (playDiff !== 0) return playDiff;
        return Math.random() - 0.5;
      });
      return sorted.slice(0, byesNeeded);
    };

    const team1All = this.players.filter(p => p.team_id === config.team1Id);
    const team2All = this.players.filter(p => p.team_id === config.team2Id);

    const neededPerTeam = config.singlesCourts + config.doublesCourts * 2;
    const byes1 = pickByes(team1All, team1All.length - neededPerTeam);
    const byes2 = pickByes(team2All, team2All.length - neededPerTeam);
    const byeIds = new Set([...byes1, ...byes2].map(p => p.player_id));

    const available1 = byStrength(team1All.filter(p => !byeIds.has(p.player_id)));
    const available2 = byStrength(team2All.filter(p => !byeIds.has(p.player_id)));

    // Joint search over the whole round. Candidate singles line-ups draw from
    // a wide window of each team (so singles duty can rotate down the roster
    // night-long), but a hard cap keeps every line within 2 spots of its
    // opposite number — the two sides of a singles court are always close in
    // strength even when the court itself is mid-roster. Everything left
    // forms the doubles pools, paired via exhaustive matching with court
    // assignments permuted. The complete round is scored at once — repeat
    // opponents/partners -450, playing singles again -450 per prior singles
    // match (players rotate through singles before anyone goes twice), line
    // misalignment -100/line, doubles strength mismatch -50/rank — so
    // freshness and fairness trade off globally instead of court by court.
    const S = Math.min(config.singlesCourts, available1.length, available2.length);
    const D = Math.min(
      config.doublesCourts,
      Math.floor((available1.length - S) / 2),
      Math.floor((available2.length - S) / 2),
    );
    // Singles fairness is RELATIVE: putting someone in singles only costs
    // points if a teammate with fewer singles turns is still available. Once
    // everyone has played singles, the pressure disappears and matchup
    // freshness takes over again.
    const singlesCount = (p: Player) => this.getHistory(p.player_id)?.singlesPlayed ?? 0;
    const minSingles1 = Math.min(...available1.map(singlesCount), 0x7fffffff);
    const minSingles2 = Math.min(...available2.map(singlesCount), 0x7fffffff);
    // ±20 jitter keeps normal generation stable; the Shuffle button sets
    // randomize, where ±100 picks among near-equal rounds so it visibly moves
    // without ever out-shouting a repeat penalty (-450 vs max ±200 swing).
    const jitterSpan = this.randomize ? 200 : 40;

    const pos1 = new Map(available1.map((p, i) => [p.player_id, i] as const));
    const pos2 = new Map(available2.map((p, i) => [p.player_id, i] as const));

    const prep = (avail: Player[], sets: number[][]) => sets.map(set => {
      const chosen = new Set(set);
      const rest = avail.filter((_, idx) => !chosen.has(idx));
      return {
        set,
        singles: set.map(i => avail[i]),
        pool: rest.slice(0, 2 * D),
        leftover: rest.slice(2 * D),
        matchings: this.matchingCandidates(rest.slice(0, 2 * D), 12),
      };
    });

    const options1 = prep(available1, this.combosOf(Math.min(3 * S + 2, available1.length), S));
    const options2 = prep(available2, this.combosOf(Math.min(3 * S + 2, available2.length), S));
    const courtIdx = Array.from({ length: D }, (_, i) => i);
    const perms = D <= 4 ? this.permutations(courtIdx) : [courtIdx];

    let best: {
      o1: typeof options1[number]; o2: typeof options2[number];
      m1: Player[][]; m2: Player[][]; perm: number[];
    } | null = null;
    let bestScore = -Infinity;

    for (const o1 of options1) {
      for (const o2 of options2) {
        let sScore = 0;
        let aligned = true;
        for (let i = 0; i < S; i++) {
          if (Math.abs(o1.set[i] - o2.set[i]) > 2) { aligned = false; break; }
          sScore -= 100 * Math.abs(o1.set[i] - o2.set[i]);
          sScore -= 900 * Math.max(0, singlesCount(o1.singles[i]) - minSingles1);
          sScore -= 900 * Math.max(0, singlesCount(o2.singles[i]) - minSingles2);
          if (this.hasPlayedAgainst(o1.singles[i].player_id, o2.singles[i].player_id)) sScore -= 450;
        }
        if (!aligned) continue;
        for (const m1 of o1.matchings) {
          for (const m2 of o2.matchings) {
            for (const perm of perms) {
              let dScore = m1.score + m2.score;
              for (let c = 0; c < D; c++) {
                const pa = m1.pairs[c];
                const pb = m2.pairs[perm[c]];
                dScore -= 100 * Math.abs(c - perm[c]);
                dScore -= 50 * Math.abs(
                  pos1.get(pa[0].player_id)! + pos1.get(pa[1].player_id)!
                  - pos2.get(pb[0].player_id)! - pos2.get(pb[1].player_id)!);
                for (const a of pa) {
                  for (const b of pb) {
                    if (this.hasPlayedAgainst(a.player_id, b.player_id)) dScore -= 100;
                  }
                }
              }
              const total = sScore + dScore + Math.random() * jitterSpan - jitterSpan / 2;
              if (total > bestScore) {
                bestScore = total;
                best = { o1, o2, m1: m1.pairs, m2: m2.pairs, perm };
              }
            }
          }
        }
      }
    }

    if (best) {
      for (let i = 0; i < S; i++) {
        pairings.push({
          player1_id: best.o1.singles[i].player_id,
          player2_id: best.o2.singles[i].player_id,
          player3_id: null,
          player4_id: null,
        });
      }
      for (let c = 0; c < D; c++) {
        const [a1, a2] = best.m1[c];
        const [b1, b2] = best.m2[best.perm[c]];
        pairings.push({
          player1_id: a1.player_id,
          player2_id: b1.player_id,
          player3_id: a2.player_id,
          player4_id: b2.player_id,
        });
      }
    }

    // Byes + any leftovers on an oversized team sit this round.
    const leftovers = best ? [...best.o1.leftover, ...best.o2.leftover] : [...available1, ...available2];
    [...byes1, ...byes2, ...leftovers].forEach(p => {
      pairings.push({
        player1_id: p.player_id,
        player2_id: null,
        player3_id: null,
        player4_id: null,
      });
      const history = this.getHistory(p.player_id);
      if (history) history.byeCount++;
    });

    return pairings;
  }

  // Top `cap` doubles pairings of one team's pool (strongest first): every
  // perfect matching, scored for rank spread within pairs (-100/line skipped)
  // and repeat partners (-450).
  private matchingCandidates(pool: Player[], cap: number): Array<{ pairs: Player[][]; score: number }> {
    const idxOf = new Map(pool.map((p, i) => [p.player_id, i] as const));
    const idxSum = (pair: Player[]) => idxOf.get(pair[0].player_id)! + idxOf.get(pair[1].player_id)!;
    const scored = this.enumerateDoublesMatchings(pool).map(pairs => {
      let score = 0;
      for (const [p, q] of pairs) {
        score -= 100 * (Math.abs(idxOf.get(p.player_id)! - idxOf.get(q.player_id)!) - 1);
        if (this.hasPlayedWith(p.player_id, q.player_id)) score -= 450;
      }
      return { pairs: [...pairs].sort((x, y) => idxSum(x) - idxSum(y)), score: score + Math.random() * 20 - 10 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, cap);
  }

  // All k-subsets of {0..n-1}, ascending within each subset.
  private combosOf(n: number, k: number): number[][] {
    const res: number[][] = [];
    const rec = (start: number, cur: number[]) => {
      if (cur.length === k) { res.push([...cur]); return; }
      for (let i = start; i <= n - (k - cur.length); i++) {
        cur.push(i);
        rec(i + 1, cur);
        cur.pop();
      }
    };
    rec(0, []);
    return res;
  }

  // All perfect matchings of an even-sized pool (105 for 8 players — tiny).
  private enumerateDoublesMatchings(pool: Player[]): Player[][][] {
    if (pool.length === 0) return [[]];
    const [first, ...rest] = pool;
    const results: Player[][][] = [];
    for (let i = 0; i < rest.length; i++) {
      const remaining = rest.filter((_, idx) => idx !== i);
      for (const sub of this.enumerateDoublesMatchings(remaining)) {
        results.push([[first, rest[i]], ...sub]);
      }
    }
    return results;
  }

  private permutations(arr: number[]): number[][] {
    if (arr.length <= 1) return [[...arr]];
    const out: number[][] = [];
    arr.forEach((v, i) => {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      this.permutations(rest).forEach(p => out.push([v, ...p]));
    });
    return out;
  }

  // Compute how the courts should be split between doubles and singles for maximize-courts.
  // Preserves the original policy: greedily maximize doubles, fit singles with leftovers,
  // then if courts are still idle AND extra players exist, bulk out with more singles.
  private computeMaximizeCourtsAllocation(totalPlayers: number): { doublesCount: number; singlesCount: number } {
    const maxDoublesMatches = Math.floor(totalPlayers / 4);
    const remainingAfterDoubles = totalPlayers - (maxDoublesMatches * 4);
    const maxSinglesMatches = Math.floor(remainingAfterDoubles / 2);

    const doublesCount = Math.min(maxDoublesMatches, this.numCourts);
    let singlesCount = Math.min(maxSinglesMatches, this.numCourts - doublesCount);

    const playersUsed = doublesCount * 4 + singlesCount * 2;
    const courtsUsed = doublesCount + singlesCount;
    if (courtsUsed < this.numCourts && totalPlayers > playersUsed) {
      const extraSingles = Math.min(
        this.numCourts - courtsUsed,
        Math.floor((totalPlayers - playersUsed) / 2),
      );
      singlesCount += extraSingles;
    }

    return { doublesCount, singlesCount };
  }

  private generateMaximizeCourtsRound(): Pairing[] {
    const active = [...this.players];
    const { doublesCount, singlesCount } = this.computeMaximizeCourtsAllocation(active.length);
    const playingCount = doublesCount * 4 + singlesCount * 2;
    const byesNeeded = Math.max(0, active.length - playingCount);

    if (this.mode === 'single-r1-balanced') {
      return this.buildMaximizeCourtsChunked(active, doublesCount, singlesCount, byesNeeded, 'balanced');
    }
    if (this.mode === 'single-rN-tiered') {
      return this.buildMaximizeCourtsChunked(active, doublesCount, singlesCount, byesNeeded, 'tiered');
    }
    return this.buildMaximizeCourtsRandom(active, doublesCount, singlesCount, byesNeeded);
  }

  // BALANCED / TIERED: sort players by strength_order (balanced) or live standings (tiered),
  // snake-fill doubles courts with top+bottom pairings, drop middle-rank players onto
  // singles courts (adjacent pairs so singles are evenly matched).
  private buildMaximizeCourtsChunked(
    active: Player[],
    doublesCount: number,
    singlesCount: number,
    byesNeeded: number,
    kind: 'balanced' | 'tiered',
  ): Pairing[] {
    const pairings: Pairing[] = [];
    const { byes, playable } = this.selectByes(active, byesNeeded);

    const sorted = [...playable].sort((a, b) =>
      kind === 'balanced' ? this.compareStrength(a, b) : this.compareStandings(a, b));

    if (kind === 'balanced') {
      // Snake: pull the top (doublesCount*2) and bottom (doublesCount*2) for doubles courts.
      // The middle N players go to singles (adjacent-rank pairs = evenly-matched singles).
      const doublesHalf = doublesCount * 2;
      const top = sorted.slice(0, doublesHalf);
      const bottom = sorted.slice(sorted.length - doublesHalf);
      const middle = sorted.slice(doublesHalf, sorted.length - doublesHalf);

      for (let i = 0; i < doublesCount; i++) {
        const a = top[2 * i];
        const b = top[2 * i + 1];
        const c = bottom[bottom.length - 2 * i - 2];
        const d = bottom[bottom.length - 2 * i - 1];
        pairings.push(this.pickBestCourtConfig(a, b, c, d, true));
      }

      for (let i = 0; i < singlesCount && 2 * i + 1 < middle.length; i++) {
        pairings.push({
          player1_id: middle[2 * i].player_id,
          player2_id: middle[2 * i + 1].player_id,
          player3_id: null,
          player4_id: null,
        });
      }
    } else {
      // Tiered: top of standings fills Court 1 doubles, next tier Court 2, etc.
      // Singles courts get the tiers below that, adjacent pairs for fairness.
      let cursor = 0;
      for (let i = 0; i < doublesCount && cursor + 3 < sorted.length; i++) {
        const a = sorted[cursor++];
        const b = sorted[cursor++];
        const c = sorted[cursor++];
        const d = sorted[cursor++];
        pairings.push(this.pickBestCourtConfig(a, b, c, d, true));
      }
      for (let i = 0; i < singlesCount && cursor + 1 < sorted.length; i++) {
        pairings.push({
          player1_id: sorted[cursor++].player_id,
          player2_id: sorted[cursor++].player_id,
          player3_id: null,
          player4_id: null,
        });
      }
    }

    byes.forEach(p => {
      pairings.push({
        player1_id: p.player_id,
        player2_id: null,
        player3_id: null,
        player4_id: null,
      });
      const h = this.getHistory(p.player_id);
      if (h) h.byeCount++;
    });

    return pairings;
  }

  // MULTI-RANDOM: exhaustive-ish search per court, hard-avoid partner repeats and
  // soft-avoid opponent repeats for doubles, soft-avoid opponent repeats for singles.
  private buildMaximizeCourtsRandom(
    active: Player[],
    doublesCount: number,
    singlesCount: number,
    byesNeeded: number,
  ): Pairing[] {
    const pairings: Pairing[] = [];

    // Pull byes first (lowest byeCount catches up), then play-sooner-sort the remaining pool.
    const { byes, playable } = this.selectByes(active, byesNeeded);
    byes.forEach(p => {
      pairings.push({
        player1_id: p.player_id,
        player2_id: null,
        player3_id: null,
        player4_id: null,
      });
      const h = this.getHistory(p.player_id);
      if (h) h.byeCount++;
    });

    let available = [...playable].sort((a, b) => {
      const bA = this.getHistory(a.player_id)?.byeCount ?? 0;
      const bB = this.getHistory(b.player_id)?.byeCount ?? 0;
      if (bA !== bB) return bB - bA;
      return Math.random() - 0.5;
    });

    // Allocate doubles courts by searching for the best 4-player quad + its best partner config.
    for (let court = 0; court < doublesCount && available.length >= 4; court++) {
      let bestQuad: { players: Player[]; score: number } | null = null;

      for (let i = 0; i < Math.min(available.length - 3, 4); i++) {
        for (let j = i + 1; j < Math.min(available.length - 2, 6); j++) {
          for (let k = j + 1; k < Math.min(available.length - 1, 8); k++) {
            for (let l = k + 1; l < Math.min(available.length, 10); l++) {
              const quad = [available[i], available[j], available[k], available[l]];
              const s1 = this.scoreCourtConfig(quad[0].player_id, quad[2].player_id, quad[1].player_id, quad[3].player_id);
              const s2 = this.scoreCourtConfig(quad[0].player_id, quad[1].player_id, quad[2].player_id, quad[3].player_id);
              const s3 = this.scoreCourtConfig(quad[0].player_id, quad[1].player_id, quad[3].player_id, quad[2].player_id);
              const playCount = quad.reduce((sum, p) => sum + (this.getHistory(p.player_id)?.timesPlayed ?? 0), 0);
              const score = Math.max(s1, s2, s3) - playCount * 10 + (Math.random() * 50 - 25);

              if (!bestQuad || score > bestQuad.score) {
                bestQuad = { players: quad, score };
              }
            }
          }
        }
      }

      if (!bestQuad) break;

      pairings.push(this.pickBestCourtConfig(
        bestQuad.players[0],
        bestQuad.players[1],
        bestQuad.players[2],
        bestQuad.players[3],
        false,
      ));

      bestQuad.players.forEach(p => {
        const idx = available.findIndex(ap => ap.player_id === p.player_id);
        if (idx >= 0) available.splice(idx, 1);
      });
    }

    // Allocate singles courts by searching for the best 2-player pair.
    for (let court = 0; court < singlesCount && available.length >= 2; court++) {
      let bestPair: { players: Player[]; score: number } | null = null;

      for (let i = 0; i < Math.min(available.length - 1, 6); i++) {
        for (let j = i + 1; j < Math.min(available.length, 8); j++) {
          const pair = [available[i], available[j]];
          let score = 0;
          if (this.hasPlayedAgainst(pair[0].player_id, pair[1].player_id)) score -= 200;
          const playCount = (this.getHistory(pair[0].player_id)?.timesPlayed ?? 0)
            + (this.getHistory(pair[1].player_id)?.timesPlayed ?? 0);
          score -= playCount * 10;
          score += Math.random() * 50 - 25;
          if (!bestPair || score > bestPair.score) {
            bestPair = { players: pair, score };
          }
        }
      }

      if (!bestPair) break;

      pairings.push({
        player1_id: bestPair.players[0].player_id,
        player2_id: bestPair.players[1].player_id,
        player3_id: null,
        player4_id: null,
      });

      bestPair.players.forEach(p => {
        const idx = available.findIndex(ap => ap.player_id === p.player_id);
        if (idx >= 0) available.splice(idx, 1);
      });
    }

    // Any leftover = BYE (should only happen if court allocation under-counts).
    while (available.length > 0) {
      const p = available.shift()!;
      pairings.push({
        player1_id: p.player_id,
        player2_id: null,
        player3_id: null,
        player4_id: null,
      });
      const h = this.getHistory(p.player_id);
      if (h) h.byeCount++;
    }

    return pairings;
  }

  private generateDoublesRound(roundNumber: number): Pairing[] {
    if (this.mode === 'single-r1-balanced') return this.generateBalancedDoublesRound();
    if (this.mode === 'single-rN-tiered') return this.generateTieredDoublesRound();
    return this.generateRandomDoublesRound();
  }

  // MULTI-RANDOM: shuffle pool, exhaustive-search 4-player windows, pick best partner config per court.
  // Hard-penalizes repeat partners (-10000) and soft-penalizes repeat opponents (-200).
  private generateRandomDoublesRound(): Pairing[] {
    const pairings: Pairing[] = [];
    const active = [...this.players];

    // Sort so players with MORE prior byes play first (they're "due"), random tiebreak.
    let available = [...active].sort((a, b) => {
      const bA = this.getHistory(a.player_id)?.byeCount ?? 0;
      const bB = this.getHistory(b.player_id)?.byeCount ?? 0;
      if (bA !== bB) return bB - bA;
      return Math.random() - 0.5;
    });

    while (available.length >= 4 && pairings.length < this.numCourts) {
      let bestQuad: { players: Player[]; score: number } | null = null;

      for (let i = 0; i < Math.min(available.length - 3, 4); i++) {
        for (let j = i + 1; j < Math.min(available.length - 2, 6); j++) {
          for (let k = j + 1; k < Math.min(available.length - 1, 8); k++) {
            for (let l = k + 1; l < Math.min(available.length, 10); l++) {
              const quad = [available[i], available[j], available[k], available[l]];
              // Score = best of 3 partner configs + light jitter
              const s1 = this.scoreCourtConfig(quad[0].player_id, quad[2].player_id, quad[1].player_id, quad[3].player_id); // {a,b} vs {c,d}
              const s2 = this.scoreCourtConfig(quad[0].player_id, quad[1].player_id, quad[2].player_id, quad[3].player_id); // {a,c} vs {b,d}
              const s3 = this.scoreCourtConfig(quad[0].player_id, quad[1].player_id, quad[3].player_id, quad[2].player_id); // {a,d} vs {b,c}
              const playCount = quad.reduce((sum, p) => sum + (this.getHistory(p.player_id)?.timesPlayed ?? 0), 0);
              const score = Math.max(s1, s2, s3) - playCount * 10 + (Math.random() * 50 - 25);

              if (!bestQuad || score > bestQuad.score) {
                bestQuad = { players: quad, score };
              }
            }
          }
        }
      }

      if (!bestQuad) break;

      pairings.push(this.pickBestCourtConfig(
        bestQuad.players[0],
        bestQuad.players[1],
        bestQuad.players[2],
        bestQuad.players[3],
        false,
      ));

      bestQuad.players.forEach(p => {
        const idx = available.findIndex(ap => ap.player_id === p.player_id);
        if (idx >= 0) available.splice(idx, 1);
      });
    }

    // Remaining players sit out (BYE).
    while (available.length > 0) {
      const byePlayer = available.shift()!;
      pairings.push({
        player1_id: byePlayer.player_id,
        player2_id: null,
        player3_id: null,
        player4_id: null,
      });
      const h = this.getHistory(byePlayer.player_id);
      if (h) h.byeCount++;
    }

    return pairings;
  }

  // SINGLE-ROUND ROUND 1 — BALANCED: snake-chunk by strength_order so each court has 2 top + 2 bottom.
  // For 12 players on 3 courts: Court 1 = ranks {1,2,11,12}, Court 2 = {3,4,9,10}, Court 3 = {5,6,7,8}.
  // Within each court the pairing is (top+bottom) vs (top+bottom) for evenly-matched teams.
  private generateBalancedDoublesRound(): Pairing[] {
    return this.generateChunkedDoublesRound('balanced');
  }

  // SINGLE-ROUND ROUND 2+ — TIERED: rank by live standings, stack top 4 → Court 1, next 4 → Court 2, etc.
  // Within each court still use balanced pairing so the match itself is competitive.
  private generateTieredDoublesRound(): Pairing[] {
    return this.generateChunkedDoublesRound('tiered');
  }

  private generateChunkedDoublesRound(kind: 'balanced' | 'tiered'): Pairing[] {
    const pairings: Pairing[] = [];
    const active = [...this.players];

    const usableCourts = Math.min(this.numCourts, Math.floor(active.length / 4));
    const playableCount = usableCourts * 4;
    const byesNeeded = active.length - playableCount;

    const { byes, playable } = this.selectByes(active, byesNeeded);

    // Re-sort playable now that byes are removed, by the mode's ranking.
    playable.sort((a, b) => kind === 'balanced' ? this.compareStrength(a, b) : this.compareStandings(a, b));

    if (kind === 'balanced') {
      // Snake: court i (0-indexed) gets playable[2i], playable[2i+1], playable[N-2i-2], playable[N-2i-1]
      const N = playable.length;
      for (let i = 0; i < usableCourts; i++) {
        const a = playable[2 * i];
        const b = playable[2 * i + 1];
        const c = playable[N - 2 * i - 2];
        const d = playable[N - 2 * i - 1];
        // a=top-stronger, b=next, c=next-weakest, d=weakest of this chunk
        // Preferred pairing: (a+d) vs (b+c) — balanced team sums
        pairings.push(this.pickBestCourtConfig(a, b, c, d, true));
      }
    } else {
      // Tiered: sequential 4-player chunks top-down
      for (let i = 0; i < usableCourts; i++) {
        const a = playable[4 * i];
        const b = playable[4 * i + 1];
        const c = playable[4 * i + 2];
        const d = playable[4 * i + 3];
        // Within a tier of 4, (a+d) vs (b+c) keeps the match competitive (stronger+weaker per team)
        pairings.push(this.pickBestCourtConfig(a, b, c, d, true));
      }
    }

    byes.forEach(p => {
      pairings.push({
        player1_id: p.player_id,
        player2_id: null,
        player3_id: null,
        player4_id: null,
      });
      const h = this.getHistory(p.player_id);
      if (h) h.byeCount++;
    });

    return pairings;
  }

  private generateSinglesRound(roundNumber: number): Pairing[] {
    const pairings: Pairing[] = [];
    let available: Player[];

    if (this.randomize) {
      const byePlayers = this.players.filter(p => {
        const h = this.getHistory(p.player_id);
        return h && h.byeCount > 0;
      });
      const nonByePlayers = this.players.filter(p => {
        const h = this.getHistory(p.player_id);
        return !h || h.byeCount === 0;
      });
      available = [...shuffle(byePlayers), ...shuffle(nonByePlayers)];
    } else {
      available = [...this.players];
      available.sort((a, b) => {
        const historyA = this.getHistory(a.player_id);
        const historyB = this.getHistory(b.player_id);
        if (!historyA || !historyB) return 0;
        if (historyA.byeCount !== historyB.byeCount) {
          return historyB.byeCount - historyA.byeCount;
        }
        return historyA.timesPlayed - historyB.timesPlayed;
      });
    }

    while (available.length >= 2 && pairings.length < this.numCourts) {
      let bestMatchup: { players: Player[], score: number } | null = null;

      for (let i = 0; i < Math.min(available.length - 1, 6); i++) {
        for (let j = i + 1; j < Math.min(available.length, 8); j++) {
          const players = [available[i], available[j]];
          
          let score = 0;
          const h0 = this.getHistory(players[0].player_id);
          const h1 = this.getHistory(players[1].player_id);
          const playCount = (h0?.timesPlayed || 0) + (h1?.timesPlayed || 0);
          score -= playCount * 10;
          
          if (this.hasPlayedAgainst(players[0].player_id, players[1].player_id)) {
            score -= 300;
          }

          score += Math.random() * 50 - 25;

          if (!bestMatchup || score > bestMatchup.score) {
            bestMatchup = { players, score };
          }
        }
      }

      if (bestMatchup) {
        pairings.push({
          player1_id: bestMatchup.players[0].player_id,
          player2_id: bestMatchup.players[1].player_id,
          player3_id: null,
          player4_id: null,
        });

        bestMatchup.players.forEach(p => {
          const idx = available.findIndex(ap => ap.player_id === p.player_id);
          if (idx >= 0) available.splice(idx, 1);
        });
      } else {
        pairings.push({
          player1_id: available[0].player_id,
          player2_id: available[1].player_id,
          player3_id: null,
          player4_id: null,
        });
        available.splice(0, 2);
      }
    }

    while (available.length > 0) {
      const byePlayer = available.shift()!;
      pairings.push({
        player1_id: byePlayer.player_id,
        player2_id: null,
        player3_id: null,
        player4_id: null,
      });
      const history = this.getHistory(byePlayer.player_id);
      if (history) history.byeCount++;
    }

    return pairings;
  }

  private generateMixedDoublesRound(roundNumber: number): Pairing[] {
    let males = this.players.filter(p => p.gender === 'male');
    let females = this.players.filter(p => p.gender === 'female');
    
    if (this.randomize) {
      males = shuffle(males);
      females = shuffle(females);
    }

    const pairings: Pairing[] = [];
    const maxPairs = Math.min(males.length, females.length, this.numCourts * 2);
    
    for (let i = 0; i < Math.floor(maxPairs / 2); i++) {
      const idx = i * 2;
      pairings.push({
        player1_id: males[idx]?.player_id || null,
        player2_id: females[idx]?.player_id || null,
        player3_id: males[idx + 1]?.player_id || null,
        player4_id: females[idx + 1]?.player_id || null,
      });
    }

    return pairings;
  }
}

export const generateMultipleRounds = (
  format: string,
  players: Player[],
  numCourts: number,
  numRounds: number
): Pairing[][] => {
  const generator = new RoundGenerator(players, numCourts, format);
  return generator.generateMultipleRounds(numRounds);
};
