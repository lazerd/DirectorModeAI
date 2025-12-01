import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Trophy, Award, TrendingUp, Download, Share2, Loader2 } from "lucide-react";
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

  useEffect(() => {
    fetchSummary();
  }, [eventId]);

  const fetchSummary = async () => {
    // Get event details
    const { data: event } = await supabase
      .from("events")
      .select("event_date")
      .eq("id", eventId)
      .single();

    if (event) {
      setEventDate(event.event_date);
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
          text: `Check out the results from ${eventName}! Created with MixerModeAI.`,
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
    // Find biggest upset (lower ranked player beating higher ranked)
    return standings.length > 0 ? standings[Math.floor(standings.length / 2)] : null;
  };

  const getMostConsistent = () => {
    // Player with best game differential
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
      <Card className="bg-gradient-to-br from-primary/10 to-accent/10 border-2 border-primary/20">
        <CardHeader>
          <CardTitle className="text-3xl flex items-center gap-3">
            <Trophy className="h-8 w-8 text-primary" />
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

      {/* Champion */}
      {topPlayer && (
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