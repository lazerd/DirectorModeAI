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
import PublicRoundTimer from "@/components/mixer/event/PublicRoundTimer";
import PublicScoreDialog from "@/components/mixer/event/PublicScoreDialog";

interface Event {
  id: string;
  name: string;
  event_date: string;
  start_time: string | null;
  scoring_format: string;
  num_courts: number;
  round_length_minutes: number | null;
}

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

interface Match {
  id: string;
  court_number: number;
  team1_score: number | null;
  team2_score: number | null;
  winner_team: number | null;
  player1_name: string | null;
  player2_name: string | null;
  player3_name: string | null;
  player4_name: string | null;
}

interface Round {
  id: string;
  round_number: number;
  status: string;
  start_time: string | null;
  timer_paused_at: string | null;
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
  const [scoreEntryMatch, setScoreEntryMatch] = useState<{ id: string; court_number: number; team1_score: number | null; team2_score: number | null; player1_name: string | null; player2_name: string | null; player3_name: string | null; player4_name: string | null } | null>(null);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, () => {
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

    const { data: matchData } = await supabase
      .from("matches")
      .select(`player1_id, player2_id, player3_id, player4_id, winner_team, rounds!inner(event_id)`)
      .eq("rounds.event_id", eventData.id)
      .not("winner_team", "is", null);

    // Head-to-head between two players: in our schema, Team 1 = (p1, p3) and Team 2 = (p2, p4).
    const headToHead = (a: string, b: string) => {
      let aWins = 0, bWins = 0;
      for (const m of matchData || []) {
        const team1 = [m.player1_id, m.player3_id].filter(Boolean);
        const team2 = [m.player2_id, m.player4_id].filter(Boolean);
        const aTeam = team1.includes(a) ? 1 : team2.includes(a) ? 2 : null;
        const bTeam = team1.includes(b) ? 1 : team2.includes(b) ? 2 : null;
        if (aTeam && bTeam && aTeam !== bTeam) {
          if (m.winner_team === aTeam) aWins++;
          if (m.winner_team === bTeam) bWins++;
        }
      }
      return { aWins, bWins };
    };

    if (!error && data) {
      const formattedStandings: Standing[] = data.map((item: any) => {
        const totalMatches = (item.wins ?? 0) + (item.losses ?? 0);
        const gw = item.games_won ?? 0;
        const gl = item.games_lost ?? 0;
        return {
          player_id: item.player_id,
          player_name: item.players.name,
          wins: item.wins ?? 0,
          losses: item.losses ?? 0,
          games_won: gw,
          games_lost: gl,
          games_differential: gw - gl,
          win_percentage: totalMatches > 0 ? (item.wins / totalMatches) * 100 : 0,
          display_rank: "",
        };
      });

      formattedStandings.sort((a, b) => {
        if (b.win_percentage !== a.win_percentage) return b.win_percentage - a.win_percentage;
        if (b.games_differential !== a.games_differential) return b.games_differential - a.games_differential;
        if (a.games_lost !== b.games_lost) return a.games_lost - b.games_lost;
        const h2h = headToHead(a.player_id, b.player_id);
        if (h2h.aWins !== h2h.bWins) return h2h.bWins - h2h.aWins;
        return a.player_name.localeCompare(b.player_name);
      });

      // Display ranks with T- prefix on ties
      for (let i = 0; i < formattedStandings.length; i++) {
        if (i === 0) {
          formattedStandings[i].display_rank = "1";
          continue;
        }
        const cur = formattedStandings[i];
        const prev = formattedStandings[i - 1];
        const tiedOnAllVisible = cur.win_percentage === prev.win_percentage
          && cur.games_differential === prev.games_differential
          && cur.games_lost === prev.games_lost;
        const h2h = tiedOnAllVisible ? headToHead(cur.player_id, prev.player_id) : { aWins: 0, bWins: 0 };
        if (tiedOnAllVisible && h2h.aWins === h2h.bWins) {
          if (!prev.display_rank.startsWith("T-")) {
            const r = parseInt(prev.display_rank);
            prev.display_rank = `T-${r}`;
          }
          cur.display_rank = prev.display_rank;
        } else {
          cur.display_rank = String(i + 1);
        }
      }

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
        timer_paused_at,
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
        timer_paused_at: round.timer_paused_at ?? null,
        matches: round.matches.map((match: any) => ({
          id: match.id,
          court_number: match.court_number,
          team1_score: match.team1_score,
          team2_score: match.team2_score,
          winner_team: match.winner_team,
          player1_name: match.player1?.name || null,
          player2_name: match.player2?.name || null,
          player3_name: match.player3?.name || null,
          player4_name: match.player4?.name || null,
        })),
      }));

      setRounds(formattedRounds);
    }
  };

  const getGamesDiff = (gamesWon: number, gamesLost: number) => {
    const diff = gamesWon - gamesLost;
    if (diff > 0) {
      return (
        <span className="inline-flex items-center justify-center gap-1" style={{ color: '#16a34a' }}>
          <TrendingUp className="h-4 w-4" />+{diff}
        </span>
      );
    } else if (diff < 0) {
      return (
        <span className="inline-flex items-center justify-center gap-1" style={{ color: '#dc2626' }}>
          <TrendingDown className="h-4 w-4" />{diff}
        </span>
      );
    }
    return <span style={{ color: '#6b7280' }}>0</span>;
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
        <Tabs defaultValue="rounds" className="w-full">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 h-12">
            <TabsTrigger value="standings" className="text-sm sm:text-base">Standings</TabsTrigger>
            <TabsTrigger value="rounds" className="text-sm sm:text-base">Courts & Matches</TabsTrigger>
          </TabsList>

          <TabsContent value="standings" className="mt-6">
            <Card style={{ background: '#ffffff', color: '#111827' }}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2" style={{ color: '#000000' }}>
                  <Trophy className="h-5 w-5" />
                  Current Standings
                </CardTitle>
              </CardHeader>
              <CardContent style={{ color: '#000000' }}>
                {standings.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No matches have been played yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto" style={{ color: '#000000' }}>
                    <table className="w-full border-collapse" style={{ color: '#000000' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                          <th className="text-left p-3 font-bold" style={{ color: '#000000' }}>Rank</th>
                          <th className="text-left p-3 font-bold" style={{ color: '#000000' }}>Player</th>
                          <th className="text-center p-3 font-bold" style={{ color: '#000000' }}>W</th>
                          <th className="text-center p-3 font-bold" style={{ color: '#000000' }}>L</th>
                          <th className="text-center p-3 font-bold" style={{ color: '#000000' }}>Win %</th>
                          <th className="text-center p-3 font-bold" style={{ color: '#000000' }}>Games</th>
                          <th className="text-center p-3 font-bold" style={{ color: '#000000' }}>+/-</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((standing, index) => (
                          <tr key={standing.player_id} style={{ borderBottom: '1px solid #f3f4f6', color: '#111827' }}>
                            <td className="p-3 font-bold" style={{ color: '#000000' }}>
                              {index === 0 && standing.display_rank === "1" ? (
                                <span className="flex items-center gap-1">🏆 1</span>
                              ) : (
                                standing.display_rank
                              )}
                            </td>
                            <td className="p-3 font-semibold" style={{ color: '#000000' }}>{standing.player_name}</td>
                            <td className="text-center p-3" style={{ color: '#000000' }}>{standing.wins}</td>
                            <td className="text-center p-3" style={{ color: '#000000' }}>{standing.losses}</td>
                            <td className="text-center p-3" style={{ color: '#000000' }}>{standing.win_percentage.toFixed(0)}%</td>
                            <td className="text-center p-3" style={{ color: '#000000' }}>{standing.games_won}-{standing.games_lost}</td>
                            <td className="text-center p-3" style={{ color: '#000000' }}>{getGamesDiff(standing.games_won, standing.games_lost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rounds" className="mt-6 space-y-6">
            {(() => {
              const activeTimedRound = rounds.find(
                (r) => r.status === "in_progress" && r.start_time
              );
              if (
                activeTimedRound &&
                activeTimedRound.start_time &&
                event?.scoring_format === "timed" &&
                event?.round_length_minutes
              ) {
                return (
                  <PublicRoundTimer
                    startTime={activeTimedRound.start_time}
                    pausedAt={activeTimedRound.timer_paused_at}
                    durationMinutes={event.round_length_minutes}
                    roundNumber={activeTimedRound.round_number}
                  />
                );
              }
              return null;
            })()}
            {rounds.length === 0 ? (
              <Card>
                <CardContent className="py-8">
                  <p className="text-center text-muted-foreground">
                    No rounds have been created yet.
                  </p>
                </CardContent>
              </Card>
            ) : (
              rounds.map((round) => {
                const canEnterScore = round.status === "in_progress";
                return (
                <Card key={round.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Round {round.round_number}</CardTitle>
                      <Badge variant={round.status === "completed" ? "secondary" : "default"}>
                        {round.status.replace("_", " ")}
                      </Badge>
                    </div>
                    {canEnterScore && (
                      <p className="text-sm text-muted-foreground mt-1">
                        Tap your match to enter the score. The director will verify before completing the round.
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4">
                      {round.matches.map((match) => {
                        const isBye = !match.player2_name;
                        const isSingles = !isBye && !match.player3_name && !match.player4_name;

                        if (isBye) {
                          return (
                            <div key={match.id} className="border rounded-lg p-4 flex items-center justify-between">
                              <Badge variant="outline">BYE</Badge>
                              <p className="text-sm font-medium">{match.player1_name}</p>
                            </div>
                          );
                        }

                        const cardCommon = "border rounded-lg p-4";
                        const interactive = canEnterScore
                          ? "cursor-pointer hover:border-primary hover:shadow-md transition-all active:scale-[0.99]"
                          : "";

                        const onClick = canEnterScore
                          ? () => setScoreEntryMatch({
                              id: match.id,
                              court_number: match.court_number,
                              team1_score: match.team1_score,
                              team2_score: match.team2_score,
                              player1_name: match.player1_name,
                              player2_name: match.player2_name,
                              player3_name: match.player3_name,
                              player4_name: match.player4_name,
                            })
                          : undefined;

                        return (
                          <div
                            key={match.id}
                            className={`${cardCommon} ${interactive}`}
                            onClick={onClick}
                            role={canEnterScore ? "button" : undefined}
                            tabIndex={canEnterScore ? 0 : undefined}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">Court {match.court_number}</Badge>
                                {isSingles && <Badge variant="secondary">Singles</Badge>}
                              </div>
                              {match.team1_score !== null && match.team2_score !== null && (match.team1_score > 0 || match.team2_score > 0) && (
                                <div className="text-lg font-bold">
                                  {match.team1_score} - {match.team2_score}
                                </div>
                              )}
                            </div>
                            {isSingles ? (
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p>{match.player1_name}</p>
                                </div>
                                <div>
                                  <p>{match.player2_name}</p>
                                </div>
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p className="font-medium mb-1">Team 1</p>
                                  <p>{match.player1_name}</p>
                                  <p>{match.player3_name}</p>
                                </div>
                                <div>
                                  <p className="font-medium mb-1">Team 2</p>
                                  <p>{match.player2_name}</p>
                                  <p>{match.player4_name}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </main>
      <PublicScoreDialog
        match={scoreEntryMatch}
        open={!!scoreEntryMatch}
        onOpenChange={(open) => { if (!open) setScoreEntryMatch(null); }}
        onSaved={fetchRounds}
      />
    </div>
  );
}
