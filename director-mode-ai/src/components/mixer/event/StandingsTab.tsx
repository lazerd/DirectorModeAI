import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Trophy, TrendingUp, TrendingDown } from "lucide-react";

interface Standing {
  player_id: string;
  player_name: string;
  wins: number;
  losses: number;
  games_won: number;
  games_lost: number;
  games_differential: number;
  win_percentage: number;
  display_rank: string;
}

interface StandingsTabProps {
  eventId: string;
}

const StandingsTab = ({ eventId }: StandingsTabProps) => {
  const { toast } = useToast();
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStandings();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('standings-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_players',
          filter: `event_id=eq.${eventId}`
        },
        () => fetchStandings()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  const calculateHeadToHead = (
    playerId1: string,
    playerId2: string,
    matches: any[]
  ): { player1Wins: number; player2Wins: number } => {
    let player1Wins = 0;
    let player2Wins = 0;

    matches.forEach((match) => {
      const team1Players = [match.player1_id, match.player2_id].filter(Boolean);
      const team2Players = [match.player3_id, match.player4_id].filter(Boolean);

      const player1Team = team1Players.includes(playerId1)
        ? 1
        : team2Players.includes(playerId1)
        ? 2
        : null;
      const player2Team = team1Players.includes(playerId2)
        ? 1
        : team2Players.includes(playerId2)
        ? 2
        : null;

      // Only count if they played against each other
      if (player1Team && player2Team && player1Team !== player2Team) {
        if (match.winner_team === player1Team) player1Wins++;
        if (match.winner_team === player2Team) player2Wins++;
      }
    });

    return { player1Wins, player2Wins };
  };

  const fetchStandings = async () => {
    // Fetch player standings
    const { data, error } = await supabase
      .from("event_players")
      .select(`
        player_id,
        wins,
        losses,
        games_won,
        games_lost,
        players (name)
      `)
      .eq("event_id", eventId);

    // Fetch all completed matches for head-to-head calculations
    const { data: matchData } = await supabase
      .from("matches")
      .select(`
        player1_id,
        player2_id,
        player3_id,
        player4_id,
        winner_team,
        rounds!inner (event_id)
      `)
      .eq("rounds.event_id", eventId)
      .not("winner_team", "is", null);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error fetching standings",
        description: error.message,
      });
    } else {
      const formattedStandings = data
        .map((ep: any) => {
          const totalMatches = ep.wins + ep.losses;
          const gamesDiff = ep.games_won - ep.games_lost;
          return {
            player_id: ep.player_id,
            player_name: ep.players.name,
            wins: ep.wins,
            losses: ep.losses,
            games_won: ep.games_won,
            games_lost: ep.games_lost,
            games_differential: gamesDiff,
            win_percentage: totalMatches > 0 ? (ep.wins / totalMatches) * 100 : 0,
            display_rank: "",
          };
        })
        .sort((a, b) => {
          // 1. Sort by wins
          if (b.wins !== a.wins) return b.wins - a.wins;

          // 2. Sort by games differential
          if (b.games_differential !== a.games_differential) {
            return b.games_differential - a.games_differential;
          }

          // 3. Head-to-head tiebreaker
          const h2h = calculateHeadToHead(a.player_id, b.player_id, matchData || []);
          if (h2h.player1Wins !== h2h.player2Wins) {
            return h2h.player2Wins - h2h.player1Wins;
          }

          // 4. If still tied, maintain alphabetical order for consistency
          return a.player_name.localeCompare(b.player_name);
        });

      // Calculate display rankings with tie detection
      for (let i = 0; i < formattedStandings.length; i++) {
        if (i === 0) {
          formattedStandings[i].display_rank = "1";
        } else {
          const current = formattedStandings[i];
          const previous = formattedStandings[i - 1];

          // Check if tied with previous player
          const isTied =
            current.wins === previous.wins &&
            current.games_differential === previous.games_differential;

          if (isTied) {
            // Check head-to-head
            const h2h = calculateHeadToHead(
              current.player_id,
              previous.player_id,
              matchData || []
            );

            // If head-to-head is also tied, show tie indicator
            if (h2h.player1Wins === h2h.player2Wins) {
              // Update previous rank to show tie if it doesn't already
              if (!previous.display_rank.startsWith("T-")) {
                const rank = parseInt(previous.display_rank);
                previous.display_rank = `T-${rank}`;
              }
              current.display_rank = previous.display_rank;
            } else {
              current.display_rank = String(i + 1);
            }
          } else {
            current.display_rank = String(i + 1);
          }
        }
      }

      setStandings(formattedStandings);
    }
    setLoading(false);
  };

  const getGamesDiff = (differential: number) => {
    if (differential > 0) {
      return (
        <span className="text-success flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          +{differential}
        </span>
      );
    } else if (differential < 0) {
      return (
        <span className="text-loss flex items-center gap-1">
          <TrendingDown className="h-3 w-3" />
          {differential}
        </span>
      );
    }
    return <span className="text-muted-foreground">0</span>;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          Standings
        </CardTitle>
        <CardDescription>Current event rankings</CardDescription>
      </CardHeader>
      <CardContent>
        {standings.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No matches played yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-2">
                  <TableHead className="w-12 sm:w-16 text-sm sm:text-base font-bold text-center">#</TableHead>
                  <TableHead className="text-sm sm:text-base font-bold min-w-[120px]">Player</TableHead>
                  <TableHead className="text-center text-sm sm:text-base font-bold w-12 sm:w-16">W</TableHead>
                  <TableHead className="text-center text-sm sm:text-base font-bold w-12 sm:w-16">L</TableHead>
                  <TableHead className="text-center text-sm sm:text-base font-bold w-16 sm:w-20">Win %</TableHead>
                  <TableHead className="hidden sm:table-cell text-center text-sm sm:text-base font-bold">Games</TableHead>
                  <TableHead className="text-center text-sm sm:text-base font-bold w-16 sm:w-20">+/-</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standings.map((standing, index) => (
                  <TableRow key={standing.player_name} className="border-b hover:bg-muted/50">
                    <TableCell className="font-bold text-sm sm:text-base py-3 sm:py-4 text-center">
                      {standing.display_rank === "1" ? (
                        <div className="flex items-center justify-center">
                          <Trophy className="h-5 w-5 sm:h-6 sm:w-6 text-accent" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center">
                          {standing.display_rank}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-sm sm:text-base py-3 sm:py-4 truncate max-w-[150px]">{standing.player_name}</TableCell>
                    <TableCell className="text-center text-success font-bold text-sm sm:text-base py-3 sm:py-4">{standing.wins}</TableCell>
                    <TableCell className="text-center text-muted-foreground text-sm sm:text-base py-3 sm:py-4">{standing.losses}</TableCell>
                    <TableCell className="text-center font-semibold text-sm sm:text-base py-3 sm:py-4">{standing.win_percentage.toFixed(0)}%</TableCell>
                    <TableCell className="hidden sm:table-cell text-center text-sm sm:text-base text-muted-foreground py-3 sm:py-4">
                      {standing.games_won}-{standing.games_lost}
                    </TableCell>
                    <TableCell className="text-center text-sm sm:text-base font-medium py-3 sm:py-4">
                      {getGamesDiff(standing.games_differential)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StandingsTab;
