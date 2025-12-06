import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Trophy, Award, TrendingUp, Download, Share2, Loader2, Swords } from "lucide-react";
import { EventPhotosManager } from "@/components/mixer/event/EventPhotosManager";
import { generateResultsCard } from "@/components/mixer/event/ResultsCardGenerator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Standing {
  player_name: string;
  wins: number;
  losses: number;
  games_won: number;
  games_lost: number;
  win_percentage: number;
}

interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
}

interface EventSummaryProps {
  eventId: string;
  eventName: string;
}

const EventSummary = ({ eventId, eventName }: EventSummaryProps) => {
  const { toast } = useToast();
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalRounds, setTotalRounds] = useState(0);
  const [generatingCard, setGeneratingCard] = useState(false);
  const [shareFormat, setShareFormat] = useState<"instagram" | "facebook">("instagram");
  const [eventDate, setEventDate] = useState("");
  const [isTeamBattle, setIsTeamBattle] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [winningTeam, setWinningTeam] = useState<Team | null>(null);

  useEffect(() => {
    fetchSummary();
  }, [eventId]);

  const fetchSummary = async () => {
    // Get event details
    const { data: event } = await supabase
      .from("events")
      .select("event_date, match_format")
      .eq("id", eventId)
      .single();

    if (event) {
      setEventDate(event.event_date);
      setIsTeamBattle(event.match_format === 'team-battle');
      
      // Fetch team data for team battles
      if (event.match_format === 'team-battle') {
        await fetchTeamResults();
      }
    }

    // Get final standings
    const { data: eventPlayers } = await supabase
      .from("event_players")
      .select(`
        wins,
        losses,
        games_won,
        games_lost,
        players (name)
      `)
      .eq("event_id", eventId);

    // Get total rounds
    const { data: rounds } = await supabase
      .from("rounds")
      .select("id")
      .eq("event_id", eventId);

    if (eventPlayers) {
      const formattedStandings = eventPlayers
        .map((ep: any) => {
          const totalMatches = ep.wins + ep.losses;
          return {
            player_name: ep.players.name,
            wins: ep.wins,
            losses: ep.losses,
            games_won: ep.games_won,
            games_lost: ep.games_lost,
            win_percentage: totalMatches > 0 ? (ep.wins / totalMatches) * 100 : 0,
          };
        })
        .sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.win_percentage !== a.win_percentage) return b.win_percentage - a.win_percentage;
          return b.games_won - a.games_won;
        });

      setStandings(formattedStandings);
    }

    setTotalRounds(rounds?.length || 0);
    setLoading(false);
  };

  const fetchTeamResults = async () => {
    // Fetch teams
    const { data: teamsData } = await supabase
      .from("event_teams")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at");

    if (!teamsData || teamsData.length === 0) return;

    // Fetch rounds
    const { data: rounds } = await supabase
      .from("rounds")
      .select("id")
      .eq("event_id", eventId);

    if (!rounds || rounds.length === 0) {
      setTeams(teamsData.map(t => ({ ...t, score: 0 })));
      return;
    }

    const roundIds = rounds.map(r => r.id);

    // Fetch matches
    const { data: matches } = await supabase
      .from("matches")
      .select("winner_team, player1_id, player2_id")
      .in("round_id", roundIds)
      .not("winner_team", "is", null);

    // Fetch event players with team assignments
    const { data: eventPlayers } = await supabase
      .from("event_players")
      .select("player_id, team_id")
      .eq("event_id", eventId);

    if (!eventPlayers) return;

    // Map players to teams
    const playerTeamMap: Record<string, string> = {};
    eventPlayers.forEach(ep => {
      if (ep.team_id) playerTeamMap[ep.player_id] = ep.team_id;
    });

    // Calculate team scores
    const teamScores: Record<string, number> = {};
    teamsData.forEach(t => teamScores[t.id] = 0);

    if (matches) {
      matches.forEach(match => {
        const winnerPlayerId = match.winner_team === 1 ? match.player1_id : match.player2_id;
        if (winnerPlayerId && playerTeamMap[winnerPlayerId]) {
          const teamId = playerTeamMap[winnerPlayerId];
          teamScores[teamId] = (teamScores[teamId] || 0) + 1;
        }
      });
    }

    const teamsWithScores = teamsData.map(t => ({
      ...t,
      score: teamScores[t.id] || 0
    }));

    setTeams(teamsWithScores);

    // Determine winner
    const sortedTeams = [...teamsWithScores].sort((a, b) => b.score - a.score);
    if (sortedTeams.length >= 2 && sortedTeams[0].score > sortedTeams[1].score) {
      setWinningTeam(sortedTeams[0]);
    } else if (sortedTeams.length >= 2 && sortedTeams[0].score === sortedTeams[1].score) {
      // It's a tie
      setWinningTeam(null);
    }
  };

  const exportResults = () => {
    const csv = [
      ["Rank", "Player", "Wins", "Losses", "Win %", "Games Won", "Games Lost"],
      ...standings.map((s, i) => [
        i + 1,
        s.player_name,
        s.wins,
        s.losses,
        s.win_percentage.toFixed(1) + "%",
        s.games_won,
        s.games_lost,
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${eventName}-results.csv`;
    a.click();

    toast({
      title: "Results exported!",
      description: "CSV file downloaded successfully.",
    });
  };

  const shareResults = async () => {
    setGeneratingCard(true);

    try {
      // Fetch event photos
      const { data: photos } = await supabase
        .from("event_photos")
        .select("photo_url")
        .eq("event_id", eventId)
        .order("display_order");

      // Generate results card
      const cardBlob = await generateResultsCard({
        eventName,
        eventDate,
        totalRounds,
        topThree: standings.slice(0, 3),
        giantSlayer: getBestUpset(),
        mostConsistent: getMostConsistent(),
        photos: photos || [],
        format: shareFormat,
        isTeamBattle,
        teams: teams,
        winningTeam: winningTeam,
      });

      // Create shareable file
      const file = new File([cardBlob], `${eventName}-results.jpg`, {
        type: "image/jpeg",
      });

      // Share via Web Share API (mobile) or download (desktop)
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${eventName} Results`,
          text: `Check out the results from ${eventName}! Run your next pickleball or tennis event at MixerModeAI.com`,
        });

        toast({
          title: "Results shared!",
          description: "Image shared successfully.",
        });
      } else {
        // Fallback: Download the image
        const url = URL.createObjectURL(cardBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${eventName}-results.jpg`;
        a.click();
        URL.revokeObjectURL(url);

        toast({
          title: "Image downloaded!",
          description: "Share the downloaded image on social media.",
        });
      }
    } catch (error) {
      console.error("Share error:", error);
      toast({
        variant: "destructive",
        title: "Could not share",
        description: "Please try again or use Export CSV.",
      });
    } finally {
      setGeneratingCard(false);
    }
  };

  const getBestUpset = () => {
    return standings.length > 0 ? standings[Math.floor(standings.length / 2)] : null;
  };

  const getMostConsistent = () => {
    if (standings.length === 0) return null;
    return standings.reduce((best, current) => {
      const currentDiff = current.games_won - current.games_lost;
      const bestDiff = best.games_won - best.games_lost;
      return currentDiff > bestDiff ? current : best;
    }, standings[0]);
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

  const topPlayer = standings[0];
  const bestUpset = getBestUpset();
  const mostConsistent = getMostConsistent();

  return (
    <div className="space-y-6">
      {/* Event Photos Manager */}
      <EventPhotosManager eventId={eventId} />

      {/* Header */}
      <Card className={`border-2 ${isTeamBattle ? 'bg-gradient-to-br from-blue-50 via-white to-red-50 border-purple-200' : 'bg-gradient-to-br from-primary/10 to-accent/10 border-primary/20'}`}>
        <CardHeader>
          <CardTitle className="text-3xl flex items-center gap-3">
            {isTeamBattle ? (
              <Swords className="h-8 w-8 text-purple-600" />
            ) : (
              <Trophy className="h-8 w-8 text-primary" />
            )}
            Event Complete!
          </CardTitle>
          <CardDescription className="text-lg">
            {eventName} • {totalRounds} rounds played
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-col gap-3">
              <Button onClick={exportResults} size="lg" className="w-full">
                <Download className="h-5 w-5 mr-2" />
                Export CSV
              </Button>
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={shareFormat} onValueChange={(value: "instagram" | "facebook") => setShareFormat(value)}>
                  <SelectTrigger className="w-full sm:w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                  </SelectContent>
                </Select>
                <Button 
                  onClick={shareResults} 
                  variant="outline" 
                  size="lg"
                  disabled={generatingCard}
                  className="w-full sm:flex-1"
                >
                  {generatingCard ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Share2 className="h-5 w-5 mr-2" />
                      Share Results Card
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Team Battle Winner */}
      {isTeamBattle && teams.length === 2 && (
        <Card className="border-4 border-purple-500 bg-gradient-to-br from-blue-50 via-purple-50 to-red-50">
          <CardHeader className="bg-gradient-to-r from-blue-100 via-purple-100 to-red-100">
            <CardTitle className="flex items-center gap-2 text-2xl justify-center">
              <Swords className="h-7 w-7 text-purple-600" />
              Team Battle Results
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {/* Score Display */}
            <div className="flex items-center justify-center gap-6 mb-6">
              <div className="text-center flex-1">
                <div 
                  className="w-6 h-6 rounded-full mx-auto mb-2"
                  style={{ backgroundColor: teams[0].color }}
                />
                <p className="font-bold text-xl">{teams[0].name}</p>
                <p 
                  className="text-5xl font-black"
                  style={{ color: teams[0].color }}
                >
                  {teams[0].score}
                </p>
              </div>
              <div className="text-4xl font-bold text-gray-300">vs</div>
              <div className="text-center flex-1">
                <div 
                  className="w-6 h-6 rounded-full mx-auto mb-2"
                  style={{ backgroundColor: teams[1].color }}
                />
                <p className="font-bold text-xl">{teams[1].name}</p>
                <p 
                  className="text-5xl font-black"
                  style={{ color: teams[1].color }}
                >
                  {teams[1].score}
                </p>
              </div>
            </div>

            {/* Winner Declaration */}
            {winningTeam ? (
              <div 
                className="text-center p-6 rounded-2xl border-4"
                style={{ 
                  backgroundColor: winningTeam.color + '15',
                  borderColor: winningTeam.color 
                }}
              >
                <Trophy className="h-12 w-12 mx-auto mb-3 text-yellow-500" />
                <p className="text-lg font-medium text-gray-600 mb-1">🎉 Winner 🎉</p>
                <p 
                  className="text-4xl font-black"
                  style={{ color: winningTeam.color }}
                >
                  {winningTeam.name}
                </p>
                <p className="text-lg text-gray-500 mt-2">
                  {winningTeam.score} match wins
                </p>
              </div>
            ) : teams[0].score === teams[1].score ? (
              <div className="text-center p-6 rounded-2xl border-4 border-purple-300 bg-purple-50">
                <p className="text-3xl font-black text-purple-600">🤝 It's a TIE! 🤝</p>
                <p className="text-lg text-gray-500 mt-2">
                  Both teams finished with {teams[0].score} wins
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Individual Champion (for non-team battles) */}
      {!isTeamBattle && topPlayer && (
        <Card className="border-2 border-primary">
          <CardHeader className="bg-primary/5">
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Trophy className="h-7 w-7 text-accent" />
              Champion
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <h2 className="text-4xl font-bold text-primary">{topPlayer.player_name}</h2>
              <div className="flex justify-center gap-8 text-lg mt-4">
                <div>
                  <p className="text-3xl font-bold text-success">{topPlayer.wins}</p>
                  <p className="text-sm text-muted-foreground">Wins</p>
                </div>
                <div>
                  <p className="text-3xl font-bold">{topPlayer.win_percentage.toFixed(0)}%</p>
                  <p className="text-sm text-muted-foreground">Win Rate</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-primary">
                    +{topPlayer.games_won - topPlayer.games_lost}
                  </p>
                  <p className="text-sm text-muted-foreground">Game Diff</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Awards */}
      <div className="grid gap-4 md:grid-cols-2">
        {bestUpset && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-accent" />
                Giant Slayer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-semibold">{bestUpset.player_name}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {bestUpset.wins} wins with impressive upsets
              </p>
            </CardContent>
          </Card>
        )}

        {mostConsistent && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-success" />
                Most Consistent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-semibold">{mostConsistent.player_name}</p>
              <p className="text-sm text-muted-foreground mt-1">
                +{mostConsistent.games_won - mostConsistent.games_lost} game differential
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Final Standings */}
      <Card>
        <CardHeader>
          <CardTitle>Final Standings</CardTitle>
          <CardDescription>Complete rankings for all players</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {standings.map((standing, index) => (
              <div
                key={standing.player_name}
                className={`p-4 rounded-xl border-2 flex items-center justify-between ${
                  index === 0
                    ? "bg-primary/5 border-primary"
                    : index === 1
                    ? "bg-accent/5 border-accent"
                    : index === 2
                    ? "bg-muted border-muted"
                    : "border-border"
                }`}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                      index === 0
                        ? "bg-primary text-primary-foreground"
                        : index === 1
                        ? "bg-accent text-accent-foreground"
                        : index === 2
                        ? "bg-muted-foreground text-background"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-semibold text-lg">{standing.player_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {standing.wins}W - {standing.losses}L
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-primary">
                    {standing.win_percentage.toFixed(0)}%
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {standing.games_won}-{standing.games_lost} games
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default EventSummary;
