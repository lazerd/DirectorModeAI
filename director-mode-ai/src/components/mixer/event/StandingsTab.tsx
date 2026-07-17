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

interface TeamInfo {
  id: string;
  name: string;
  color: string;
}

const StandingsTab = ({ eventId }: StandingsTabProps) => {
  const { toast } = useToast();
  const [standings, setStandings] = useState<Standing[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [teamScores, setTeamScores] = useState<Record<string, number>>({});
  const [teamGames, setTeamGames] = useState<Record<string, number>>({});
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
        team_id,
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
        team1_score,
        team2_score,
        winner_team,
        rounds!inner (event_id)
      `)
      .eq("rounds.event_id", eventId)
      .not("winner_team", "is", null);

    // Team Battle score = match wins per team. Map each player to their team,
    // then credit the winning side's team for every completed match.
    const { data: teamData } = await supabase
      .from("event_teams")
      .select("id, name, color")
      .eq("event_id", eventId)
      .order("created_at");
    const playerTeamMap: Record<string, string> = {};
    (data || []).forEach((ep: any) => {
      if (ep.team_id) playerTeamMap[ep.player_id] = ep.team_id;
    });
    const scores: Record<string, number> = {};
    const games: Record<string, number> = {};
    (matchData || []).forEach((m: any) => {
      const winnerPlayerId = m.winner_team === 1 ? m.player1_id : m.player2_id;
      const teamId = winnerPlayerId ? playerTeamMap[winnerPlayerId] : null;
      if (teamId) scores[teamId] = (scores[teamId] || 0) + 1;
      // Total games won by each team (side 1 = player1's team, side 2 = player2's).
      const side1Team = m.player1_id ? playerTeamMap[m.player1_id] : null;
      const side2Team = m.player2_id ? playerTeamMap[m.player2_id] : null;
      if (side1Team) games[side1Team] = (games[side1Team] || 0) + (m.team1_score || 0);
      if (side2Team) games[side2Team] = (games[side2Team] || 0) + (m.team2_score || 0);
    });
    setTeams((teamData as TeamInfo[]) || []);
    setTeamScores(scores);
    setTeamGames(games);

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

  const isTeamBattle = teams.length === 2;
  // Winner = more match wins; if tied, more games won breaks it.
  const teamLeader = (() => {
    if (!isTeamBattle) return null;
    const [a, b] = teams;
    const wa = teamScores[a.id] || 0, wb = teamScores[b.id] || 0;
    if (wa !== wb) return wa > wb ? a.id : b.id;
    const ga = teamGames[a.id] || 0, gb = teamGames[b.id] || 0;
    if (ga !== gb) return ga > gb ? a.id : b.id;
    return null;
  })();
  const teamsTiedOnWins =
    isTeamBattle && (teamScores[teams[0].id] || 0) === (teamScores[teams[1].id] || 0);

  return (
    <div className="space-y-4">
      {isTeamBattle && (
        <Card style={{ background: '#ffffff' }}>
          <CardContent className="py-5">
            <div className="flex items-center justify-center gap-6 sm:gap-10">
              {teams.map((team, idx) => (
                <div key={team.id} className="contents">
                  {idx === 1 && (
                    <div className="text-center flex-shrink-0">
                      <Trophy className="h-7 w-7 text-yellow-500 mx-auto" />
                      <p className="text-xs mt-1" style={{ color: '#6b7280' }}>Match Wins</p>
                    </div>
                  )}
                  <div className="text-center">
                    <div className="w-4 h-4 rounded-full mx-auto mb-2" style={{ backgroundColor: team.color }} />
                    <p className="font-bold text-base sm:text-lg" style={{ color: '#111827' }}>
                      {team.name}
                      {teamLeader === team.id && ' 🏆'}
                    </p>
                    <p className="text-4xl sm:text-5xl font-black leading-none" style={{ color: team.color }}>
                      {teamScores[team.id] || 0}
                    </p>
                    <p
                      className={`text-sm mt-1 ${teamsTiedOnWins ? 'font-bold' : ''}`}
                      style={{ color: teamsTiedOnWins ? team.color : '#6b7280' }}
                      title="Total games won — breaks a tie on match wins"
                    >
                      {teamGames[team.id] || 0} games
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card style={{ background: '#ffffff', color: '#000000' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: '#000000' }}>
          <Trophy className="h-5 w-5 text-primary" />
          {isTeamBattle ? 'Individual Standings' : 'Final Standings'}
        </CardTitle>
        <CardDescription style={{ color: '#374151' }}>Complete rankings for all players</CardDescription>
      </CardHeader>
      <CardContent>
        {standings.length === 0 ? (
          <div className="text-center py-12" style={{ color: '#6b7280' }}>
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
                      ? "border-blue-400"
                      : isSecond
                      ? "border-lime-400"
                      : isThird
                      ? "border-orange-300"
                      : "border-gray-200"
                  }`}
                  style={{
                    background: isFirst ? '#eff6ff' : isSecond ? '#f7fee7' : isThird ? '#fff7ed' : '#ffffff',
                    color: '#000000',
                  }}
                >
                  {/* Rank */}
                  <div
                    className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg"
                    style={{
                      background: isFirst ? '#3b82f6' : isSecond ? '#84cc16' : isThird ? '#fb923c' : '#f3f4f6',
                      color: (isFirst || isSecond || isThird) ? '#ffffff' : '#374151',
                    }}
                  >
                    {standing.display_rank}
                  </div>

                  {/* Player info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-base sm:text-lg truncate" style={{ color: '#000000' }}>{standing.player_name}</p>
                    <p className="text-sm" style={{ color: '#4b5563' }}>
                      {standing.wins}W - {standing.losses}L
                    </p>
                  </div>

                  {/* Stats */}
                  <div className="flex-shrink-0 text-right">
                    <p className="font-bold text-lg sm:text-xl" style={{ color: '#2563eb' }}>
                      {standing.win_percentage.toFixed(0)}%
                    </p>
                    <p className="text-xs sm:text-sm" style={{ color: '#4b5563' }}>
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
    </div>
  );
};

export default StandingsTab;
