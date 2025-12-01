import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Match {
  id: string;
  court_number: number;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  player1: { name: string } | null;
  player2: { name: string } | null;
  player3: { name: string } | null;
  player4: { name: string } | null;
}

interface CourtAssignmentDialogProps {
  match: Match;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCourtAssigned: () => void;
  totalCourts: number;
}

const CourtAssignmentDialog = ({ match, open, onOpenChange, onCourtAssigned, totalCourts }: CourtAssignmentDialogProps) => {
  const { toast } = useToast();
  const [selectedCourt, setSelectedCourt] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!selectedCourt) {
      toast({
        variant: "destructive",
        title: "Court required",
        description: "Please select a court number.",
      });
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("matches")
      .update({ court_number: parseInt(selectedCourt) })
      .eq("id", match.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error assigning court",
        description: error.message,
      });
      setSaving(false);
      return;
    }

    toast({
      title: "Court assigned",
      description: `Match assigned to Court ${selectedCourt}.`,
    });
    setSaving(false);
    onCourtAssigned();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Court</DialogTitle>
          <DialogDescription>Select a court number for this match</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Match</Label>
            <p className="text-sm text-muted-foreground">
              {match.player1?.name || "TBD"}
              {match.player2 && ` & ${match.player2.name}`}
              {" vs "}
              {match.player3?.name || match.player2?.name || "TBD"}
              {match.player4 && ` & ${match.player4.name}`}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Court Number</Label>
            <Select value={selectedCourt} onValueChange={setSelectedCourt}>
              <SelectTrigger>
                <SelectValue placeholder="Select a court" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: totalCourts }, (_, i) => i + 1).map((courtNum) => (
                  <SelectItem key={courtNum} value={courtNum.toString()}>
                    Court {courtNum}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} size="lg" className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} size="lg" className="flex-1">
            {saving ? "Assigning..." : "Assign Court"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CourtAssignmentDialog;
