import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Users, User } from "lucide-react";

interface TournamentTypeDialogProps {
  open: boolean;
  onSelect: (type: 'singles' | 'doubles' | 'mixed-doubles') => void;
  onCancel: () => void;
}

const TournamentTypeDialog = ({ open, onSelect, onCancel }: TournamentTypeDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">Tournament Type</DialogTitle>
          <DialogDescription>
            Select whether this is a singles, doubles, or mixed doubles tournament
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <Button
            onClick={() => onSelect('singles')}
            variant="outline"
            className="h-auto p-6 flex flex-col items-start gap-2 hover:bg-primary/5 hover:border-primary"
          >
            <div className="flex items-center gap-3">
              <User className="h-6 w-6 text-primary" />
              <span className="text-xl font-semibold">Singles</span>
            </div>
            <p className="text-sm text-muted-foreground">
              One player vs one player per match
            </p>
          </Button>

          <Button
            onClick={() => onSelect('doubles')}
            variant="outline"
            className="h-auto p-6 flex flex-col items-start gap-2 hover:bg-primary/5 hover:border-primary"
          >
            <div className="flex items-center gap-3">
              <Users className="h-6 w-6 text-primary" />
              <span className="text-xl font-semibold">Doubles</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Two players vs two players per match
            </p>
          </Button>

          <Button
            onClick={() => onSelect('mixed-doubles')}
            variant="outline"
            className="h-auto p-6 flex flex-col items-start gap-2 hover:bg-primary/5 hover:border-primary"
          >
            <div className="flex items-center gap-3">
              <Users className="h-6 w-6 text-primary" />
              <span className="text-xl font-semibold">Mixed Doubles</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Mixed gender teams: one male and one female per team
            </p>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TournamentTypeDialog;
