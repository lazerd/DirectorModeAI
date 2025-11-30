Here's the content - copy everything below:

```typescript
interface Player {
  id: string;
  name: string;
  gender?: string;
}

interface EventPlayer {
  player_id: string;
  strength_order: number;
  wins: number;
  losses: number;
  games_won: number;
  games_lost: number;
  player: Player;
}

interface Match {
  court_number: number;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
}

export function generateDoublesMatches(
  players: EventPlayer[],
  numCourts: number,
  previousMatches: any[] = []
): Match[] {
  const matches: Match[] = [];
  const availablePlayers = [...players].sort((a, b) => {
    const aWins = a.wins || 0;
    const bWins = b.wins || 0;
    if (bWins !== aWins) return bWins - aWins;
    
    const aDiff = (a.games_won || 0) - (a.games_lost || 0);
    const bDiff = (b.games_won || 0) - (b.games_lost || 0);
    return bDiff - aDiff;
  });

  for (let court = 1; court <= numCourts && availablePlayers.length >= 4; court++) {
    const match: Match = {
      court_number: court,
      player1_id: availablePlayers.shift()?.player_id || null,
      player2_id: availablePlayers.pop()?.player_id || null,
      player3_id: availablePlayers.shift()?.player_id || null,
      player4_id: availablePlayers.pop()?.player_id || null,
    };
    matches.push(match);
  }

  return matches;
}

export function generateSinglesMatches(
  players: EventPlayer[],
  numCourts: number,
  previousMatches: any[] = []
): Match[] {
  const matches: Match[] = [];
  const availablePlayers = [...players].sort((a, b) => {
    const aWins = a.wins || 0;
    const bWins = b.wins || 0;
    return bWins - aWins;
  });

  for (let court = 1; court <= numCourts && availablePlayers.length >= 2; court++) {
    const match: Match = {
      court_number: court,
      player1_id: availablePlayers.shift()?.player_id || null,
      player2_id: availablePlayers.shift()?.player_id || null,
      player3_id: null,
      player4_id: null,
    };
    matches.push(match);
  }

  return matches;
}

export function generateMixedDoublesMatches(
  players: EventPlayer[],
  numCourts: number,
  previousMatches: any[] = []
): Match[] {
  const males = players.filter(p => p.player?.gender === 'male');
  const females = players.filter(p => p.player?.gender === 'female');
  const matches: Match[] = [];

  for (let court = 1; court <= numCourts && males.length >= 2 && females.length >= 2; court++) {
    const match: Match = {
      court_number: court,
      player1_id: males.shift()?.player_id || null,
      player2_id: females.shift()?.player_id || null,
      player3_id: males.shift()?.player_id || null,
      player4_id: females.shift()?.player_id || null,
    };
    matches.push(match);
  }

  return matches;
}

export function generateKingOfCourtMatches(
  players: EventPlayer[],
  numCourts: number,
  previousMatches: any[] = []
): Match[] {
  return generateDoublesMatches(players, numCourts, previousMatches);
}

export function generateRoundRobinMatches(
  players: EventPlayer[],
  numCourts: number,
  roundNumber: number
): Match[] {
  return generateDoublesMatches(players, numCourts, []);
}

export function generateMaximizeCourtsMatches(
  players: EventPlayer[],
  numCourts: number,
  previousMatches: any[] = []
): Match[] {
  const matches: Match[] = [];
  const availablePlayers = [...players];

  for (let court = 1; court <= numCourts && availablePlayers.length >= 2; court++) {
    if (availablePlayers.length >= 4) {
      matches.push({
        court_number: court,
        player1_id: availablePlayers.shift()?.player_id || null,
        player2_id: availablePlayers.shift()?.player_id || null,
        player3_id: availablePlayers.shift()?.player_id || null,
        player4_id: availablePlayers.shift()?.player_id || null,
      });
    } else if (availablePlayers.length >= 2) {
      matches.push({
        court_number: court,
        player1_id: availablePlayers.shift()?.player_id || null,
        player2_id: availablePlayers.shift()?.player_id || null,
        player3_id: null,
        player4_id: null,
      });
    }
  }

  return matches;
}

export function generateMatches(
  format: string,
  players: EventPlayer[],
  numCourts: number,
  previousMatches: any[] = [],
  roundNumber: number = 1
): Match[] {
  switch (format) {
    case 'singles':
      return generateSinglesMatches(players, numCourts, previousMatches);
    case 'mixed-doubles':
      return generateMixedDoublesMatches(players, numCourts, previousMatches);
    case 'king-of-court':
      return generateKingOfCourtMatches(players, numCourts, previousMatches);
    case 'round-robin':
      return generateRoundRobinMatches(players, numCourts, roundNumber);
    case 'maximize-courts':
      return generateMaximizeCourtsMatches(players, numCourts, previousMatches);
    case 'doubles':
    default:
      return generateDoublesMatches(players, numCourts, previousMatches);
  }
}
```

Paste that into the new file, then click **Commit changes**.
