import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Event {
  id: string;
  scoring_format: string;
  round_length_minutes: number | null;
  target_games: number | null;
  num_courts: number;
}

interface EditEventFormatDialogProps {
  event: Event;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFormatUpdated: () => void;
}

const EditEventFormatDialog = ({ event, open, onOpenChange, onFormatUpdated }: EditEventFormatDialogProps) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  
  const [scoringFormat, setScoringFormat] = useState(event.scoring_format);
  const [roundLengthMinutes, setRoundLengthMinutes] = useState(event.round_length_minutes || 30);
  const [targetGames, setTargetGames] = useState(event.target_games || 11);
  const [numCourts, setNumCourts] = useState(event.num_courts);

  useEffect(() => {
    if (open) {
      setScoringFormat(event.scoring_format);
      setRoundLengthMinutes(event.round_length_minutes || 30);
      setTargetGames(event.target_games || 11);
      setNumCourts(event.num_courts);
    }
  }, [open, event]);

  const handleSave = async () => {
    setSaving(true);
    
    const updates: any = {
      scoring_format: scoringFormat,
      round_length_minutes: scoringFormat === "timed" ? roundLengthMinutes : null,
      target_games: scoringFormat !== "timed" ? targetGames : null,
      num_courts: numCourts,
    };

    const { error } = await supabase
      .from("events")
      .update(updates)
      .eq("id", event.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error updating format",
        description: error.message,
      });
    } else {
      toast({
        title: "Format updated",
        description: "Event format has been updated successfully.",
      });
      onFormatUpdated();
      onOpenChange(false);
    }
    setSaving(false);
  };

  const handleNumberChange = (setter: (val: number) => void, value: string) => {
    if (value === '') {
      setter(0);
    } else {
      setter(parseInt(value) || 0);
    }
  };

  const handleNumberBlur = (setter: (val: number) => void, currentValue: number, min: number) => {
    if (currentValue < min) {
      setter(min);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle>Edit Event Format</DialogTitle>
          <DialogDescription>Update the scoring format and court configuration</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label className="text-sm font-medium">Scoring Format</Label>
            <select
              value={scoringFormat}
              onChange={(e) => setScoringFormat(e.target.value)}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="timed">Timed Rounds</option>
              <option value="first_to_x">First to X Games</option>
              <option value="fixed_games">Fixed Games</option>
              <option value="flexible">Flexible (any score)</option>
              <option value="pro_set">8 Game Pro-Set</option>
              <option value="best_of_3_sets">Best of 3 Sets</option>
              <option value="best_of_3_tiebreak">Best of 3 with 10-Point Tiebreak</option>
            </select>
          </div>

          <div>
            <Label className="text-sm font-medium">Number of Courts</Label>
            <input
              type="number"
              value={numCourts || ''}
              onChange={(e) => handleNumberChange(setNumCourts, e.target.value)}
              onBlur={() => handleNumberBlur(setNumCourts, numCourts, 1)}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary"
              min={1}
              max={50}
            />
          </div>

          {scoringFormat === "timed" && (
            <div>
              <Label className="text-sm font-medium">Round Length (minutes)</Label>
              <input
                type="number"
                value={roundLengthMinutes || ''}
                onChange={(e) => handleNumberChange(setRoundLengthMinutes, e.target.value)}
                onBlur={() => handleNumberBlur(setRoundLengthMinutes, roundLengthMinutes, 5)}
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                min={5}
                max={180}
              />
            </div>
          )}

          {(scoringFormat === "fixed_games" || scoringFormat === "first_to_x") && (
            <div>
              <Label className="text-sm font-medium">
                {scoringFormat === "first_to_x" ? "Games to Win" : "Total Games"}
              </Label>
              <input
                type="number"
                value={targetGames || ''}
                onChange={(e) => handleNumberChange(setTargetGames, e.target.value)}
                onBlur={() => handleNumberBlur(setTargetGames, targetGames, 1)}
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                min={1}
                max={21}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="bg-white">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditEventFormatDialog;
