// Tournament bracket generation with flexible player counts

export interface BracketMatch {
  matchNumber: number;
  round: number;
  position: number;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  feedsIntoMatchNumber: number | null;
  isBye: boolean;
  courtNumber: number | null;
}

export interface TournamentStructure {
  totalRounds: number;
  matchesPerRound: number[];
  totalMatches: number;
  bracketMatches: BracketMatch[];
}

/**
 * Calculate the next power of 2 greater than or equal to n
 */
function nextPowerOf2(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

/**
 * Generate tournament bracket structure for any number of players
 * Uses strength order for seeding with byes in first round if needed
 */
export function generateTournamentBracket(
  players: Array<{ player_id: string; name: string }>,
  matchFormat: 'singles' | 'doubles' | 'mixed-doubles'
): TournamentStructure {
  const isDoubles = matchFormat === 'doubles' || matchFormat === 'mixed-doubles';
  const numPlayers = players.length;
  
  // For doubles, we need pairs
  if (isDoubles && numPlayers % 2 !== 0) {
    throw new Error('Doubles tournaments require an even number of players');
  }

  const numTeams = isDoubles ? numPlayers / 2 : numPlayers;
  const bracketSize = nextPowerOf2(numTeams);
  const numByes = bracketSize - numTeams;
  const totalRounds = Math.log2(bracketSize);
  
  const bracketMatches: BracketMatch[] = [];
  let matchCounter = 1;

  // Calculate matches per round (working backwards from finals)
  const matchesPerRound: number[] = [];
  for (let round = 1; round <= totalRounds; round++) {
    matchesPerRound.push(Math.pow(2, totalRounds - round));
  }

  // Round 1: Create initial matches with byes
  const round1Matches = matchesPerRound[0];
  const teamsInRound1 = numTeams; // All teams play or get a bye
  
  // Distribute byes strategically (top and bottom of bracket)
  const byePositions = new Set<number>();
  if (numByes > 0) {
    // Place byes at regular intervals to balance bracket
    const interval = Math.floor(round1Matches / numByes);
    for (let i = 0; i < numByes; i++) {
      const position = i * interval + (i % 2 === 0 ? 0 : round1Matches - 1 - Math.floor(i / 2));
      byePositions.add(Math.min(position, round1Matches - 1));
    }
  }

  let playerIndex = 0;
  
  let courtNumber = 1;
  
  for (let pos = 0; pos < round1Matches; pos++) {
    const isBye = byePositions.has(pos);
    const feedsIntoMatchNumber = round1Matches + Math.floor(pos / 2) + 1;
    
    if (isBye) {
      // Bye match - only one player/team
      if (isDoubles) {
        bracketMatches.push({
          matchNumber: matchCounter++,
          round: 1,
          position: pos,
          player1_id: players[playerIndex]?.player_id || null,
          player2_id: players[playerIndex + 1]?.player_id || null,
          player3_id: null,
          player4_id: null,
          feedsIntoMatchNumber,
          isBye: true,
          courtNumber: null, // BYE matches don't need courts
        });
        playerIndex += 2;
      } else {
        bracketMatches.push({
          matchNumber: matchCounter++,
          round: 1,
          position: pos,
          player1_id: players[playerIndex]?.player_id || null,
          player2_id: null,
          player3_id: null,
          player4_id: null,
          feedsIntoMatchNumber,
          isBye: true,
          courtNumber: null, // BYE matches don't need courts
        });
        playerIndex += 1;
      }
    } else {
      // Regular match
      if (isDoubles) {
        bracketMatches.push({
          matchNumber: matchCounter++,
          round: 1,
          position: pos,
          player1_id: players[playerIndex]?.player_id || null,
          player2_id: players[playerIndex + 1]?.player_id || null,
          player3_id: players[playerIndex + 2]?.player_id || null,
          player4_id: players[playerIndex + 3]?.player_id || null,
          feedsIntoMatchNumber,
          isBye: false,
          courtNumber: courtNumber++,
        });
        playerIndex += 4;
      } else {
        bracketMatches.push({
          matchNumber: matchCounter++,
          round: 1,
          position: pos,
          player1_id: players[playerIndex]?.player_id || null,
          player2_id: players[playerIndex + 1]?.player_id || null,
          player3_id: null,
          player4_id: null,
          feedsIntoMatchNumber,
          isBye: false,
          courtNumber: courtNumber++,
        });
        playerIndex += 2;
      }
    }
  }

  // Subsequent rounds: Create placeholder matches
  for (let round = 2; round <= totalRounds; round++) {
    const matchesInRound = matchesPerRound[round - 1];
    
    for (let pos = 0; pos < matchesInRound; pos++) {
      const feedsIntoMatchNumber = round < totalRounds 
        ? matchCounter + matchesInRound - pos - 1 + Math.floor(pos / 2) 
        : null;
      
      bracketMatches.push({
        matchNumber: matchCounter++,
        round: round,
        position: pos,
        player1_id: null,
        player2_id: null,
        player3_id: null,
        player4_id: null,
        feedsIntoMatchNumber,
        isBye: false,
        courtNumber: null, // Later rounds need manual court assignment
      });
    }
  }

  return {
    totalRounds,
    matchesPerRound,
    totalMatches: bracketMatches.length,
    bracketMatches,
  };
}

/**
 * Advance winner to next match
 */
export function advanceWinner(
  bracket: BracketMatch[],
  completedMatchNumber: number,
  winnerPlayerIds: { player1_id: string | null; player2_id: string | null },
  isDoubles: boolean
): BracketMatch | null {
  const completedMatch = bracket.find(m => m.matchNumber === completedMatchNumber);
  if (!completedMatch || !completedMatch.feedsIntoMatchNumber) return null;

  const nextMatch = bracket.find(m => m.matchNumber === completedMatch.feedsIntoMatchNumber);
  if (!nextMatch) return null;

  // Determine which slot the winner goes into (top or bottom of next match)
  const isTopSeed = completedMatch.position % 2 === 0;
  
  if (isDoubles) {
    if (isTopSeed) {
      nextMatch.player1_id = winnerPlayerIds.player1_id;
      nextMatch.player2_id = winnerPlayerIds.player2_id;
    } else {
      nextMatch.player3_id = winnerPlayerIds.player1_id;
      nextMatch.player4_id = winnerPlayerIds.player2_id;
    }
  } else {
    // Singles: player1 vs player2
    if (isTopSeed) {
      nextMatch.player1_id = winnerPlayerIds.player1_id;
    } else {
      nextMatch.player2_id = winnerPlayerIds.player1_id;
    }
  }

  return nextMatch;
}
