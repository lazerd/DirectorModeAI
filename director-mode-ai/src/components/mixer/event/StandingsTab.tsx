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
      const team1Players = [match.player1_id, match.player3_id].filter(Boolean);
      const team2Players = [match.player2_id, match.player4_id].filter(Boolean);

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

      if (player1Team && player2Team && player1Team !== player2Team) {
        if (match.winner_team === player1Team) player1Wins++;
        if (match.winner_team === player2Team) player2Wins++;
      }
    });

    return { player1Wins, player2Wins };
  };

  const fetchStandings = async () => {
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
          // 1. Win percentage (highest first)
          if (b.win_percentage !== a.win_percentage) return b.win_percentage - a.win_percentage;

          // 2. Game differential (highest first)
          if (b.games_differential !== a.games_differential) return b.games_differential - a.games_differential;

          // 3. Fewest games lost (lowest first)
          if (a.games_lost !== b.games_lost) return a.games_lost - b.games_lost;

          // 4. Head-to-head as final tiebreaker
          const h2h = calculateHeadToHead(a.player_id, b.player_id, matchData || []);
          if (h2h.player1Wins !== h2h.player2Wins) {
            return h2h.player2Wins - h2h.player1Wins;
          }

          // 5. Alphabetical for consistency
          return a.player_name.localeCompare(b.player_name);
        });

      // Calculate display rankings with tie detection
      for (let i = 0; i < formattedStandings.length; i++) {
        if (i === 0) {
          formattedStandings[i].display_rank = "1";
        } else {
          const current = formattedStandings[i];
          const previous = formattedStandings[i - 1];

          const isTied =
            current.win_percentage === previous.win_percentage &&
            current.games_differential === previous.games_differential &&
            current.games_lost === previous.games_lost;

          if (isTied) {
            const h2h = calculateHeadToHead(
              current.player_id,
              previous.player_id,
              matchData || []
            );

            if (h2h.player1Wins === h2h.player2Wins) {
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
          Final Standings
        </CardTitle>
        <CardDescription>Complete rankings for all players</CardDescription>
      </CardHeader>
      <CardContent>
        {standings.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No matches played yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {standings.map((standing, index) => {
              const isFirst = standing.display_rank === "1";
              const isSecond = standing.display_rank === "2";
              const isThird = standing.display_rank === "3";

              return (
                <div
                  key={standing.player_id}
                  className={`flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border-2 transition-all ${
                    isFirst
                      ? "border-blue-400 bg-blue-50"
                      : isSecond
                      ? "border-lime-400 bg-lime-50"
                      : isThird
                      ? "border-orange-300 bg-orange-50"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  {/* Rank */}
                  <div
                    className={`flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg ${
                      isFirst
                        ? "bg-blue-500 text-white"
                        : isSecond
                        ? "bg-lime-500 text-white"
                        : isThird
                        ? "bg-orange-400 text-white"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {standing.display_rank}
                  </div>

                  {/* Player info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-base sm:text-lg truncate">{standing.player_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {standing.wins}W - {standing.losses}L
                    </p>
                  </div>

                  {/* Stats */}
                  <div className="flex-shrink-0 text-right">
                    <p className="font-bold text-lg sm:text-xl text-blue-600">
                      {standing.win_percentage.toFixed(0)}%
                    </p>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {standing.games_won}-{standing.games_lost} games
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StandingsTab;
