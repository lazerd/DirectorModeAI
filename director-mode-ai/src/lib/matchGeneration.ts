// Match generation algorithms for different formats

interface Player {
  player_id: string;
  name: string;
  gender?: string;
  wins?: number;
  losses?: number;
  games_won?: number;
  games_lost?: number;
}

export interface Pairing {
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
}

export const generateDoublesMatches = (
  players: Player[],
  numCourts: number,
  roundNumber: number
): Pairing[] => {
  const pairings: Pairing[] = [];
  
  if (roundNumber === 1) {
    // First round: snake draft by strength
    for (let i = 0; i < numCourts; i++) {
      const idx = i * 4;
      if (idx + 3 < players.length) {
        pairings.push({
          player1_id: players[idx].player_id,
          player2_id: players[idx + 1].player_id,
          player3_id: players[idx + 2].player_id,
          player4_id: players[idx + 3].player_id,
        });
      } else if (idx + 1 < players.length) {
        pairings.push({
          player1_id: players[idx].player_id,
          player2_id: players[idx + 1].player_id,
          player3_id: null,
          player4_id: null,
        });
      }
    }
  } else {
    // Swiss pairing: group similar records
    const sorted = [...players].sort((a, b) => {
      const winsA = a.wins || 0;
      const winsB = b.wins || 0;
      if (winsA !== winsB) return winsB - winsA;
      return (b.games_won || 0) - (a.games_won || 0);
    });

    for (let i = 0; i < numCourts && i * 4 < sorted.length; i++) {
      const idx = i * 4;
      if (idx + 3 < sorted.length) {
        pairings.push({
          player1_id: sorted[idx].player_id,
          player2_id: sorted[idx + 1].player_id,
          player3_id: sorted[idx + 2].player_id,
          player4_id: sorted[idx + 3].player_id,
        });
      } else if (idx + 1 < sorted.length) {
        pairings.push({
          player1_id: sorted[idx].player_id,
          player2_id: sorted[idx + 1].player_id,
          player3_id: null,
          player4_id: null,
        });
      }
    }
  }

  return pairings;
};

export const generateSinglesMatches = (
  players: Player[],
  numCourts: number,
  roundNumber: number
): Pairing[] => {
  const pairings: Pairing[] = [];
  
  if (roundNumber === 1) {
    // First round: pair by strength (1 vs 2, 3 vs 4, etc.)
    for (let i = 0; i < numCourts && i * 2 + 1 < players.length; i++) {
      pairings.push({
        player1_id: players[i * 2].player_id,
        player2_id: players[i * 2 + 1].player_id,
        player3_id: null,
        player4_id: null,
      });
    }
  } else {
    // Swiss pairing
    const sorted = [...players].sort((a, b) => {
      const winsA = a.wins || 0;
      const winsB = b.wins || 0;
      if (winsA !== winsB) return winsB - winsA;
      return (b.games_won || 0) - (a.games_won || 0);
    });

    for (let i = 0; i < numCourts && i * 2 + 1 < sorted.length; i++) {
      pairings.push({
        player1_id: sorted[i * 2].player_id,
        player2_id: sorted[i * 2 + 1].player_id,
        player3_id: null,
        player4_id: null,
      });
    }
  }

  return pairings;
};

export const generateMixedDoublesMatches = (
  players: Player[],
  numCourts: number,
  roundNumber: number
): Pairing[] => {
  const males = players.filter(p => p.gender === 'male');
  const females = players.filter(p => p.gender === 'female');
  const pairings: Pairing[] = [];

  if (roundNumber === 1) {
    // First round: pair by strength order, ensuring male-female on each team
    const numMatches = Math.min(numCourts, Math.floor(males.length / 2), Math.floor(females.length / 2));
    
    for (let i = 0; i < numMatches; i++) {
      pairings.push({
        player1_id: males[i * 2].player_id,        // Male on Team 1
        player2_id: females[i * 2].player_id,      // Female on Team 1
        player3_id: males[i * 2 + 1].player_id,    // Male on Team 2
        player4_id: females[i * 2 + 1].player_id,  // Female on Team 2
      });
    }
  } else {
    // Subsequent rounds: Swiss pairing while maintaining male-female requirement
    const sortedMales = [...males].sort((a, b) => {
      const winsA = a.wins || 0;
      const winsB = b.wins || 0;
      if (winsA !== winsB) return winsB - winsA;
      return (b.games_won || 0) - (a.games_won || 0);
    });
    
    const sortedFemales = [...females].sort((a, b) => {
      const winsA = a.wins || 0;
      const winsB = b.wins || 0;
      if (winsA !== winsB) return winsB - winsA;
      return (b.games_won || 0) - (a.games_won || 0);
    });

    const numMatches = Math.min(numCourts, Math.floor(sortedMales.length / 2), Math.floor(sortedFemales.length / 2));
    
    for (let i = 0; i < numMatches; i++) {
      pairings.push({
        player1_id: sortedMales[i * 2].player_id,        // Male on Team 1
        player2_id: sortedFemales[i * 2].player_id,      // Female on Team 1
        player3_id: sortedMales[i * 2 + 1].player_id,    // Male on Team 2
        player4_id: sortedFemales[i * 2 + 1].player_id,  // Female on Team 2
      });
    }
  }

  return pairings;
};

