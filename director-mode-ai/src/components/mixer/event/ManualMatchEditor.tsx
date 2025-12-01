import { useState, useEffect } from "react";
import { 
  DndContext, 
  DragEndEvent, 
  DragOverlay, 
  DragStartEvent, 
  DragOverEvent,
  closestCenter, 
  PointerSensor, 
  TouchSensor, 
  useSensor, 
  useSensors,
  useDroppable 
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { GripVertical } from "lucide-react";

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

interface Player {
  id: string;
  playerId: string;
  name: string;
  matchId: string;
  team: 1 | 2 | 0; // 0 for BYE
}

interface ManualMatchEditorProps {
  matches: Match[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const PlayerCard = ({ player }: { player: Player }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.id,
    data: player,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="cursor-move">
      <Card className="p-2 flex items-center gap-2 bg-background hover:bg-accent/10 transition-colors border-2">
        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-medium">{player.name}</span>
      </Card>
    </div>
  );
};

const DroppableTeam = ({ id, players, label }: { id: string; players: Player[]; label?: string }) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 min-h-[60px] p-2 rounded-lg border-2 border-dashed transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-muted-foreground/20"
      }`}
    >
      {label && <p className="text-xs font-semibold text-muted-foreground uppercase">{label}</p>}
      <SortableContext items={players.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        {players.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-2">Drop player here</div>
        ) : (
          players.map((player) => <PlayerCard key={player.id} player={player} />)
        )}
      </SortableContext>
    </div>
  );
};

const ManualMatchEditor = ({ matches, open, onOpenChange, onSaved }: ManualMatchEditorProps) => {
  const { toast } = useToast();
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    })
  );
  
  const [players, setPlayers] = useState<Player[]>(() => {
    const allPlayers: Player[] = [];
    matches.forEach((match) => {
      // Check if it's a BYE match (only player1)
      const isBye = match.player1_id && !match.player2_id && !match.player3_id && !match.player4_id;
      
      if (match.player1_id && match.player1) {
        allPlayers.push({
          id: `${match.id}-player1`,
          playerId: match.player1_id,
          name: match.player1.name,
          matchId: match.id,
          team: isBye ? 0 : 1,
        });
      }
      if (match.player2_id && match.player2) {
        allPlayers.push({
          id: `${match.id}-player2`,
          playerId: match.player2_id,
          name: match.player2.name,
          matchId: match.id,
          team: 2,
        });
      }
      if (match.player3_id && match.player3) {
        allPlayers.push({
          id: `${match.id}-player3`,
          playerId: match.player3_id,
          name: match.player3.name,
          matchId: match.id,
          team: 1,
        });
      }
      if (match.player4_id && match.player4) {
        allPlayers.push({
          id: `${match.id}-player4`,
          playerId: match.player4_id,
          name: match.player4.name,
          matchId: match.id,
          team: 2,
        });
      }
    });
    return allPlayers;
  });
  
  // Reinitialize player state when matches change
  useEffect(() => {
    const allPlayers: Player[] = [];
    matches.forEach((match) => {
      const isBye = match.player1_id && !match.player2_id && !match.player3_id && !match.player4_id;
      
      if (match.player1_id && match.player1) {
        allPlayers.push({
          id: `${match.id}-player1`,
          playerId: match.player1_id,
          name: match.player1.name,
          matchId: match.id,
          team: isBye ? 0 : 1,
        });
      }
      if (match.player2_id && match.player2) {
        allPlayers.push({
          id: `${match.id}-player2`,
          playerId: match.player2_id,
          name: match.player2.name,
          matchId: match.id,
          team: 2,
        });
      }
      if (match.player3_id && match.player3) {
        allPlayers.push({
          id: `${match.id}-player3`,
          playerId: match.player3_id,
          name: match.player3.name,
          matchId: match.id,
          team: 1,
        });
      }
      if (match.player4_id && match.player4) {
        allPlayers.push({
          id: `${match.id}-player4`,
          playerId: match.player4_id,
          name: match.player4.name,
          matchId: match.id,
          team: 2,
        });
      }
    });
    setPlayers(allPlayers);
  }, [matches]);
  
  const [activePlayer, setActivePlayer] = useState<Player | null>(null);
  const [saving, setSaving] = useState(false);

  const handleDragStart = (event: DragStartEvent) => {
    const player = players.find((p) => p.id === event.active.id);
    setActivePlayer(player || null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activePlayer = players.find((p) => p.id === active.id);
    if (!activePlayer) return;

    // Check if dropping over a droppable container
    const overContainerId = over.id as string;
    if (overContainerId.startsWith("match-") && overContainerId.includes("-team")) {
      // Extract match ID and team from container ID
      const [, matchId, teamStr] = overContainerId.match(/match-(.+)-team-(\d)/) || [];
      if (matchId && teamStr) {
        const team = parseInt(teamStr) as 0 | 1 | 2;
        
        // Update player's match and team
        setPlayers((prev) =>
          prev.map((p) =>
            p.id === activePlayer.id
              ? { ...p, matchId, team }
              : p
          )
        );
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActivePlayer(null);

    if (!over) return;

    const activePlayer = players.find((p) => p.id === active.id);
    const overPlayer = players.find((p) => p.id === over.id);

    if (!activePlayer) return;

    // If dropped on another player, swap positions
    if (overPlayer && activePlayer.id !== overPlayer.id) {
      setPlayers((prev) => {
        const newPlayers = [...prev];
        const activeIndex = newPlayers.findIndex((p) => p.id === activePlayer.id);
        const overIndex = newPlayers.findIndex((p) => p.id === overPlayer.id);
        
        // Update both players' match and team to match their new positions
        newPlayers[activeIndex] = {
          ...newPlayers[activeIndex],
          matchId: overPlayer.matchId,
          team: overPlayer.team,
        };
        newPlayers[overIndex] = {
          ...newPlayers[overIndex],
          matchId: activePlayer.matchId,
          team: activePlayer.team,
        };
        
        return newPlayers;
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);

    // Build match updates from current player assignments
    const matchUpdates: Record<string, Record<string, string | null>> = {};
    
    matches.forEach((match) => {
      matchUpdates[match.id] = {
        player1_id: null,
        player2_id: null,
        player3_id: null,
        player4_id: null,
      };
    });

    // Assign players to positions based on their match and team
    players.forEach((player) => {
      const matchPlayers = players.filter((p) => p.matchId === player.matchId);
      const isBye = matchPlayers.length === 1;
      
      if (isBye) {
        matchUpdates[player.matchId].player1_id = player.playerId;
      } else {
        const team1Players = matchPlayers.filter((p) => p.team === 1).sort((a, b) => a.id.localeCompare(b.id));
        const team2Players = matchPlayers.filter((p) => p.team === 2).sort((a, b) => a.id.localeCompare(b.id));
        
        if (team1Players[0]) matchUpdates[player.matchId].player1_id = team1Players[0].playerId;
        if (team1Players[1]) matchUpdates[player.matchId].player3_id = team1Players[1].playerId;
        if (team2Players[0]) matchUpdates[player.matchId].player2_id = team2Players[0].playerId;
        if (team2Players[1]) matchUpdates[player.matchId].player4_id = team2Players[1].playerId;
      }
    });

    // Update all matches in database
    try {
      for (const [matchId, updates] of Object.entries(matchUpdates)) {
        const { error } = await supabase
          .from("matches")
          .update(updates)
          .eq("id", matchId);

        if (error) throw error;
      }

      toast({
        title: "Matches updated",
        description: "Player assignments have been saved.",
      });
      onSaved();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error updating matches",
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  // Group players by match
  const matchesWithPlayers = matches.map((match) => {
    const matchPlayers = players.filter((p) => p.matchId === match.id);
    const team1 = matchPlayers.filter((p) => p.team === 1);
    const team2 = matchPlayers.filter((p) => p.team === 2);
    const bye = matchPlayers.filter((p) => p.team === 0);
    const isBye = bye.length > 0;
    
    return {
      match,
      team1,
      team2,
      bye,
      isBye,
    };
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Manually Arrange Players</DialogTitle>
          <DialogDescription className="text-base">
            Drag and drop players between teams and courts. You can move players from BYE to matches and between teams.
          </DialogDescription>
        </DialogHeader>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="space-y-4 py-4">
            {matchesWithPlayers.map(({ match, team1, team2, bye, isBye }) => (
              <Card key={match.id} className="p-4 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg">Court {match.court_number}</h3>
                  {isBye && (
                    <span className="text-sm font-semibold text-amber-600 bg-amber-100 px-3 py-1 rounded-full">
                      BYE
                    </span>
                  )}
                </div>

                {isBye ? (
                  <DroppableTeam
                    id={`match-${match.id}-team-0`}
                    players={bye}
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                    {/* Team 1 */}
                    <DroppableTeam
                      id={`match-${match.id}-team-1`}
                      players={team1}
                      label="Team 1"
                    />

                    {/* VS divider */}
                    <div className="flex justify-center items-center py-4 md:py-0">
                      <span className="text-2xl font-bold text-muted-foreground">VS</span>
                    </div>

                    {/* Team 2 */}
                    <DroppableTeam
                      id={`match-${match.id}-team-2`}
                      players={team2}
                      label="Team 2"
                    />
                  </div>
                )}
              </Card>
            ))}
          </div>

          <DragOverlay>
            {activePlayer ? (
              <Card className="p-2 flex items-center gap-2 bg-background opacity-90 shadow-lg border-2 border-primary">
                <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium">{activePlayer.name}</span>
              </Card>
            ) : null}
          </DragOverlay>
        </DndContext>

        <DialogFooter className="gap-3 sm:gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} size="lg" className="flex-1 sm:flex-1">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} size="lg" className="flex-1 sm:flex-1">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualMatchEditor;
