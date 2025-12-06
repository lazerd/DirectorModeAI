// Advanced multi-round match generation with rotation logic

interface Player {
  player_id: string;
  name: string;
  gender?: string;
  wins?: number;
  losses?: number;
  games_won?: number;
  games_lost?: number;
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

export class RoundGenerator {
  private matchHistory: Map<string, MatchHistory> = new Map();

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
    if (this.format === "singles") {
      return this.generateSinglesRound(roundNumber);
    } else if (this.format === "mixed-doubles") {
      return this.generateMixedDoublesRound(roundNumber);
    } else if (this.format === "maximize-courts") {
      return this.generateMaximizeCourtsRound();
    } else {
      return this.generateDoublesRound(roundNumber);
    }
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

    // Calculate optimal court allocation
    const totalPlayers = available.length;
    const maxDoublesMatches = Math.floor(totalPlayers / 4);
    const remainingAfterDoubles = totalPlayers - (maxDoublesMatches * 4);
    const maxSinglesMatches = Math.floor(remainingAfterDoubles / 2);
    
    // Determine how many of each type to maximize court usage
    let doublesCount = Math.min(maxDoublesMatches, this.numCourts);
    let singlesCount = Math.min(maxSinglesMatches, this.numCourts - doublesCount);
    
    // If we can fit more matches by using more singles, do it
    const playersUsedWithCurrentPlan = (doublesCount * 4) + (singlesCount * 2);
    const courtsUsed = doublesCount + singlesCount;
    
    if (courtsUsed < this.numCourts && available.length > playersUsedWithCurrentPlan) {
      // Try to add more singles matches
      const extraSingles = Math.min(
        this.numCourts - courtsUsed,
        Math.floor((available.length - playersUsedWithCurrentPlan) / 2)
      );
      singlesCount += extraSingles;
    }

    // Fill courts with doubles matches first
    for (let i = 0; i < doublesCount && available.length >= 4; i++) {
      pairings.push({
        player1_id: available[0].player_id,
        player2_id: available[1].player_id,
        player3_id: available[2].player_id,
        player4_id: available[3].player_id,
      });
      available.splice(0, 4);
    }

    // Then singles matches
    for (let i = 0; i < singlesCount && available.length >= 2; i++) {
      pairings.push({
        player1_id: available[0].player_id,
        player2_id: available[1].player_id,
        player3_id: null,
        player4_id: null,
      });
      available.splice(0, 2);
    }

    // Only remaining players get BYE (should be 0 or 1)
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

    // Sort: prioritize players with more BYEs (they need to play), then least played
    available.sort((a, b) => {
      const historyA = this.getHistory(a.player_id);
      const historyB = this.getHistory(b.player_id);
      if (!historyA || !historyB) return 0;
      
      // Players with MORE byes should play first
      if (historyA.byeCount !== historyB.byeCount) {
        return historyB.byeCount - historyA.byeCount;
      }
      
      return historyA.timesPlayed - historyB.timesPlayed;
    });

    // Fill ALL available courts with matches
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
        // Fallback: just take first 2
        pairings.push({
          player1_id: available[0].player_id,
          player2_id: available[1].player_id,
          player3_id: null,
          player4_id: null,
        });
        available.splice(0, 2);
      }
    }

    // Only remaining odd player gets BYE
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
