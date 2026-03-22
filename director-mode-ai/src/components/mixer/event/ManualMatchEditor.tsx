import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { ArrowLeftRight, X } from "lucide-react";

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

interface PlayerSlot {
  uniqueId: string;
  playerId: string;
  name: string;
  matchId: string;
  slot: "player1" | "player2" | "player3" | "player4" | "bye";
}

interface ManualMatchEditorProps {
  matches: Match[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const ManualMatchEditor = ({ matches, open, onOpenChange, onSaved }: ManualMatchEditorProps) => {
  const { toast } = useToast();
  const [players, setPlayers] = useState<PlayerSlot[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Build player list from matches
  useEffect(() => {
    const allPlayers: PlayerSlot[] = [];
    matches.forEach((match) => {
      const isBye = match.player1_id && !match.player2_id && !match.player3_id && !match.player4_id;

      if (match.player1_id && match.player1) {
        allPlayers.push({
          uniqueId: `${match.id}-p1`,
          playerId: match.player1_id,
          name: match.player1.name,
          matchId: match.id,
          slot: isBye ? "bye" : "player1",
        });
      }
      if (match.player2_id && match.player2) {
        allPlayers.push({
          uniqueId: `${match.id}-p2`,
          playerId: match.player2_id,
          name: match.player2.name,
          matchId: match.id,
          slot: "player2",
        });
      }
      if (match.player3_id && match.player3) {
        allPlayers.push({
          uniqueId: `${match.id}-p3`,
          playerId: match.player3_id,
          name: match.player3.name,
          matchId: match.id,
          slot: "player3",
        });
      }
      if (match.player4_id && match.player4) {
        allPlayers.push({
          uniqueId: `${match.id}-p4`,
          playerId: match.player4_id,
          name: match.player4.name,
          matchId: match.id,
          slot: "player4",
        });
      }
    });
    setPlayers(allPlayers);
    setSelectedPlayer(null);
  }, [matches]);

  const handlePlayerTap = (uniqueId: string) => {
    if (!selectedPlayer) {
      // First tap — select this player
      setSelectedPlayer(uniqueId);
    } else if (selectedPlayer === uniqueId) {
      // Tapped same player — deselect
      setSelectedPlayer(null);
    } else {
      // Second tap — swap the two players
      setPlayers((prev) => {
        const newPlayers = [...prev];
        const idx1 = newPlayers.findIndex((p) => p.uniqueId === selectedPlayer);
        const idx2 = newPlayers.findIndex((p) => p.uniqueId === uniqueId);
        if (idx1 >= 0 && idx2 >= 0) {
          // Swap matchId and slot
          const tempMatchId = newPlayers[idx1].matchId;
          const tempSlot = newPlayers[idx1].slot;
          newPlayers[idx1] = { ...newPlayers[idx1], matchId: newPlayers[idx2].matchId, slot: newPlayers[idx2].slot };
          newPlayers[idx2] = { ...newPlayers[idx2], matchId: tempMatchId, slot: tempSlot };
        }
        return newPlayers;
      });
      setSelectedPlayer(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);

    // Build match updates
    const matchUpdates: Record<string, { player1_id: string | null; player2_id: string | null; player3_id: string | null; player4_id: string | null }> = {};

    matches.forEach((match) => {
      matchUpdates[match.id] = {
        player1_id: null,
        player2_id: null,
        player3_id: null,
        player4_id: null,
      };
    });

    // Place players into their assigned matches
    players.forEach((player) => {
      const update = matchUpdates[player.matchId];
      if (!update) return;

      if (player.slot === "bye" || player.slot === "player1") {
        if (!update.player1_id) {
          update.player1_id = player.playerId;
        } else if (!update.player3_id) {
          update.player3_id = player.playerId;
        }
      } else if (player.slot === "player2") {
        if (!update.player2_id) {
          update.player2_id = player.playerId;
        } else if (!update.player4_id) {
          update.player4_id = player.playerId;
        }
      } else if (player.slot === "player3") {
        if (!update.player3_id) {
          update.player3_id = player.playerId;
        } else if (!update.player1_id) {
          update.player1_id = player.playerId;
        }
      } else if (player.slot === "player4") {
        if (!update.player4_id) {
          update.player4_id = player.playerId;
        } else if (!update.player2_id) {
          update.player2_id = player.playerId;
        }
      }
    });

    try {
      for (const [matchId, updates] of Object.entries(matchUpdates)) {
        const { error } = await supabase
          .from("matches")
          .update(updates)
          .eq("id", matchId);
        if (error) throw error;
      }

      toast({
        title: "Matches updated!",
        description: "Player swaps have been saved.",
      });
      onSaved();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error saving",
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  // Group players by match for display
  const getMatchPlayers = (matchId: string) => players.filter((p) => p.matchId === matchId);

  const activeMatches = matches.filter((m) => m.player2_id || m.player3_id || m.player4_id);
  const byeMatches = matches.filter((m) => m.player1_id && !m.player2_id && !m.player3_id && !m.player4_id);

  const PlayerButton = ({ player }: { player: PlayerSlot }) => {
    const isSelected = selectedPlayer === player.uniqueId;
    return (
      <button
        onClick={() => handlePlayerTap(player.uniqueId)}
        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${
          isSelected
            ? "bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-1 scale-[1.02]"
            : "bg-white border-2 border-gray-200 text-gray-800 hover:border-blue-300 hover:bg-blue-50 active:bg-blue-100"
        }`}
      >
        {player.name}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-5 pt-5 pb-3 sticky top-0 bg-white z-10 border-b">
          <DialogTitle className="text-xl flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-blue-600" />
            Swap Players
          </DialogTitle>
          <DialogDescription>
            {selectedPlayer
              ? "Now tap another player to swap them"
              : "Tap a player to select, then tap another to swap"}
          </DialogDescription>
          {selectedPlayer && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedPlayer(null)}
              className="absolute top-4 right-4"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          {/* Active matches */}
          {activeMatches.map((match) => {
            const matchPlayers = getMatchPlayers(match.id);
            const team1 = matchPlayers.filter((p) => p.slot === "player1" || p.slot === "player3");
            const team2 = matchPlayers.filter((p) => p.slot === "player2" || p.slot === "player4");

            return (
              <Card key={match.id} className="overflow-hidden border-2">
                <div className="bg-gray-100 px-4 py-2 border-b">
                  <p className="font-bold text-base text-gray-800">Court {match.court_number}</p>
                </div>
                <div className="p-3">
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                    {/* Team 1 */}
                    <div className="space-y-2">
                      {team1.map((p) => (
                        <PlayerButton key={p.uniqueId} player={p} />
                      ))}
                    </div>

                    {/* VS */}
                    <div className="px-2">
                      <span className="text-lg font-bold text-gray-400">vs</span>
                    </div>

                    {/* Team 2 */}
                    <div className="space-y-2">
                      {team2.map((p) => (
                        <PlayerButton key={p.uniqueId} player={p} />
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}

          {/* BYE players */}
          {byeMatches.length > 0 && (
            <Card className="overflow-hidden border-2 border-amber-200">
              <div className="bg-amber-50 px-4 py-2 border-b border-amber-200">
                <p className="font-bold text-base text-amber-800">On BYE</p>
              </div>
              <div className="p-3 space-y-2">
                {byeMatches.map((match) => {
                  const byePlayer = getMatchPlayers(match.id).find((p) => p.slot === "bye");
                  if (!byePlayer) return null;
                  return <PlayerButton key={byePlayer.uniqueId} player={byePlayer} />;
                })}
              </div>
            </Card>
          )}
        </div>

        <DialogFooter className="px-5 pb-5 pt-3 sticky bottom-0 bg-white border-t gap-3 sm:gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} size="lg" className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} size="lg" className="flex-1">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualMatchEditor;