export const generateKingOfCourtMatches = (
  players: Player[],
  numCourts: number
): Pairing[] => {
  // King of court: initial seeding, then winners stay
  const pairings: Pairing[] = [];
  
  for (let i = 0; i < numCourts && i * 4 < players.length; i++) {
    const idx = i * 4;
    pairings.push({
      player1_id: players[idx]?.player_id || null,
      player2_id: players[idx + 1]?.player_id || null,
      player3_id: players[idx + 2]?.player_id || null,
      player4_id: players[idx + 3]?.player_id || null,
    });
  }

  return pairings;
};

export const generateRoundRobinMatches = (
  players: Player[],
  numCourts: number,
  roundNumber: number
): Pairing[] => {
  // Team round robin: Fixed partner pairs that stay together all rounds
  // Partners are determined by order: players[0] & players[1] are partners, players[2] & players[3] are partners, etc.
  const pairings: Pairing[] = [];
  const n = players.length;
  
  // Create fixed teams (partners stay together entire event)
  // Team 1: players 0 & 1, Team 2: players 2 & 3, Team 3: players 4 & 5, etc.
  const teams: Player[][] = [];
  for (let i = 0; i < Math.floor(n / 2); i++) {
    teams.push([players[i * 2], players[i * 2 + 1]]);
  }

  // Rotate matchups for round robin (teams play different opponents each round)
  const numTeams = teams.length;
  for (let i = 0; i < numCourts && i * 2 + 1 < numTeams; i++) {
    const teamA = teams[(i * 2 + roundNumber - 1) % numTeams];
    const teamB = teams[(i * 2 + 1 + roundNumber - 1) % numTeams];
    
    pairings.push({
      player1_id: teamA[0]?.player_id || null,
      player2_id: teamA[1]?.player_id || null,
      player3_id: teamB[0]?.player_id || null,
      player4_id: teamB[1]?.player_id || null,
    });
  }

  return pairings;
};

const generateMaximizeCourtMatches = (players: Player[], numCourts: number): Pairing[] => {
  const pairings: Pairing[] = [];
  const available = [...players];

  // Fill with doubles first
  while (available.length >= 4 && pairings.length < numCourts) {
    pairings.push({
      player1_id: available[0].player_id,
      player2_id: available[1].player_id,
      player3_id: available[2].player_id,
      player4_id: available[3].player_id,
    });
    available.splice(0, 4);
  }

  // Then fill with singles if possible
  while (available.length >= 2 && pairings.length < numCourts) {
    pairings.push({
      player1_id: available[0].player_id,
      player2_id: available[1].player_id,
      player3_id: null,
      player4_id: null,
    });
    available.splice(0, 2);
  }

  // If one player left, add BY marker
  if (available.length === 1 && pairings.length < numCourts) {
    pairings.push({
      player1_id: available[0].player_id,
      player2_id: null,
      player3_id: null,
      player4_id: null,
    });
  }

  return pairings;
};

export const generateMatchesByFormat = (
  format: string,
  players: Player[],
  numCourts: number,
  roundNumber: number
): Pairing[] => {
  switch (format) {
    case "singles":
      return generateSinglesMatches(players, numCourts, roundNumber);
    case "mixed-doubles":
      return generateMixedDoublesMatches(players, numCourts, roundNumber);
    case "king-of-court":
      return generateKingOfCourtMatches(players, numCourts);
    case "round-robin":
      return generateRoundRobinMatches(players, numCourts, roundNumber);
    case "maximize-courts":
      return generateMaximizeCourtMatches(players, numCourts);
    case "fast-four":
      return generateDoublesMatches(players, numCourts, roundNumber);
    case "doubles":
    default:
      return generateDoublesMatches(players, numCourts, roundNumber);
  }
};