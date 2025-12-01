import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sparkles } from "lucide-react";

interface RoundGenerationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (numRounds: number, randomize: boolean) => void;
  maxRounds: number;
}

const RoundGenerationDialog = ({ open, onOpenChange, onGenerate, maxRounds }: RoundGenerationDialogProps) => {
  const [numRounds, setNumRounds] = useState(3);
  const [mode, setMode] = useState<"smart" | "random">("smart");

  const handleGenerate = () => {
    onGenerate(numRounds, mode === "random");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Generate Multiple Rounds
          </DialogTitle>
          <DialogDescription>
            Automatically create multiple rounds with smart rotations to avoid repeat partners and opponents
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="numRounds">Number of Rounds</Label>
            <Input
              id="numRounds"
              type="number"
              min={1}
              max={maxRounds}
              value={numRounds}
              onChange={(e) => setNumRounds(parseInt(e.target.value) || 1)}
            />
          </div>

          <div className="space-y-2">
            <Label>Pairing Mode</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "smart" | "random")}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="smart" id="smart" />
                <Label htmlFor="smart" className="font-normal cursor-pointer">
                  Smart Rotation - Avoids repeat partners/opponents
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="random" id="random" />
                <Label htmlFor="random" className="font-normal cursor-pointer">
                  Random Each Round - New random pairings every round
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <p className="font-medium">{mode === "smart" ? "Smart Rotation" : "Random Pairings"}:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              {mode === "smart" ? (
                <>
                  <li>Players matched to avoid repeat partners</li>
                  <li>Avoids repeat opponents when possible</li>
                  <li>Everyone plays equal number of times</li>
                  <li>Skill levels balanced for competitive matches</li>
                </>
              ) : (
                <>
                  <li>Fresh random pairings each round</li>
                  <li>Maximum variety and unpredictability</li>
                  <li>Courts filled optimally each round</li>
                  <li>Simple and fast generation</li>
                </>
              )}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGenerate}>
            Generate {numRounds} {numRounds === 1 ? "Round" : "Rounds"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RoundGenerationDialog;