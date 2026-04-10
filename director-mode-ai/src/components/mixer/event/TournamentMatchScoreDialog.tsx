import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

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
}

interface TournamentMatchScoreDialogProps {
  match: Match;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScoreSaved: () => void;
  eventId: string;
  scoringFormat: string;
}

const TournamentMatchScoreDialog = ({ match, open, onOpenChange, onScoreSaved, eventId, scoringFormat }: TournamentMatchScoreDialogProps) => {
  const { toast } = useToast();
  const [team1Score, setTeam1Score] = useState<number>(match.team1_score || 0);
  const [team2Score, setTeam2Score] = useState<number>(match.team2_score || 0);
  const [winnerTeam, setWinnerTeam] = useState<number | null>(match.winner_team);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleSave = async () => {
    if (winnerTeam === null) {
      toast({
        variant: "destructive",
        title: "Winner required",
        description: "Please select a winner by checking the box next to their name.",
      });
      return;
    }

    // Validate that winner has higher score
    const winnerScore = winnerTeam === 1 ? team1Score : team2Score;
    const loserScore = winnerTeam === 1 ? team2Score : team1Score;
    
    if (winnerScore <= loserScore) {
      toast({
        variant: "destructive",
        title: "Invalid score",
        description: "The winner must have a higher score than the loser.",
      });
      return;
    }

    setSaving(true);
    const oldWinnerTeam = match.winner_team;
    const wasScored = oldWinnerTeam !== null;

    const { error: matchError } = await supabase
      .from("matches")
      .update({
        team1_score: team1Score,
        team2_score: team2Score,
        winner_team: winnerTeam,
        tiebreaker_winner: null,
      })
      .eq("id", match.id);

    if (matchError) {
      toast({
        variant: "destructive",
        title: "Error saving score",
        description: matchError.message,
      });
      setSaving(false);
      return;
    }

    // Update event_players standings
    const playerIds = [match.player1_id, match.player2_id, match.player3_id, match.player4_id]
      .filter((id) => id !== null) as string[];

    if (playerIds.length === 0) {
      setTimeout(() => {
        toast({
          title: "Score saved",
          description: "Match score updated.",
        });
        setSaving(false);
        onScoreSaved();
        onOpenChange(false);
      }, 100);
      return;
    }

    const { data: standings } = await supabase
      .from("event_players")
      .select("*")
      .eq("event_id", eventId)
      .in("player_id", playerIds);

    if (standings) {
      const updates = playerIds.map((playerId, index) => {
        const currentStats = standings.find((s) => s.player_id === playerId);
        if (!currentStats) return null;

        const isTeam1 = index === 0 || index === 2;
        
        let oldWins = 0, oldLosses = 0, oldGamesWon = 0, oldGamesLost = 0;
        if (wasScored) {
          const oldWon = (isTeam1 && oldWinnerTeam === 1) || (!isTeam1 && oldWinnerTeam === 2);
          const oldLost = (isTeam1 && oldWinnerTeam === 2) || (!isTeam1 && oldWinnerTeam === 1);
          oldWins = oldWon ? 1 : 0;
          oldLosses = oldLost ? 1 : 0;
          oldGamesWon = isTeam1 ? match.team1_score : match.team2_score;
          oldGamesLost = isTeam1 ? match.team2_score : match.team1_score;
        }

        const won = (isTeam1 && winnerTeam === 1) || (!isTeam1 && winnerTeam === 2);
        const lost = (isTeam1 && winnerTeam === 2) || (!isTeam1 && winnerTeam === 1);
        const gamesWon = isTeam1 ? team1Score : team2Score;
        const gamesLost = isTeam1 ? team2Score : team1Score;

        return {
          id: currentStats.id,
          wins: currentStats.wins - oldWins + (won ? 1 : 0),
          losses: currentStats.losses - oldLosses + (lost ? 1 : 0),
          games_won: currentStats.games_won - oldGamesWon + gamesWon,
          games_lost: currentStats.games_lost - oldGamesLost + gamesLost,
        };
      }).filter(Boolean);

      for (const update of updates) {
        await supabase.from("event_players").update(update).eq("id", update!.id);
      }
    }

    // Automatic advancement: find next match and advance winner
    try {
      const { data: currentMatch } = await supabase
        .from("matches")
        .select("feeds_into_match_id")
        .eq("id", match.id)
        .single();

      if (currentMatch?.feeds_into_match_id) {
        // Get the event to determine if it's singles or doubles
        const { data: event } = await supabase
          .from("events")
          .select("match_format")
          .eq("id", eventId)
          .single();

        const isDoubles = event?.match_format === 'doubles' || event?.match_format === 'mixed-doubles';

        // Get all matches in current round to find position
        const { data: currentRoundData } = await supabase
          .from("rounds")
          .select("id")
          .eq("id", match.round_id)
          .single();

        if (currentRoundData) {
          // Find all matches that feed into the same next match
          const { data: siblingMatches } = await supabase
            .from("matches")
            .select("id, court_number")
            .eq("feeds_into_match_id", currentMatch.feeds_into_match_id)
            .order("court_number");

          // Determine if this match is the top seed by comparing court numbers
          const thisMatchCourtNum = siblingMatches?.find(m => m.id === match.id)?.court_number ?? 0;
          const minCourtNum = Math.min(...(siblingMatches?.map(m => m.court_number) ?? [thisMatchCourtNum]));
          const isTopSeed = thisMatchCourtNum === minCourtNum;

          if (isDoubles) {
            const winnerPlayerIds = winnerTeam === 1
              ? { player1_id: match.player1_id, player2_id: match.player2_id }
              : { player1_id: match.player3_id, player2_id: match.player4_id };

            if (isTopSeed) {
              await supabase
                .from("matches")
                .update({
                  player1_id: winnerPlayerIds.player1_id,
                  player2_id: winnerPlayerIds.player2_id,
                })
                .eq("id", currentMatch.feeds_into_match_id);
            } else {
              await supabase
                .from("matches")
                .update({
                  player3_id: winnerPlayerIds.player1_id,
                  player4_id: winnerPlayerIds.player2_id,
                })
                .eq("id", currentMatch.feeds_into_match_id);
            }
          } else {
            // Singles
            const winnerPlayerId = winnerTeam === 1 ? match.player1_id : match.player2_id;

            if (isTopSeed) {
              await supabase
                .from("matches")
                .update({ player1_id: winnerPlayerId })
                .eq("id", currentMatch.feeds_into_match_id);
            } else {
              await supabase
                .from("matches")
                .update({ player2_id: winnerPlayerId })
                .eq("id", currentMatch.feeds_into_match_id);
            }
          }
        }
      }
    } catch (advanceError) {
      console.error("Error advancing winner:", advanceError);
      // Don't fail the entire save if advancement fails
    }

    setTimeout(() => {
      toast({
        title: "Score saved",
        description: "Winner advanced to next round.",
      });
      setSaving(false);
      onScoreSaved();
      onOpenChange(false);
    }, 100);
  };

  const handleClearScore = async () => {
    setClearing(true);
    
    const { error } = await supabase
      .from("matches")
      .update({
        team1_score: 0,
        team2_score: 0,
        winner_team: null,
        tiebreaker_winner: null,
      })
      .eq("id", match.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error clearing score",
        description: error.message,
      });
      setClearing(false);
      return;
    }

    toast({
      title: "Score cleared",
      description: "Match score has been reset.",
    });
    setClearing(false);
    setTeam1Score(0);
    setTeam2Score(0);
    setWinnerTeam(null);
    onScoreSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl">Court {match.court_number}</DialogTitle>
          <DialogDescription className="text-base">Enter match score</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4 p-5 bg-primary/5 rounded-2xl border-2">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={winnerTeam === 1}
                onChange={(e) => setWinnerTeam(e.target.checked ? 1 : null)}
                className="mt-1 h-5 w-5 rounded border-2 border-primary cursor-pointer"
              />
              <div className="flex-1">
                <Label className="text-base font-bold">Team 1 (Winner)</Label>
                <p className="text-base font-medium mt-1">
                  {match.player1?.name || "TBD"}
                  {match.player2 && match.player3 && match.player4 && ` & ${match.player2.name}`}
                </p>
              </div>
              <div className="w-24">
                <Label className="text-sm">Score</Label>
                <Input
                  type="number"
                  min="0"
                  value={team1Score}
                  onChange={(e) => setTeam1Score(parseInt(e.target.value) || 0)}
                  className="text-center text-lg font-bold"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5 bg-primary/5 rounded-2xl border-2">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={winnerTeam === 2}
                onChange={(e) => setWinnerTeam(e.target.checked ? 2 : null)}
                className="mt-1 h-5 w-5 rounded border-2 border-primary cursor-pointer"
              />
              <div className="flex-1">
                <Label className="text-base font-bold">Team 2 (Winner)</Label>
                <p className="text-base font-medium mt-1">
                  {match.player3 && match.player4 ? `${match.player3.name} & ${match.player4.name}` : (match.player2?.name || "TBD")}
                </p>
              </div>
              <div className="w-24">
                <Label className="text-sm">Score</Label>
                <Input
                  type="number"
                  min="0"
                  value={team2Score}
                  onChange={(e) => setTeam2Score(parseInt(e.target.value) || 0)}
                  className="text-center text-lg font-bold"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-3 sm:gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} size="lg" className="flex-1 sm:flex-1">
            Cancel
          </Button>
          {match.winner_team !== null && (
            <Button variant="destructive" onClick={handleClearScore} disabled={clearing} size="lg" className="flex-1 sm:flex-1">
              {clearing ? "Clearing..." : "Clear Score"}
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} size="lg" className="flex-1 sm:flex-1">
            {saving ? "Saving..." : "Save Score"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TournamentMatchScoreDialog;
