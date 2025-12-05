'use client';

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, GripVertical, X, Pencil } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import FormatSelector from "@/components/mixer/event/FormatSelector";
import EditPlayerDialog from "@/components/mixer/event/EditPlayerDialog";

interface Event {
  id: string;
  num_courts: number;
}

interface EventPlayer {
  id: string;
  player_id: string;
  strength_order: number;
  player_name: string;
  player_gender?: string;
}

interface SortablePlayerProps {
  player: EventPlayer;
  onRemove: (id: string) => void;
  onEdit: (player: EventPlayer) => void;
}

function SortablePlayer({ player, onRemove, onEdit }: SortablePlayerProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: player.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 sm:gap-4 p-4 sm:p-6 bg-card border-2 rounded-2xl hover:shadow-lg hover:border-primary/50 transition-all"
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing touch-none p-1 sm:p-2 hover:bg-muted rounded-lg transition-colors"
      >
        <GripVertical className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-base sm:text-lg font-semibold truncate">{player.player_name}</p>
        {player.player_gender && (
          <p className="text-xs text-muted-foreground capitalize">{player.player_gender}</p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onEdit(player)}
        className="hover:bg-muted flex-shrink-0"
      >
        <Pencil className="h-4 w-4 sm:h-5 sm:w-5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onRemove(player.id)}
        className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
      >
        <X className="h-4 w-4 sm:h-5 sm:w-5" />
      </Button>
    </div>
  );
}

interface PlayersTabProps {
  event: Event;
  onFormatUpdated?: () => void;
}

