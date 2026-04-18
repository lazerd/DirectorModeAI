'use client';

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { AlertCircle, CheckCircle2 } from "lucide-react";

interface PublicMatch {
  id: string;
  court_number: number;
  team1_score: number | null;
  team2_score: number | null;
  player1_name: string | null;
  player2_name: string | null;
  player3_name: string | null;
  player4_name: string | null;
}

interface PublicScoreDialogProps {
  match: PublicMatch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const PublicScoreDialog = ({ match, open, onOpenChange, onSaved }: PublicScoreDialogProps) => {
  const [team1, setTeam1] = useState(0);
  const [team2, setTeam2] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (open && match) {
      setTeam1(match.team1_score ?? 0);
      setTeam2(match.team2_score ?? 0);
      setError(null);
      setSavedAt(null);
      setSaving(false);
    }
  }, [open, match?.id]);

  if (!match) return null;

  const isSingles = !match.player3_name && !match.player4_name;

  const team1Label = isSingles
    ? (match.player1_name ?? "Player 1")
    : `${match.player1_name ?? "?"} & ${match.player3_name ?? "?"}`;
  const team2Label = isSingles
    ? (match.player2_name ?? "Player 2")
    : `${match.player2_name ?? "?"} & ${match.player4_name ?? "?"}`;

  const handleSave = async () => {
    if (team1 === 0 && team2 === 0) {
      setError("Enter a score for at least one team.");
      return;
    }
    setSaving(true);
    setError(null);

    const winnerTeam = team1 > team2 ? 1 : team2 > team1 ? 2 : null;

    const { error: dbError } = await supabase
      .from("matches")
      .update({ team1_score: team1, team2_score: team2, winner_team: winnerTeam })
      .eq("id", match.id);

    setSaving(false);
    if (dbError) {
      setError(dbError.message.includes("permission") || dbError.message.includes("policy")
        ? "Scoring closed for this round — ask the director."
        : dbError.message);
      return;
    }

    setSavedAt(Date.now());
    onSaved?.();
    setTimeout(() => onOpenChange(false), 800);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white text-gray-900">
        <DialogHeader>
          <DialogTitle className="text-2xl">Court {match.court_number}</DialogTitle>
          <DialogDescription className="text-base">
            Enter the final score. The director will verify before the round closes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="p-3 bg-red-50 border-2 border-red-300 rounded-xl flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 font-medium text-sm">{error}</p>
            </div>
          )}
          {savedAt && (
            <div className="p-3 bg-green-50 border-2 border-green-300 rounded-xl flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
              <p className="text-green-700 font-medium text-sm">Score submitted!</p>
            </div>
          )}

          <div className="space-y-2 p-4 bg-blue-50 rounded-xl border-2 border-blue-200">
            <Label className="text-base font-bold text-gray-900">{team1Label}</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => setTeam1(Math.max(0, team1 - 1))} className="h-12 w-12 text-xl font-bold bg-white">−</Button>
              <Input
                type="number"
                min="0"
                inputMode="numeric"
                value={team1}
                onChange={(e) => setTeam1(parseInt(e.target.value) || 0)}
                className="h-12 text-center text-2xl font-bold bg-white border-2 text-gray-900"
              />
              <Button type="button" variant="outline" size="lg" onClick={() => setTeam1(team1 + 1)} className="h-12 w-12 text-xl font-bold bg-white">+</Button>
            </div>
          </div>

          <div className="space-y-2 p-4 bg-orange-50 rounded-xl border-2 border-orange-200">
            <Label className="text-base font-bold text-gray-900">{team2Label}</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => setTeam2(Math.max(0, team2 - 1))} className="h-12 w-12 text-xl font-bold bg-white">−</Button>
              <Input
                type="number"
                min="0"
                inputMode="numeric"
                value={team2}
                onChange={(e) => setTeam2(parseInt(e.target.value) || 0)}
                className="h-12 text-center text-2xl font-bold bg-white border-2 text-gray-900"
              />
              <Button type="button" variant="outline" size="lg" onClick={() => setTeam2(team2 + 1)} className="h-12 w-12 text-xl font-bold bg-white">+</Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-3 sm:gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} size="lg" className="flex-1 bg-white">Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !!savedAt} size="lg" className="flex-1">
            {saving ? "Saving..." : savedAt ? "Saved!" : "Submit Score"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PublicScoreDialog;
