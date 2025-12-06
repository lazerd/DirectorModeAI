import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle } from "lucide-react";

interface Match {
  id: string;
  court_number: number;
  team1_score: number;
  team2_score: number;
  winner_team: number | null;
  tiebreaker_winner: number | null;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  player1: { name: string } | null;
  player2: { name: string } | null;
  player3: { name: string } | null;
  player4: { name: string } | null;
}

interface MatchScoreDialogProps {
  match: Match;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScoreSaved: () => void;
  eventId: string;
  scoringFormat: string;
  targetGames: number | null;
}

const MatchScoreDialog = ({ match, open, onOpenChange, onScoreSaved, eventId, scoringFormat, targetGames }: MatchScoreDialogProps) => {
  const { toast } = useToast();
  const [team1Score, setTeam1Score] = useState(match.team1_score);
  const [team2Score, setTeam2Score] = useState(match.team2_score);
  const [tiebreakerWinner, setTiebreakerWinner] = useState<number | null>(match.tiebreaker_winner);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const isTied = team1Score === team2Score && team1Score > 0;

  const validateScore = (): boolean => {
    setValidationError(null);
    
    if (team1Score === team2Score && scoringFormat !== "fixed_games") {
      setValidationError("Scores cannot be tied. One team must have a higher score.");
      return false;
    }

    if (scoringFormat === "first_to_x" && targetGames) {
      const maxScore = Math.max(team1Score, team2Score);
      const minScore = Math.min(team1Score, team2Score);
      
      if (maxScore !== targetGames) {
        setValidationError(`Winner must have exactly ${targetGames} games for "First to ${targetGames}" format.`);
        return false;
      }
      
      if (minScore >= targetGames) {
        setValidationError(`Loser must have fewer than ${targetGames} games.`);
        return false;
      }
    }
    
    if (scoringFormat === "fixed_games" && targetGames) {
      const total = team1Score + team2Score;
      
      if (total !== targetGames) {
        setValidationError(`Total games must equal ${targetGames}. Current total: ${total}`);
        return false;
      }

      if (isTied && !tiebreakerWinner) {
        setValidationError("Match is tied. Please select which team won the tiebreaker.");
        return false;
      }
    }
    
    return true;
  };

  const handleSave = async () => {
    if (!validateScore()) {
      return;
    }
    setSaving(true);

    const winnerTeam = isTied ? tiebreakerWinner : (team1Score > team2Score ? 1 : team2Score > team1Score ? 2 : null);
    const oldWinnerTeam = match.winner_team;
    const wasScored = oldWinnerTeam !== null;

    const { error: matchError } = await supabase
      .from("matches")
      .update({
        team1_score: team1Score,
        team2_score: team2Score,
        winner_team: winnerTeam,
        tiebreaker_winner: isTied ? tiebreakerWinner : null,
      })
      .eq("id", match.id);

    if (matchError) {
      setValidationError(`Error saving: ${matchError.message}`);
      setSaving(false);
      return;
    }

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

        const won = winnerTeam !== null && ((isTeam1 && winnerTeam === 1) || (!isTeam1 && winnerTeam === 2));
        const lost = winnerTeam !== null && ((isTeam1 && winnerTeam === 2) || (!isTeam1 && winnerTeam === 1));
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

    setTimeout(() => {
      toast({
        title: "Score saved",
        description: "Match score and standings updated.",
      });
      
      setSaving(false);
      onScoreSaved();
      onOpenChange(false);
    }, 100);
  };

  // Clear validation error when scores change
  const handleTeam1ScoreChange = (value: number) => {
    setTeam1Score(value);
    setValidationError(null);
  };

  const handleTeam2ScoreChange = (value: number) => {
    setTeam2Score(value);
    setValidationError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="text-2xl">Court {match.court_number}</DialogTitle>
          <DialogDescription className="text-base">
            Enter match score
            {scoringFormat === "fixed_games" && targetGames && (
              <span className="block text-sm mt-1 font-medium">
                Format: Fixed {targetGames} games (total must equal {targetGames})
              </span>
            )}
            {scoringFormat === "first_to_x" && targetGames && (
              <span className="block text-sm mt-1 font-medium">
                Format: First to {targetGames} games
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Inline validation error - highly visible */}
          {validationError && (
            <div className="p-4 bg-red-100 border-2 border-red-400 rounded-xl flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 font-medium">{validationError}</p>
            </div>
          )}

          <div className="space-y-3 p-5 bg-blue-50 rounded-2xl border-2 border-blue-200">
            <Label className="text-base font-bold">Team 1</Label>
            <p className="text-base font-medium">
              {match.player1?.name || "TBD"}
              {match.player3 && ` & ${match.player3.name}`}
            </p>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => handleTeam1ScoreChange(Math.max(0, team1Score - 1))}
                className="h-14 w-14 text-xl font-bold bg-white"
              >
                −
              </Button>
              <Input
                type="number"
                min="0"
                value={team1Score}
                onChange={(e) => handleTeam1ScoreChange(parseInt(e.target.value) || 0)}
                className="h-14 text-center text-3xl font-bold bg-white border-2"
              />
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => handleTeam1ScoreChange(team1Score + 1)}
                className="h-14 w-14 text-xl font-bold bg-white"
              >
                +
              </Button>
            </div>
          </div>

          <div className="space-y-3 p-5 bg-orange-50 rounded-2xl border-2 border-orange-200">
            <Label className="text-base font-bold">Team 2</Label>
            <p className="text-base font-medium">
              {match.player2?.name || "TBD"}
              {match.player4 && ` & ${match.player4.name}`}
            </p>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => handleTeam2ScoreChange(Math.max(0, team2Score - 1))}
                className="h-14 w-14 text-xl font-bold bg-white"
              >
                −
              </Button>
              <Input
                type="number"
                min="0"
                value={team2Score}
                onChange={(e) => handleTeam2ScoreChange(parseInt(e.target.value) || 0)}
                className="h-14 text-center text-3xl font-bold bg-white border-2"
              />
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => handleTeam2ScoreChange(team2Score + 1)}
                className="h-14 w-14 text-xl font-bold bg-white"
              >
                +
              </Button>
            </div>
          </div>

          {scoringFormat === "fixed_games" && isTied && (
            <div className="space-y-3 p-5 bg-red-50 rounded-2xl border-2 border-red-200">
              <Label className="text-base font-bold text-red-700">Tiebreaker Winner</Label>
              <p className="text-sm text-gray-600">Match is tied. Select which team won the tiebreaker:</p>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant={tiebreakerWinner === 1 ? "default" : "outline"}
                  size="lg"
                  onClick={() => {
                    setTiebreakerWinner(1);
                    setValidationError(null);
                  }}
                  className="flex-1"
                >
                  Team 1 Wins
                </Button>
                <Button
                  type="button"
                  variant={tiebreakerWinner === 2 ? "default" : "outline"}
                  size="lg"
                  onClick={() => {
                    setTiebreakerWinner(2);
                    setValidationError(null);
                  }}
                  className="flex-1"
                >
                  Team 2 Wins
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-3 sm:gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} size="lg" className="flex-1 sm:flex-1 bg-white">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} size="lg" className="flex-1 sm:flex-1">
            {saving ? "Saving..." : "Save Score"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MatchScoreDialog;
