'use client';

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Calendar, Clock, Trophy, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { format } from "date-fns";

interface Event {
  id: string;
  name: string;
  event_date: string;
  start_time: string | null;
  scoring_format: string;
  num_courts: number;
}

interface Standing {
  player_name: string;
  wins: number;
  losses: number;
  games_won: number;
  games_lost: number;
  win_percentage: number;
}

interface Match {
  id: string;
  court_number: number;
  team1_score: number | null;
  team2_score: number | null;
  winner_team: number | null;
  player1_name: string;
  player2_name: string;
  player3_name: string;
  player4_name: string;
}

interface Round {
  id: string;
  round_number: number;
  status: string;
  start_time: string | null;
  matches: Match[];
}

export default function PublicEvent() {
  const params = useParams();
  const eventCode = params.eventCode as string;
  const [event, setEvent] = useState<Event | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEventData();
    
    const channel = supabase
      .channel('public-event-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_players' }, () => {
        fetchStandings();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        fetchRounds();
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [eventCode]);

  const fetchEventData = async () => {
    if (!eventCode) return;

    try {
      const { data: eventData, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("event_code", eventCode.toUpperCase())
        .single();

      if (eventError || !eventData) {
        setError("We couldn't find an event with that code. Check with your organizer.");
        setLoading(false);
        return;
      }

      setEvent(eventData);
      await Promise.all([fetchStandings(), fetchRounds()]);
    } catch (err) {
      setError("An error occurred while loading the event.");
    } finally {
      setLoading(false);
    }
  };

  const fetchStandings = async () => {
    if (!eventCode) return;

    const { data: eventData } = await supabase
      .from("events")
      .select("id")
      .eq("event_code", eventCode.toUpperCase())
      .single();

    if (!eventData) return;

    const { data, error } = await supabase
      .from("event_players")
      .select(`
        wins,
        losses,
        games_won,
        games_lost,
        player_id,
        players!inner(name)
      `)
      .eq("event_id", eventData.id);

    if (!error && data) {
      const formattedStandings: Standing[] = data.map((item: any) => ({
        player_name: item.players.name,
        wins: item.wins || 0,
        losses: item.losses || 0,
        games_won: item.games_won || 0,
        games_lost: item.games_lost || 0,
        win_percentage: item.wins + item.losses > 0 
          ? (item.wins / (item.wins + item.losses)) * 100 
          : 0,
      }));

      formattedStandings.sort((a, b) => b.win_percentage - a.win_percentage);
      setStandings(formattedStandings);
    }
  };

  const fetchRounds = async () => {
    if (!eventCode) return;

    const { data: eventData } = await supabase
      .from("events")
      .select("id")
      .eq("event_code", eventCode.toUpperCase())
      .single();

    if (!eventData) return;

    const { data: roundsData, error } = await supabase
      .from("rounds")
      .select(`
        id,
        round_number,
        status,
        start_time,
        matches (
          id,
          court_number,
          team1_score,
          team2_score,
          winner_team,
          player1:players!matches_player1_id_fkey(name),
          player2:players!matches_player2_id_fkey(name),
          player3:players!matches_player3_id_fkey(name),
          player4:players!matches_player4_id_fkey(name)
        )
      `)
      .eq("event_id", eventData.id)
      .order("round_number", { ascending: true });

    if (!error && roundsData) {
      const formattedRounds = roundsData.map((round: any) => ({
        id: round.id,
        round_number: round.round_number,
        status: round.status,
        start_time: round.start_time,
        matches: round.matches.map((match: any) => ({
          id: match.id,
          court_number: match.court_number,
          team1_score: match.team1_score,
          team2_score: match.team2_score,
          winner_team: match.winner_team,
          player1_name: match.player1?.name || "TBD",
          player2_name: match.player2?.name || "TBD",
          player3_name: match.player3?.name || "TBD",
          player4_name: match.player4?.name || "TBD",
        })),
      }));

      setRounds(formattedRounds);
    }
  };

  const getGamesDiff = (gamesWon: number, gamesLost: number) => {
    const diff = gamesWon - gamesLost;
    if (diff > 0) {
      return (
        <span className="flex items-center gap-1 text-green-600">
          <TrendingUp className="h-4 w-4" />+{diff}
        </span>
      );
    } else if (diff < 0) {
      return (
        <span className="flex items-center gap-1 text-red-600">
          <TrendingDown className="h-4 w-4" />{diff}
        </span>
      );
    }
    return <span className="text-muted-foreground">0</span>;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5">
        <div className="container mx-auto px-4 py-16 max-w-2xl">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Event Not Found</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5">
      <header className="border-b bg-card/80 backdrop-blur">
        <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 mb-3">
            <h1 className="text-lg sm:text-2xl font-bold line-clamp-2">{event.name}</h1>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-3 text-xs sm:text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="truncate">{format(new Date(event.event_date), "MMM d, yyyy")}</span>
            </div>
            {event.start_time && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                <span>{event.start_time}</span>
              </div>
            )}
            <Badge variant="outline" className="text-xs">{event.num_courts} Courts</Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="standings" className="w-full">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 h-12">
            <TabsTrigger value="standings" className="text-sm sm:text-base">Standings</TabsTrigger>
            <TabsTrigger value="rounds" className="text-sm sm:text-base">Courts & Matches</TabsTrigger>
          </TabsList>

          <TabsContent value="standings" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  Current Standings
                </CardTitle>
              </CardHeader>
              <CardContent>
                {standings.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No matches have been played yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Rank</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead className="text-center">W</TableHead>
                          <TableHead className="text-center">L</TableHead>
                          <TableHead className="text-center">Win %</TableHead>
                          <TableHead className="text-center">Games</TableHead>
                          <TableHead className="text-center">+/-</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {standings.map((standing, index) => (
                          <TableRow key={standing.player_name}>
                            <TableCell className="font-medium">
                              {index === 0 ? (
                                <span className="flex items-center gap-1">
                                  🏆 {index + 1}
                                </span>
                              ) : (
                                index + 1
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{standing.player_name}</TableCell>
                            <TableCell className="text-center">{standing.wins}</TableCell>
                            <TableCell className="text-center">{standing.losses}</TableCell>
                            <TableCell className="text-center">
                              {standing.win_percentage.toFixed(0)}%
                            </TableCell>
                            <TableCell className="text-center">
                              {standing.games_won}-{standing.games_lost}
                            </TableCell>
                            <TableCell className="text-center">
                              {getGamesDiff(standing.games_won, standing.games_lost)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rounds" className="mt-6 space-y-6">
            {rounds.length === 0 ? (
              <Card>
                <CardContent className="py-8">
                  <p className="text-center text-muted-foreground">
                    No rounds have been created yet.
                  </p>
                </CardContent>
              </Card>
            ) : (
              rounds.map((round) => (
                <Card key={round.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Round {round.round_number}</CardTitle>
                      <Badge variant={round.status === "completed" ? "secondary" : "default"}>
                        {round.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4">
                      {round.matches.map((match) => (
                        <div key={match.id} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <Badge variant="outline">Court {match.court_number}</Badge>
                            {match.team1_score !== null && match.team2_score !== null && (
                              <div className="text-lg font-bold">
                                {match.team1_score} - {match.team2_score}
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="font-medium mb-1">Team 1</p>
                              <p>{match.player1_name}</p>
                              <p>{match.player2_name}</p>
                            </div>
                            <div>
                              <p className="font-medium mb-1">Team 2</p>
                              <p>{match.player3_name}</p>
                              <p>{match.player4_name}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