export default function PlayersTab({ event, onFormatUpdated }: PlayersTabProps) {
  const { toast } = useToast();
  const [players, setPlayers] = useState<EventPlayer[]>([]);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerGender, setNewPlayerGender] = useState<string>("male");
  const [newPlayer2Name, setNewPlayer2Name] = useState("");
  const [newPlayer2Gender, setNewPlayer2Gender] = useState<string>("male");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showFormatSelector, setShowFormatSelector] = useState(false);
  const [hasFormat, setHasFormat] = useState(false);
  const [matchFormat, setMatchFormat] = useState<string | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<EventPlayer | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    fetchPlayers();
    checkEventFormat();
  }, [event.id]);

  const checkEventFormat = async () => {
    const { data } = await supabase
      .from("events")
      .select("match_format")
      .eq("id", event.id)
      .single();
    
    setHasFormat(!!data?.match_format);
    setMatchFormat(data?.match_format || null);
  };

  const fetchPlayers = async () => {
    const { data, error } = await supabase
      .from("event_players")
      .select(`
        id,
        player_id,
        strength_order,
        players (name, gender)
      `)
      .eq("event_id", event.id)
      .order("strength_order");

    if (error) {
      toast({
        variant: "destructive",
        title: "Error fetching players",
        description: error.message,
      });
    } else {
      const formattedPlayers = (data || []).map((ep: any) => ({
        id: ep.id,
        player_id: ep.player_id,
        strength_order: ep.strength_order,
        player_name: ep.players?.name || "Unknown",
        player_gender: ep.players?.gender,
      }));
      setPlayers(formattedPlayers);
    }
    setLoading(false);
  };

  const handleAddPlayer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (adding) return;
    
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      toast({
        variant: "destructive",
        title: "Not logged in",
        description: "Please log in to add players.",
      });
      return;
    }

    setAdding(true);
    
    if (matchFormat === "round-robin") {
      if (!newPlayerName.trim() || !newPlayer2Name.trim()) {
        toast({
          variant: "destructive",
          title: "Both names required",
          description: "Please enter both partner names.",
        });
        setAdding(false);
        return;
      }

      setHasFormat(false);

      const { data: playersData, error: playersError } = await supabase
        .from("players")
        .insert([
          { user_id: user.id, name: newPlayerName.trim(), gender: newPlayerGender },
          { user_id: user.id, name: newPlayer2Name.trim(), gender: newPlayer2Gender }
        ])
        .select();

      if (playersError) {
        toast({
          variant: "destructive",
          title: "Error adding partners",
          description: playersError.message,
        });
        setAdding(false);
        return;
      }

      const { error: eventPlayersError } = await supabase
        .from("event_players")
        .insert([
          { event_id: event.id, player_id: playersData[0].id, strength_order: players.length },
          { event_id: event.id, player_id: playersData[1].id, strength_order: players.length + 1 },
        ]);

      if (eventPlayersError) {
        toast({
          variant: "destructive",
          title: "Error adding partners to event",
          description: eventPlayersError.message,
        });
      } else {
        toast({
          title: "Partners added",
          description: `${newPlayerName.trim()} & ${newPlayer2Name.trim()} are now partners.`,
        });
        setNewPlayerName("");
        setNewPlayer2Name("");
        setNewPlayerGender("male");
        setNewPlayer2Gender("male");
        fetchPlayers();
      }
      setAdding(false);
      return;
    }
    
    if (!newPlayerName.trim()) {
      toast({
        variant: "destructive",
        title: "Name required",
        description: "Please enter a player name.",
      });
      setAdding(false);
      return;
    }

    setHasFormat(false);
    
    const { data: player, error: playerError } = await supabase
      .from("players")
      .insert([{ user_id: user.id, name: newPlayerName.trim(), gender: newPlayerGender }])
      .select()
      .single();

    if (playerError) {
      toast({
        variant: "destructive",
        title: "Error adding player",
        description: playerError.message,
      });
      setAdding(false);
      return;
    }

    const { error: eventPlayerError } = await supabase
      .from("event_players")
      .insert([{ event_id: event.id, player_id: player.id, strength_order: players.length }]);

    if (eventPlayerError) {
      toast({
        variant: "destructive",
        title: "Error adding player to event",
        description: eventPlayerError.message,
      });
    } else {
      toast({
        title: "Player added",
        description: `${newPlayerName.trim()} has been added to the event.`,
      });
      setNewPlayerName("");
      setNewPlayerGender("male");
      fetchPlayers();
    }
    setAdding(false);
  };

  const handleFormatSelected = () => {
    setShowFormatSelector(false);
    checkEventFormat();
    if (onFormatUpdated) onFormatUpdated();
    toast({
      title: "Ready to play!",
      description: "You can now generate Round 1 in the Rounds tab.",
    });
  };

  const handleRemovePlayer = async (eventPlayerId: string) => {
    const { error } = await supabase
      .from("event_players")
      .delete()
      .eq("id", eventPlayerId);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error removing player",
        description: error.message,
      });
    } else {
      toast({
        title: "Player removed",
        description: "Player has been removed from the event.",
      });
      fetchPlayers();
    }
  };

  const handleDragEnd = async (dragEvent: DragEndEvent) => {
    const { active, over } = dragEvent;

    if (!over || active.id === over.id) return;

    const oldIndex = players.findIndex((p) => p.id === active.id);
    const newIndex = players.findIndex((p) => p.id === over.id);

    const newPlayers = arrayMove(players, oldIndex, newIndex);
    setPlayers(newPlayers);

    for (let i = 0; i < newPlayers.length; i++) {
      await supabase
        .from("event_players")
        .update({ strength_order: i })
        .eq("id", newPlayers[i].id);
    }
  };

  const minPlayers = event.num_courts * 2;

  if (showFormatSelector) {
    return (
      <FormatSelector
        eventId={event.id}
        playerCount={players.length}
        courtCount={event.num_courts}
        onFormatSelected={handleFormatSelected}
        onFormatUpdated={onFormatUpdated}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>TEST Players ({players.length})</CardTitle>
        <CardDescription>
          {matchFormat === "round-robin" 
            ? "Add partner pairs. Players added together will stay as partners throughout the event."
            : "Add players and drag to reorder by strength (strongest at top)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {matchFormat === "round-robin" ? (
          <form onSubmit={handleAddPlayer} className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 border-2 border-primary/20">
              <p className="text-sm font-medium mb-3 text-primary">Partner Pair</p>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <Input
                    placeholder="Partner 1 name"
                    value={newPlayerName}
                    onChange={(e) => setNewPlayerName(e.target.value)}
                    className="flex-1 h-12 text-base"
                  />
                  <Select value={newPlayerGender} onValueChange={setNewPlayerGender}>
                    <SelectTrigger className="w-[120px] h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-3">
                  <Input
                    placeholder="Partner 2 name"
                    value={newPlayer2Name}
                    onChange={(e) => setNewPlayer2Name(e.target.value)}
                    className="flex-1 h-12 text-base"
                  />
                  <Select value={newPlayer2Gender} onValueChange={setNewPlayer2Gender}>
                    <SelectTrigger className="w-[120px] h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <Button type="submit" disabled={adding} size="lg" className="w-full">
              <Plus className="h-5 w-5 mr-2" />
              {adding ? "Adding..." : "Add Partner Pair"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleAddPlayer} className="flex gap-3">
            <Input
              placeholder="Player name"
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
              className="flex-1 h-12 text-base"
            />
            <Select value={newPlayerGender} onValueChange={setNewPlayerGender}>
              <SelectTrigger className="w-[120px] h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={adding} size="lg" className="px-6">
              <Plus className="h-5 w-5 mr-2" />
              {adding ? "..." : "Add"}
            </Button>
          </form>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : players.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No players added yet. Start by adding players above.</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={players} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {players.map((player, index) => {
                  const pairNumber = matchFormat === "round-robin" ? Math.floor(index / 2) + 1 : null;
                  const isPartner1 = matchFormat === "round-robin" && index % 2 === 0;
                  
                  return (
                    <div key={player.id} className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shadow-md ${
                        matchFormat === "round-robin" 
                          ? isPartner1 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                          : "bg-primary text-primary-foreground"
                      }`}>
                        {matchFormat === "round-robin" ? pairNumber : index + 1}
                      </div>
                      <div className="flex-1">
                        <SortablePlayer 
                          player={player} 
                          onRemove={handleRemovePlayer}
                          onEdit={setEditingPlayer}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {players.length > 0 && players.length < minPlayers && (
          <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
            Add at least {minPlayers - players.length} more {minPlayers - players.length === 1 ? "player" : "players"} to fill all courts
          </p>
        )}

        {players.length >= 4 && !hasFormat && (
          <Button 
            type="button"
            onClick={() => setShowFormatSelector(true)} 
            size="lg" 
            className="w-full"
          >
            Choose Match Format
          </Button>
        )}

        {hasFormat && (
          <div className="bg-primary/10 border-2 border-primary/30 rounded-lg p-4 text-center space-y-2">
            <p className="text-sm font-medium text-primary">
              Format selected! Go to Rounds tab to start.
            </p>
            <Button 
              type="button"
              variant="ghost" 
              size="lg"
              onClick={() => setShowFormatSelector(true)}
              className="w-full touch-manipulation"
            >
              Change Format
            </Button>
          </div>
        )}
      </CardContent>

      {editingPlayer && (
        <EditPlayerDialog
          playerId={editingPlayer.player_id}
          playerName={editingPlayer.player_name}
          playerGender={editingPlayer.player_gender}
          open={!!editingPlayer}
          onOpenChange={(open) => !open && setEditingPlayer(null)}
          onPlayerUpdated={fetchPlayers}
        />
      )}
    </Card>
  );
}

