import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Database, Plus, UserMinus } from "lucide-react";
import VaultPicker from "@/components/shared/VaultPicker";

interface ActiveEventPlayer {
  id: string;
  player_id: string;
  strength_order: number;
  player_name: string;
  player_gender: string | null;
}

interface ManagePlayersDialogProps {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlayersChanged: () => void;
}

const ManagePlayersDialog = ({ eventId, open, onOpenChange, onPlayersChanged }: ManagePlayersDialogProps) => {
  const { toast } = useToast();
  const [activePlayers, setActivePlayers] = useState<ActiveEventPlayer[]>([]);
  const [newName, setNewName] = useState("");
  const [newGender, setNewGender] = useState<"male" | "female">("male");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showVaultPicker, setShowVaultPicker] = useState(false);

  useEffect(() => {
    if (open) {
      fetchActivePlayers();
    }
  }, [open, eventId]);

  const fetchActivePlayers = async () => {
    const { data } = await supabase
      .from("event_players")
      .select(`id, player_id, strength_order, active, players(name, gender)`)
      .eq("event_id", eventId)
      .eq("active", true)
      .order("strength_order");

    if (data) {
      setActivePlayers(
        data.map((ep: any) => ({
          id: ep.id,
          player_id: ep.player_id,
          strength_order: ep.strength_order,
          player_name: ep.players?.name ?? "Unknown",
          player_gender: ep.players?.gender ?? null,
        }))
      );
    }
  };

  const nextStrengthOrder = () =>
    activePlayers.length === 0 ? 0 : Math.max(...activePlayers.map(p => p.strength_order)) + 1;

  const handleAddNew = async () => {
    const name = newName.trim();
    if (!name) {
      toast({ variant: "destructive", title: "Name required", description: "Enter a name to add a player." });
      return;
    }

    setAdding(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setAdding(false);
      return;
    }

    const { data: player, error: playerError } = await supabase
      .from("players")
      .insert([{ user_id: user.id, name, gender: newGender }])
      .select()
      .single();

    if (playerError || !player) {
      toast({ variant: "destructive", title: "Error adding player", description: playerError?.message ?? "Unknown error" });
      setAdding(false);
      return;
    }

    const { error: epError } = await supabase
      .from("event_players")
      .insert([{ event_id: eventId, player_id: player.id, strength_order: nextStrengthOrder() }]);

    if (epError) {
      toast({ variant: "destructive", title: "Error linking player to event", description: epError.message });
    } else {
      toast({ title: "Player added", description: `${name} will be included from the next generated round.` });
      setNewName("");
      setNewGender("male");
      await fetchActivePlayers();
      onPlayersChanged();
    }
    setAdding(false);
  };

  const handleVaultImport = async (vaultPlayers: { id: string; full_name: string; gender: string | null }[]) => {
    setShowVaultPicker(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let order = nextStrengthOrder();
    for (const vp of vaultPlayers) {
      const { data: player } = await supabase
        .from("players")
        .insert([{ user_id: user.id, name: vp.full_name, gender: vp.gender === "female" ? "female" : "male" }])
        .select()
        .single();

      if (player) {
        await supabase
          .from("event_players")
          .insert([{ event_id: eventId, player_id: player.id, strength_order: order++ }]);
      }
    }

    toast({
      title: "Players added",
      description: `${vaultPlayers.length} player${vaultPlayers.length !== 1 ? "s" : ""} added from PlayerVault.`,
    });
    await fetchActivePlayers();
    onPlayersChanged();
  };

  const handleRemove = async (ep: ActiveEventPlayer) => {
    if (!confirm(
      `Remove ${ep.player_name}?\n\n` +
      `Their completed match history will be kept. Any upcoming rounds that include them will show an empty slot — re-shuffle those rounds to rebalance.`
    )) return;

    setRemoving(ep.id);

    // 1. Soft-delete: mark inactive so generator ignores them.
    const { error: updateError } = await supabase
      .from("event_players")
      .update({ active: false })
      .eq("id", ep.id);

    if (updateError) {
      toast({ variant: "destructive", title: "Error removing player", description: updateError.message });
      setRemoving(null);
      return;
    }

    // 2. Null out this player's slots in any upcoming (unstarted) rounds.
    const { data: upcoming } = await supabase
      .from("rounds")
      .select("id")
      .eq("event_id", eventId)
      .eq("status", "upcoming");

    const upcomingIds = (upcoming ?? []).map(r => r.id);
    if (upcomingIds.length > 0) {
      for (const col of ["player1_id", "player2_id", "player3_id", "player4_id"] as const) {
        await supabase
          .from("matches")
          .update({ [col]: null })
          .in("round_id", upcomingIds)
          .eq(col, ep.player_id);
      }
    }

    toast({
      title: `${ep.player_name} removed`,
      description: upcomingIds.length > 0 ? "Re-shuffle upcoming rounds to rebalance." : "Player excluded from future rounds.",
    });

    await fetchActivePlayers();
    onPlayersChanged();
    setRemoving(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Players</DialogTitle>
            <DialogDescription>
              Add a late arrival or remove someone who had to leave. Completed-match history is preserved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Add a player</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Player name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !adding && handleAddNew()}
                />
                <Button onClick={handleAddNew} disabled={adding}>
                  <Plus className="h-4 w-4 mr-1" />
                  {adding ? "Adding..." : "Add"}
                </Button>
              </div>
              <RadioGroup value={newGender} onValueChange={(v) => setNewGender(v as "male" | "female")} className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="male" id="new-male" />
                  <Label htmlFor="new-male" className="font-normal">Male</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="female" id="new-female" />
                  <Label htmlFor="new-female" className="font-normal">Female</Label>
                </div>
              </RadioGroup>
              <Button variant="outline" onClick={() => setShowVaultPicker(true)} className="w-full">
                <Database className="h-4 w-4 mr-2" />
                Add from PlayerVault
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                Current players ({activePlayers.length})
              </Label>
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {activePlayers.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 text-center">No active players yet.</p>
                ) : (
                  activePlayers.map((ep, idx) => (
                    <div key={ep.id} className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-6">{idx + 1}.</span>
                        <span className="text-sm font-medium">{ep.player_name}</span>
                        {ep.player_gender && (
                          <span className="text-xs text-muted-foreground capitalize">{ep.player_gender}</span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(ep)}
                        disabled={removing === ep.id}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showVaultPicker && (
        <VaultPicker
          onSelect={() => {}}
          onClose={() => setShowVaultPicker(false)}
          multiSelect
          onMultiSelect={handleVaultImport}
        />
      )}
    </>
  );
};

export default ManagePlayersDialog;
