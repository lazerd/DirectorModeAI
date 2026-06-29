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
  court_names?: string[] | null;
  num_winners?: number | null;
  winners_split_gender?: boolean | null;
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
  const [courtSlots, setCourtSlots] = useState<string[]>([]);
  const [numWinners, setNumWinners] = useState(event.num_winners ?? 1);
  const [splitGender, setSplitGender] = useState(!!event.winners_split_gender);

  useEffect(() => {
    if (open) {
      setScoringFormat(event.scoring_format);
      setRoundLengthMinutes(event.round_length_minutes || 30);
      setTargetGames(event.target_games || 11);
      setNumCourts(event.num_courts);
      const existing = event.court_names ?? [];
      setCourtSlots(Array.from({ length: Math.max(1, event.num_courts) }, (_, i) => existing[i] ?? String(i + 1)));
      setNumWinners(event.num_winners ?? 1);
      setSplitGender(!!event.winners_split_gender);
    }
  }, [open, event]);

  const handleSave = async () => {
    setSaving(true);
    
    // The actual court number for each court slot. When they're just 1..N we
    // store null (legacy default); otherwise the explicit list drives both the
    // court count and the number stamped on each generated match.
    const courtCount = Math.max(1, numCourts);
    const finalCourts = Array.from({ length: courtCount }, (_, i) => (courtSlots[i]?.trim() || String(i + 1)));
    const isDefault = finalCourts.every((c, i) => c === String(i + 1));

    const updates: any = {
      scoring_format: scoringFormat,
      round_length_minutes: scoringFormat === "timed" ? roundLengthMinutes : null,
      target_games: scoringFormat !== "timed" ? targetGames : null,
      num_courts: courtCount,
      court_names: isDefault ? null : finalCourts,
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
      // Winner config columns may not exist on older databases — write them
      // separately and ignore a missing-column error so the format save sticks.
      await supabase
        .from("events")
        .update({ num_winners: splitGender ? 2 : Math.max(1, numWinners), winners_split_gender: splitGender })
        .eq("id", event.id);
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

  // Changing the court count resizes the per-court inputs, preserving any
  // numbers already entered and defaulting new slots to their slot number.
  const handleCourtCountChange = (value: string) => {
    const n = value === '' ? 0 : (parseInt(value) || 0);
    setNumCourts(n);
    setCourtSlots((prev) => Array.from({ length: Math.max(0, n) }, (_, i) => prev[i] ?? String(i + 1)));
  };

  const setCourtSlot = (idx: number, value: string) => {
    setCourtSlots((prev) => prev.map((c, i) => (i === idx ? value : c)));
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
              onChange={(e) => handleCourtCountChange(e.target.value)}
              onBlur={() => { if (numCourts < 1) handleCourtCountChange('1'); }}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary"
              min={1}
              max={50}
            />
          </div>

          {numCourts >= 1 && (
            <div>
              <Label className="text-sm font-medium">Court numbers</Label>
              <p className="mt-0.5 mb-2 text-xs text-gray-500">
                The actual number of each court you&apos;re using. Defaults to 1–{numCourts}; change them if you&apos;re on, say, courts 2–5. These show on every match and result.
              </p>
              <div className="flex flex-wrap gap-2">
                {courtSlots.map((val, i) => (
                  <div key={i} className="flex flex-col items-center">
                    <span className="text-[10px] text-gray-400 mb-0.5">Court {i + 1}</span>
                    <input
                      type="text"
                      value={val}
                      onChange={(e) => setCourtSlot(i, e.target.value)}
                      style={{ color: "#111827" }}
                      className="w-16 px-2 py-1.5 text-center border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label className="text-sm font-medium">Winners</Label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-gray-600">How many?</span>
              <input
                type="number"
                value={splitGender ? 2 : (numWinners || '')}
                onChange={(e) => handleNumberChange(setNumWinners, e.target.value)}
                onBlur={() => handleNumberBlur(setNumWinners, numWinners, 1)}
                disabled={splitGender}
                style={{ color: "#111827" }}
                className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary"
                min={1}
                max={20}
              />
            </div>
            <label className="mt-2 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={splitGender}
                onChange={(e) => setSplitGender(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm text-gray-700">Separate women&apos;s &amp; men&apos;s winner (1 each)</span>
            </label>
            <p className="mt-1 text-xs text-gray-500">
              {splitGender
                ? "Results show a top woman and a top man."
                : `Results highlight the top ${Math.max(1, numWinners)} overall.`}
            </p>
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
