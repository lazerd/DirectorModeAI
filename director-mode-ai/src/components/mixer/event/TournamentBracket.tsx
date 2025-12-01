import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Trophy, Loader2 } from "lucide-react";
import { generateTournamentBracket } from "@/lib/bracketGeneration";
import TournamentMatchScoreDialog from "@/components/mixer/event/TournamentMatchScoreDialog";
import CourtAvailability from "@/components/mixer/event/CourtAvailability";
import CourtAssignmentDialog from "@/components/mixer/event/CourtAssignmentDialog";

interface Event {
  id: string;
  match_format: string | null;
  scoring_format: string;
  num_courts: number;
}

interface Match {
  id: string;
  court_number: number;
  team1_score: number;
  team2_score: number;
  winner_team: number | null;
  tiebreaker_winner: number | null;
  round_id: string;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  player1: { name: string } | null;
  player2: { name: string } | null;
  player3: { name: string } | null;
  player4: { name: string } | null;
  round_number: number;
}

interface TournamentBracketProps {
  event: Event;
}

const TournamentBracket = ({ event }: TournamentBracketProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [rounds, setRounds] = useState<{ [key: number]: Match[] }>({});
  const [totalRounds, setTotalRounds] = useState(0);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [showScoreDialog, setShowScoreDialog] = useState(false);
  const [showCourtDialog, setShowCourtDialog] = useState(false);

  useEffect(() => {
    fetchBracket();
  }, [event.id]);

  const fetchBracket = async () => {
    setLoading(true);
    
    // Fetch all rounds for this event
    const { data: roundsData, error: roundsError } = await supabase
      .from("rounds")
      .select("id, round_number")
      .eq("event_id", event.id)
      .order("round_number");

    if (roundsError) {
      toast({
        variant: "destructive",
        title: "Error fetching bracket",
        description: roundsError.message,
      });
      setLoading(false);
      return;
    }

    if (!roundsData || roundsData.length === 0) {
      setLoading(false);
      return;
    }

    // Fetch all matches for all rounds
    const { data: matchesData, error: matchesError } = await supabase
      .from("matches")
      .select(`
        *,
        player1:players!matches_player1_id_fkey(name),
        player2:players!matches_player2_id_fkey(name),
        player3:players!matches_player3_id_fkey(name),
        player4:players!matches_player4_id_fkey(name)
      `)
      .in("round_id", roundsData.map(r => r.id))
      .order("court_number");

    if (matchesError) {
      toast({
        variant: "destructive",
        title: "Error fetching matches",
        description: matchesError.message,
      });
      setLoading(false);
      return;
    }

    // Organize matches by round number
    const matchesByRound: { [key: number]: Match[] } = {};
    let maxRound = 0;

    for (const match of matchesData || []) {
      const round = roundsData.find(r => r.id === match.round_id);
      if (round) {
        const roundNum = round.round_number;
        if (!matchesByRound[roundNum]) {
          matchesByRound[roundNum] = [];
        }
        matchesByRound[roundNum].push({ ...match, round_number: roundNum });
        maxRound = Math.max(maxRound, roundNum);
      }
    }

    setRounds(matchesByRound);
    setTotalRounds(maxRound);
    setLoading(false);
  };

  const generateBracket = async () => {
    setGenerating(true);

    const matchFormat = event.match_format;
    if (!matchFormat || !['singles', 'doubles', 'mixed-doubles'].includes(matchFormat)) {
      toast({
        variant: "destructive",
        title: "Invalid format",
        description: "This event is not configured as a tournament.",
      });
      setGenerating(false);
      return;
    }

    // Get players ordered by strength
    const { data: eventPlayers, error: playersError } = await supabase
      .from("event_players")
      .select(`
        player_id,
        players(name)
      `)
      .eq("event_id", event.id)
      .order("strength_order");

    if (playersError || !eventPlayers || eventPlayers.length < 2) {
      toast({
        variant: "destructive",
        title: "Not enough players",
        description: "Need at least 2 players to generate a tournament bracket.",
      });
      setGenerating(false);
      return;
    }

    const players = eventPlayers.map((ep: any) => ({
      player_id: ep.player_id,
      name: ep.players.name,
    }));

    // Generate bracket structure
    const bracket = generateTournamentBracket(players, matchFormat as 'singles' | 'doubles' | 'mixed-doubles');

    // Create all rounds first to get their IDs
    const roundIds: { [roundNum: number]: string } = {};
    for (let roundNum = 1; roundNum <= bracket.totalRounds; roundNum++) {
      const { data: round, error: roundError } = await supabase
        .from("rounds")
        .insert([
          {
            event_id: event.id,
            round_number: roundNum,
            status: "upcoming",
          },
        ])
        .select()
        .single();

      if (roundError) {
        toast({
          variant: "destructive",
          title: `Error creating round ${roundNum}`,
          description: roundError.message,
        });
        continue;
      }
      roundIds[roundNum] = round.id;
    }

    // Create all matches and map them by match number for linking
    const createdMatches: { [matchNum: number]: string } = {};
    
    for (let roundNum = 1; roundNum <= bracket.totalRounds; roundNum++) {
      const roundMatches = bracket.bracketMatches.filter(m => m.round === roundNum);
      
      for (const bracketMatch of roundMatches) {
        const { data: match, error: matchError } = await supabase
          .from("matches")
          .insert([{
            round_id: roundIds[roundNum],
            court_number: bracketMatch.courtNumber || 0,
            player1_id: bracketMatch.player1_id,
            player2_id: bracketMatch.player2_id,
            player3_id: bracketMatch.player3_id,
            player4_id: bracketMatch.player4_id,
            team1_score: 0,
            team2_score: 0,
            winner_team: bracketMatch.isBye ? 1 : null, // Auto-complete BYE matches
          }])
          .select()
          .single();

        if (!matchError && match) {
          createdMatches[bracketMatch.matchNumber] = match.id;
        }
      }
    }

    // Update feeds_into_match_id for all matches
    for (const bracketMatch of bracket.bracketMatches) {
      if (bracketMatch.feedsIntoMatchNumber) {
        const matchId = createdMatches[bracketMatch.matchNumber];
        const feedsIntoMatchId = createdMatches[bracketMatch.feedsIntoMatchNumber];
        
        if (matchId && feedsIntoMatchId) {
          await supabase
            .from("matches")
            .update({ feeds_into_match_id: feedsIntoMatchId })
            .eq("id", matchId);
        }
      }
    }

    // Auto-advance BYE matches
    for (const bracketMatch of bracket.bracketMatches.filter(m => m.isBye)) {
      const matchId = createdMatches[bracketMatch.matchNumber];
      const feedsIntoMatchId = bracketMatch.feedsIntoMatchNumber 
        ? createdMatches[bracketMatch.feedsIntoMatchNumber] 
        : null;
        
      if (matchId && feedsIntoMatchId) {
        const isDoubles = matchFormat === 'doubles' || matchFormat === 'mixed-doubles';
        const isTopSeed = bracketMatch.position % 2 === 0;
        
        if (isDoubles) {
          if (isTopSeed) {
            await supabase
              .from("matches")
              .update({
                player1_id: bracketMatch.player1_id,
                player2_id: bracketMatch.player2_id,
              })
              .eq("id", feedsIntoMatchId);
          } else {
            await supabase
              .from("matches")
              .update({
                player3_id: bracketMatch.player1_id,
                player4_id: bracketMatch.player2_id,
              })
              .eq("id", feedsIntoMatchId);
          }
        } else {
          // Singles
          if (isTopSeed) {
            await supabase
              .from("matches")
              .update({ player1_id: bracketMatch.player1_id })
              .eq("id", feedsIntoMatchId);
          } else {
            await supabase
              .from("matches")
              .update({ player2_id: bracketMatch.player1_id })
              .eq("id", feedsIntoMatchId);
          }
        }
      }
    }

    toast({
      title: "Bracket generated!",
      description: `Created ${bracket.totalRounds} round tournament bracket.`,
    });

    setGenerating(false);
    fetchBracket();
  };

  const handleScoreSaved = async () => {
    await fetchBracket();
  };

  const getRoundLabel = (roundNum: number) => {
    const roundsFromEnd = totalRounds - roundNum + 1;
    if (roundsFromEnd === 1) return "Finals";
    if (roundsFromEnd === 2) return "Semifinals";
    if (roundsFromEnd === 3) return "Quarterfinals";
    return `Round ${roundNum}`;
  };

  const isByeMatch = (match: Match) => {
    const isDoubles = event.match_format === 'doubles' || event.match_format === 'mixed-doubles';
    if (isDoubles) {
      return !match.player3_id && !match.player4_id;
    }
    return !match.player2_id;
  };
  
  const getTeamDisplay = (match: Match, team: 1 | 2) => {
    const isDoubles = event.match_format === 'doubles' || event.match_format === 'mixed-doubles';
    
    if (isDoubles) {
      if (team === 1) {
        const p1 = match.player1?.name || "TBD";
        const p2 = match.player2?.name || "TBD";
        return `${p1} & ${p2}`;
      } else {
        const p3 = match.player3?.name || "TBD";
        const p4 = match.player4?.name || "TBD";
        return `${p3} & ${p4}`;
      }
    } else {
      // Singles
      if (team === 1) {
        return match.player1?.name || "TBD";
      } else {
        return match.player2?.name || "TBD";
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (Object.keys(rounds).length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Tournament Bracket
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Trophy className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Bracket Generated</h3>
            <p className="text-muted-foreground mb-6">
              Generate the tournament bracket to get started
            </p>
            <Button onClick={generateBracket} disabled={generating} size="lg">
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                "Generate Bracket"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentRoundMatches = Object.values(rounds)[0] || [];

  return (
    <div className="space-y-6">
      <CourtAvailability 
        totalCourts={event.num_courts} 
        currentRoundMatches={currentRoundMatches}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Tournament Bracket
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-8 min-w-max items-center">
              {Object.entries(rounds)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([roundNum, matches], roundIndex) => {
                  const spacing = Math.pow(2, roundIndex) * 6;
                  return (
                  <div key={roundNum} className="flex flex-col min-w-[280px]">
                    <h3 className="text-lg font-bold text-center sticky top-0 bg-background py-2 border-b mb-4">
                      {getRoundLabel(parseInt(roundNum))}
                    </h3>
                    <div className="flex flex-col" style={{ gap: `${spacing}rem` }}>
                      {matches.map((match) => {
                        const isBye = isByeMatch(match);
                        const isComplete = match.winner_team !== null;
                        const needsCourtAssignment = match.court_number === 0 && !isBye;
                        
                        return (
                          <Card
                            key={match.id}
                            className={`border-2 transition-all ${
                              isComplete
                                ? "border-success bg-success/5 cursor-pointer hover:border-success"
                                : isBye
                                ? "border-muted bg-muted/30"
                                : needsCourtAssignment
                                ? "border-warning bg-warning/5 cursor-pointer hover:border-warning"
                                : "border-border hover:border-primary cursor-pointer"
                            }`}
                            onClick={() => {
                              if (!isBye) {
                                setSelectedMatch(match);
                                if (needsCourtAssignment) {
                                  setShowCourtDialog(true);
                                } else {
                                  setShowScoreDialog(true);
                                }
                              }
                            }}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between mb-3">
                                {match.court_number > 0 ? (
                                  <p className="text-xs font-bold text-muted-foreground">Court {match.court_number}</p>
                                ) : (
                                  <p className="text-xs font-bold text-warning">Click to Assign Court</p>
                                )}
                                {isComplete && (
                                  <p className="text-xs text-success font-medium">✓ Complete</p>
                                )}
                              </div>
                              {isBye ? (
                                <div className="text-center py-2">
                                  <p className="font-semibold">{match.player1?.name || "TBD"}</p>
                                  <p className="text-sm text-muted-foreground mt-1">
                                    Advances (Bye)
                                  </p>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex-1 min-w-0">
                                      <p className={`font-semibold truncate ${match.winner_team === 1 ? "text-success" : ""}`}>
                                        {getTeamDisplay(match, 1)}
                                      </p>
                                    </div>
                                    <p className="text-2xl font-bold ml-2">{match.team1_score}</p>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <div className="flex-1 min-w-0">
                                      <p className={`font-semibold truncate ${match.winner_team === 2 ? "text-success" : ""}`}>
                                        {getTeamDisplay(match, 2)}
                                      </p>
                                    </div>
                                    <p className="text-2xl font-bold ml-2">{match.team2_score}</p>
                                  </div>
                                </>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                  );
                })}
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedMatch && (
        <>
          <TournamentMatchScoreDialog
            match={selectedMatch}
            open={showScoreDialog}
            onOpenChange={setShowScoreDialog}
            onScoreSaved={handleScoreSaved}
            eventId={event.id}
            scoringFormat={event.scoring_format}
          />
          <CourtAssignmentDialog
            match={selectedMatch}
            open={showCourtDialog}
            onOpenChange={setShowCourtDialog}
            onCourtAssigned={handleScoreSaved}
            totalCourts={event.num_courts}
          />
        </>
      )}
    </div>
  );
};

export default TournamentBracket;
