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

  private generateTeamBattleRound(roundNumber: number): Pairing[] {
    const config = this.teamBattleConfig!;
    const pairings: Pairing[] = [];

    const sortPlayers = (players: Player[]) => {
      const sorted = [...players];
      if (this.randomize) {
        return shuffle(sorted);
      }
      sorted.sort((a, b) => {
        const hA = this.getHistory(a.player_id);
        const hB = this.getHistory(b.player_id);
        if (!hA || !hB) return 0;
        if (hA.byeCount !== hB.byeCount) return hB.byeCount - hA.byeCount;
        return hA.timesPlayed - hB.timesPlayed;
      });
      return sorted;
    };

    const team1Players = sortPlayers(this.players.filter(p => p.team_id === config.team1Id));
    const team2Players = sortPlayers(this.players.filter(p => p.team_id === config.team2Id));

    const available1 = [...team1Players];
    const available2 = [...team2Players];

    // Generate doubles matches first (Team1 pair vs Team2 pair)
    for (let i = 0; i < config.doublesCourts && available1.length >= 2 && available2.length >= 2; i++) {
      let bestT1Pair: Player[] | null = null;
      let bestT1Score = -Infinity;
      
      for (let a = 0; a < Math.min(available1.length - 1, 4); a++) {
        for (let b = a + 1; b < Math.min(available1.length, 5); b++) {
          let score = 0;
          const h1 = this.getHistory(available1[a].player_id);
          const h2 = this.getHistory(available1[b].player_id);
          score -= (h1?.timesPlayed || 0) + (h2?.timesPlayed || 0);
          if (this.hasPlayedWith(available1[a].player_id, available1[b].player_id)) {
            score -= 500;
          }
          score += Math.random() * 50 - 25;
          if (score > bestT1Score) {
            bestT1Score = score;
            bestT1Pair = [available1[a], available1[b]];
          }
        }
      }

      let bestT2Pair: Player[] | null = null;
      let bestT2Score = -Infinity;
      
      for (let a = 0; a < Math.min(available2.length - 1, 4); a++) {
        for (let b = a + 1; b < Math.min(available2.length, 5); b++) {
          let score = 0;
          const h1 = this.getHistory(available2[a].player_id);
          const h2 = this.getHistory(available2[b].player_id);
          score -= (h1?.timesPlayed || 0) + (h2?.timesPlayed || 0);
          if (this.hasPlayedWith(available2[a].player_id, available2[b].player_id)) {
            score -= 500;
          }
          score += Math.random() * 50 - 25;
          if (score > bestT2Score) {
            bestT2Score = score;
            bestT2Pair = [available2[a], available2[b]];
          }
        }
      }

      if (bestT1Pair && bestT2Pair) {
        pairings.push({
          player1_id: bestT1Pair[0].player_id,
          player2_id: bestT2Pair[0].player_id,
          player3_id: bestT1Pair[1].player_id,
          player4_id: bestT2Pair[1].player_id,
        });

        bestT1Pair.forEach(p => {
          const idx = available1.findIndex(ap => ap.player_id === p.player_id);
          if (idx >= 0) available1.splice(idx, 1);
        });
        bestT2Pair.forEach(p => {
          const idx = available2.findIndex(ap => ap.player_id === p.player_id);
          if (idx >= 0) available2.splice(idx, 1);
        });
      }
    }

    // Generate singles matches (Team1 player vs Team2 player)
    for (let i = 0; i < config.singlesCourts && available1.length >= 1 && available2.length >= 1; i++) {
      let bestMatch: { t1: Player, t2: Player, score: number } | null = null;

      for (let a = 0; a < Math.min(available1.length, 4); a++) {
        for (let b = 0; b < Math.min(available2.length, 4); b++) {
          let score = 0;
          const h1 = this.getHistory(available1[a].player_id);
          const h2 = this.getHistory(available2[b].player_id);
          score -= (h1?.timesPlayed || 0) + (h2?.timesPlayed || 0);
          if (this.hasPlayedAgainst(available1[a].player_id, available2[b].player_id)) {
            score -= 300;
          }
          score += Math.random() * 50 - 25;
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { t1: available1[a], t2: available2[b], score };
          }
        }
      }

      if (bestMatch) {
        pairings.push({
          player1_id: bestMatch.t1.player_id,
          player2_id: bestMatch.t2.player_id,
          player3_id: null,
          player4_id: null,
        });

        const idx1 = available1.findIndex(p => p.player_id === bestMatch!.t1.player_id);
        const idx2 = available2.findIndex(p => p.player_id === bestMatch!.t2.player_id);
        if (idx1 >= 0) available1.splice(idx1, 1);
        if (idx2 >= 0) available2.splice(idx2, 1);
      }
    }

    // Remaining players get BYE
    [...available1, ...available2].forEach(p => {
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
