import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface EditPlayerDialogProps {
  playerId: string;
  playerName: string;
  playerGender?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlayerUpdated: () => void;
}

const EditPlayerDialog = ({ 
  playerId, 
  playerName, 
  playerGender,
  open, 
  onOpenChange,
  onPlayerUpdated 
}: EditPlayerDialogProps) => {
  const { toast } = useToast();
  const [name, setName] = useState(playerName);
  const [gender, setGender] = useState(playerGender || "male");
  const [isUpdating, setIsUpdating] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        variant: "destructive",
        title: "Invalid name",
        description: "Player name cannot be empty",
      });
      return;
    }

    setIsUpdating(true);

    const { error } = await supabase
      .from("players")
      .update({ 
        name: name.trim(),
        gender: gender 
      })
      .eq("id", playerId);

    setIsUpdating(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error updating player",
        description: error.message,
      });
    } else {
      toast({
        title: "Player updated",
        description: "Player information has been saved.",
      });
      onPlayerUpdated();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Player</DialogTitle>
          <DialogDescription>
            Update the player's name or gender
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Player name"
            />
          </div>

          <div className="space-y-2">
            <Label>Gender</Label>
            <RadioGroup value={gender} onValueChange={setGender}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="male" id="male" />
                <Label htmlFor="male" className="cursor-pointer font-normal">Male</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="female" id="female" />
                <Label htmlFor="female" className="cursor-pointer font-normal">Female</Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isUpdating}>
            {isUpdating ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditPlayerDialog;
