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
}

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

export class RoundGenerator {
  private matchHistory: Map<string, MatchHistory> = new Map();
  private teamBattleConfig: TeamBattleConfig | null = null;

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

    if (p3 && this.hasPlayedWith(p1, p3)) score -= 500;
    if (p4 && this.hasPlayedWith(p2, p4)) score -= 500;

    if (this.hasPlayedAgainst(p1, p2)) score -= 300;
    if (p3 && p4 && this.hasPlayedAgainst(p3, p4)) score -= 300;
    if (p3 && p4 && this.hasPlayedAgainst(p1, p4)) score -= 300;
    if (p3 && p4 && this.hasPlayedAgainst(p2, p3)) score -= 300;
    return score;
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

    // Split players by team
    const team1Players = this.players
      .filter(p => p.team_id === config.team1Id)
      .sort((a, b) => {
        const hA = this.getHistory(a.player_id);
        const hB = this.getHistory(b.player_id);
        if (!hA || !hB) return 0;
        if (hA.byeCount !== hB.byeCount) return hB.byeCount - hA.byeCount;
        return hA.timesPlayed - hB.timesPlayed;
      });

    const team2Players = this.players
      .filter(p => p.team_id === config.team2Id)
      .sort((a, b) => {
        const hA = this.getHistory(a.player_id);
        const hB = this.getHistory(b.player_id);
        if (!hA || !hB) return 0;
        if (hA.byeCount !== hB.byeCount) return hB.byeCount - hA.byeCount;
        return hA.timesPlayed - hB.timesPlayed;
      });

    const available1 = [...team1Players];
    const available2 = [...team2Players];

    // Generate doubles matches first (Team1 pair vs Team2 pair)
    for (let i = 0; i < config.doublesCourts && available1.length >= 2 && available2.length >= 2; i++) {
      // Find best Team1 pair
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
          if (score > bestT1Score) {
            bestT1Score = score;
            bestT1Pair = [available1[a], available1[b]];
          }
        }
      }

      // Find best Team2 pair
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
          if (score > bestT2Score) {
            bestT2Score = score;
            bestT2Pair = [available2[a], available2[b]];
          }
        }
      }

      if (bestT1Pair && bestT2Pair) {
        // Team1 = player1 + player3, Team2 = player2 + player4
        pairings.push({
          player1_id: bestT1Pair[0].player_id,
          player2_id: bestT2Pair[0].player_id,
          player3_id: bestT1Pair[1].player_id,
          player4_id: bestT2Pair[1].player_id,
        });

        // Remove used players
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
      // Find best matchup
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

  private generateMaximizeCourtsRound(): Pairing[] {
    const pairings: Pairing[] = [];
    const available = [...this.players].sort((a, b) => {
      const historyA = this.getHistory(a.player_id);
      const historyB = this.getHistory(b.player_id);
      if (!historyA || !historyB) return 0;
      if (historyA.byeCount !== historyB.byeCount) {
        return historyB.byeCount - historyA.byeCount;
      }
      return historyA.timesPlayed - historyB.timesPlayed;
    });

    const totalPlayers = available.length;
    const maxDoublesMatches = Math.floor(totalPlayers / 4);
    const remainingAfterDoubles = totalPlayers - (maxDoublesMatches * 4);
    const maxSinglesMatches = Math.floor(remainingAfterDoubles / 2);
    
    let doublesCount = Math.min(maxDoublesMatches, this.numCourts);
    let singlesCount = Math.min(maxSinglesMatches, this.numCourts - doublesCount);
    
    const playersUsedWithCurrentPlan = (doublesCount * 4) + (singlesCount * 2);
    const courtsUsed = doublesCount + singlesCount;
    
    if (courtsUsed < this.numCourts && available.length > playersUsedWithCurrentPlan) {
      const extraSingles = Math.min(
        this.numCourts - courtsUsed,
        Math.floor((available.length - playersUsedWithCurrentPlan) / 2)
      );
      singlesCount += extraSingles;
    }

    for (let i = 0; i < doublesCount && available.length >= 4; i++) {
      pairings.push({
        player1_id: available[0].player_id,
        player2_id: available[1].player_id,
        player3_id: available[2].player_id,
        player4_id: available[3].player_id,
      });
      available.splice(0, 4);
    }

    for (let i = 0; i < singlesCount && available.length >= 2; i++) {
      pairings.push({
        player1_id: available[0].player_id,
        player2_id: available[1].player_id,
        player3_id: null,
        player4_id: null,
      });
      available.splice(0, 2);
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

  private generateDoublesRound(roundNumber: number): Pairing[] {
    const pairings: Pairing[] = [];
    const available = [...this.players];

    available.sort((a, b) => {
      const historyA = this.getHistory(a.player_id);
      const historyB = this.getHistory(b.player_id);
      if (!historyA || !historyB) return 0;
      
      if (historyA.byeCount !== historyB.byeCount) {
        return historyB.byeCount - historyA.byeCount;
      }
      
      if (historyA.timesPlayed !== historyB.timesPlayed) {
        return historyA.timesPlayed - historyB.timesPlayed;
      }
      
      return (b.wins || 0) - (a.wins || 0);
    });

    while (available.length >= 4 && pairings.length < this.numCourts) {
      let bestMatchup: { players: Player[], score: number } | null = null;

      for (let i = 0; i < Math.min(available.length - 3, 4); i++) {
        for (let j = i + 1; j < Math.min(available.length - 2, 6); j++) {
          for (let k = j + 1; k < Math.min(available.length - 1, 8); k++) {
            for (let l = k + 1; l < Math.min(available.length, 10); l++) {
              const players = [available[i], available[j], available[k], available[l]];
              const score = this.scoreMatchup(
                players[0].player_id,
                players[1].player_id,
                players[2].player_id,
                players[3].player_id
              );

              if (!bestMatchup || score > bestMatchup.score) {
                bestMatchup = { players, score };
              }
            }
          }
        }
      }

      if (bestMatchup) {
        pairings.push({
          player1_id: bestMatchup.players[0].player_id,
          player2_id: bestMatchup.players[1].player_id,
          player3_id: bestMatchup.players[2].player_id,
          player4_id: bestMatchup.players[3].player_id,
        });

        bestMatchup.players.forEach(p => {
          const idx = available.findIndex(ap => ap.player_id === p.player_id);
          if (idx >= 0) available.splice(idx, 1);
        });
      } else {
        break;
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

  private generateSinglesRound(roundNumber: number): Pairing[] {
    const pairings: Pairing[] = [];
    const available = [...this.players];

    available.sort((a, b) => {
      const historyA = this.getHistory(a.player_id);
      const historyB = this.getHistory(b.player_id);
      if (!historyA || !historyB) return 0;
      
      if (historyA.byeCount !== historyB.byeCount) {
        return historyB.byeCount - historyA.byeCount;
      }
      
      return historyA.timesPlayed - historyB.timesPlayed;
    });

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
    const males = this.players.filter(p => p.gender === 'male');
    const females = this.players.filter(p => p.gender === 'female');
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
