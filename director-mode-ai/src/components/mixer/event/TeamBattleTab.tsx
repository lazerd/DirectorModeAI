'use client';

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, GripVertical, X, Trophy, Users } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Team {
  id: string;
  name: string;
  color: string;
}

interface Player {
  id: string;
  event_player_id: string;
  player_id: string;
  name: string;
  team_id: string | null;
  strength_order: number;
  wins: number;
  losses: number;
}

interface TeamBattleTabProps {
  event: {
    id: string;
    num_courts: number;
  };
  onSwitchToRounds?: () => void;
}

function SortablePlayer({ player, teamColor, onRemove }: { player: Player; teamColor: string; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: player.event_player_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-3 bg-white border-2 rounded-xl hover:shadow-md transition-all"
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing touch-none p-1 hover:bg-gray-100 rounded"
      >
        <GripVertical className="h-4 w-4 text-gray-400" />
      </button>
      <div 
        className="w-2 h-8 rounded-full flex-shrink-0" 
        style={{ backgroundColor: teamColor }}
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{player.name}</p>
        <p className="text-xs text-gray-500">{player.wins}W - {player.losses}L</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onRemove(player.event_player_id)}
        className="text-gray-400 hover:text-red-500 flex-shrink-0"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function TeamBattleTab({ event, onSwitchToRounds }: TeamBattleTabProps) {
  const { toast } = useToast();
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [addingToTeam, setAddingToTeam] = useState<string | null>(null);
  const [teamScores, setTeamScores] = useState<Record<string, number>>({});

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    fetchTeams();
    fetchPlayers();
    fetchTeamScores();
  }, [event.id]);

  const fetchTeams = async () => {
    const { data, error } = await supabase
      .from("event_teams")
      .select("*")
      .eq("event_id", event.id)
      .order("created_at");

    if (error) {
      toast({ variant: "destructive", title: "Error fetching teams", description: error.message });
    } else {
      setTeams(data || []);
    }
  };

  const fetchPlayers = async () => {
    const { data, error } = await supabase
      .from("event_players")
      .select(`
        id,
        player_id,
        team_id,
        strength_order,
        wins,
        losses,
        players(name)
      `)
      .eq("event_id", event.id)
      .order("strength_order");

    if (error) {
      toast({ variant: "destructive", title: "Error fetching players", description: error.message });
    } else {
      const formattedPlayers = (data || []).map((ep: any) => ({
        id: ep.player_id,
        event_player_id: ep.id,
        player_id: ep.player_id,
        name: ep.players?.name || "Unknown",
        team_id: ep.team_id,
        strength_order: ep.strength_order,
        wins: ep.wins || 0,
        losses: ep.losses || 0,
      }));
      setPlayers(formattedPlayers);
    }
    setLoading(false);
  };

  const fetchTeamScores = async () => {
    // Calculate team scores from completed matches
    const { data: rounds } = await supabase
      .from("rounds")
      .select("id")
      .eq("event_id", event.id);

    if (!rounds || rounds.length === 0) {
      setTeamScores({});
      return;
    }

    const roundIds = rounds.map(r => r.id);
    
    const { data: matches } = await supabase
      .from("matches")
      .select("winner_team, player1_id, player2_id")
      .in("round_id", roundIds)
      .not("winner_team", "is", null);

    if (!matches) {
      setTeamScores({});
      return;
    }

    // Get player team assignments
    const { data: eventPlayers } = await supabase
      .from("event_players")
      .select("player_id, team_id")
      .eq("event_id", event.id);

    if (!eventPlayers) return;

    const playerTeamMap: Record<string, string> = {};
    eventPlayers.forEach(ep => {
      if (ep.team_id) playerTeamMap[ep.player_id] = ep.team_id;
    });

    // Count wins per team
    const scores: Record<string, number> = {};
    matches.forEach(match => {
      const winnerPlayerId = match.winner_team === 1 ? match.player1_id : match.player2_id;
      if (winnerPlayerId && playerTeamMap[winnerPlayerId]) {
        const teamId = playerTeamMap[winnerPlayerId];
        scores[teamId] = (scores[teamId] || 0) + 1;
      }
    });

    setTeamScores(scores);
  };

  const handleAddPlayer = async (teamId: string) => {
    if (!newPlayerName.trim()) {
      toast({ variant: "destructive", title: "Name required", description: "Please enter a player name." });
      return;
    }

    setAddingToTeam(teamId);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Not logged in", description: "Please log in to add players." });
      setAddingToTeam(null);
      return;
    }

    // Create player
    const { data: player, error: playerError } = await supabase
      .from("players")
      .insert([{ user_id: user.id, name: newPlayerName.trim() }])
      .select()
      .single();

    if (playerError) {
      toast({ variant: "destructive", title: "Error adding player", description: playerError.message });
      setAddingToTeam(null);
      return;
    }

    // Get current team player count for strength order
    const teamPlayers = players.filter(p => p.team_id === teamId);
    
    // Add to event with team assignment
    const { error: eventPlayerError } = await supabase
      .from("event_players")
      .insert([{ 
        event_id: event.id, 
        player_id: player.id, 
        team_id: teamId,
        strength_order: teamPlayers.length 
      }]);

    if (eventPlayerError) {
      toast({ variant: "destructive", title: "Error adding player to team", description: eventPlayerError.message });
    } else {
      toast({ title: "Player added!", description: `${newPlayerName.trim()} joined the team.` });
      setNewPlayerName("");
      fetchPlayers();
    }
    setAddingToTeam(null);
  };

  const handleRemovePlayer = async (eventPlayerId: string) => {
    const { error } = await supabase
      .from("event_players")
      .delete()
      .eq("id", eventPlayerId);

    if (error) {
      toast({ variant: "destructive", title: "Error removing player", description: error.message });
    } else {
      toast({ title: "Player removed" });
      fetchPlayers();
    }
  };

  const handleDragEnd = async (dragEvent: DragEndEvent, teamId: string) => {
    const { active, over } = dragEvent;
    if (!over || active.id === over.id) return;

    const teamPlayers = players.filter(p => p.team_id === teamId);
    const oldIndex = teamPlayers.findIndex(p => p.event_player_id === active.id);
    const newIndex = teamPlayers.findIndex(p => p.event_player_id === over.id);

    const reordered = arrayMove(teamPlayers, oldIndex, newIndex);
    
    // Update local state
    const otherPlayers = players.filter(p => p.team_id !== teamId);
    setPlayers([...otherPlayers, ...reordered.map((p, i) => ({ ...p, strength_order: i }))]);

    // Update database
    for (let i = 0; i < reordered.length; i++) {
      await supabase
        .from("event_players")
        .update({ strength_order: i })
        .eq("id", reordered[i].event_player_id);
    }
  };

  const getTeamPlayers = (teamId: string) => {
    return players
      .filter(p => p.team_id === teamId)
      .sort((a, b) => a.strength_order - b.strength_order);
  };

  const totalPlayers = players.length;
  const canGenerateRounds = teams.length === 2 && 
    getTeamPlayers(teams[0]?.id).length >= 1 && 
    getTeamPlayers(teams[1]?.id).length >= 1;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Team Score Header */}
      {teams.length === 2 && (
        <Card className="bg-gradient-to-r from-blue-50 via-white to-red-50 border-2">
          <CardContent className="py-6">
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div 
                  className="w-4 h-4 rounded-full mx-auto mb-2"
                  style={{ backgroundColor: teams[0].color }}
                />
                <p className="font-bold text-lg">{teams[0].name}</p>
                <p className="text-4xl font-black" style={{ color: teams[0].color }}>
                  {teamScores[teams[0].id] || 0}
                </p>
              </div>
              <div className="text-center">
                <Trophy className="h-8 w-8 text-yellow-500 mx-auto" />
                <p className="text-sm text-gray-500 mt-1">Match Wins</p>
              </div>
              <div className="text-center">
                <div 
                  className="w-4 h-4 rounded-full mx-auto mb-2"
                  style={{ backgroundColor: teams[1].color }}
                />
                <p className="font-bold text-lg">{teams[1].name}</p>
                <p className="text-4xl font-black" style={{ color: teams[1].color }}>
                  {teamScores[teams[1].id] || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Team Columns */}
      <div className="grid md:grid-cols-2 gap-6">
        {teams.map((team) => {
          const teamPlayers = getTeamPlayers(team.id);
          
          return (
            <Card key={team.id} className="border-2" style={{ borderColor: team.color + '40' }}>
              <CardHeader className="pb-3" style={{ backgroundColor: team.color + '10' }}>
                <CardTitle className="flex items-center gap-3">
                  <div 
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: team.color }}
                  />
                  <span>{team.name}</span>
                  <span className="text-sm font-normal text-gray-500">
                    ({teamPlayers.length} players)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* Add Player Form */}
                <div className="flex gap-2">
                  <Input
                    placeholder="Player name"
                    value={addingToTeam === team.id ? newPlayerName : ""}
                    onChange={(e) => {
                      setAddingToTeam(team.id);
                      setNewPlayerName(e.target.value);
                    }}
                    onFocus={() => setAddingToTeam(team.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddPlayer(team.id);
                      }
                    }}
                    className="flex-1 bg-white"
                  />
                  <Button 
                    onClick={() => handleAddPlayer(team.id)}
                    disabled={addingToTeam === team.id && !newPlayerName.trim()}
                    size="icon"
                    style={{ backgroundColor: team.color }}
                    className="hover:opacity-90"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Player List */}
                {teamPlayers.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No players yet</p>
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => handleDragEnd(e, team.id)}
                  >
                    <SortableContext items={teamPlayers.map(p => p.event_player_id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {teamPlayers.map((player, index) => (
                          <div key={player.event_player_id} className="flex items-center gap-2">
                            <div 
                              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                              style={{ backgroundColor: team.color }}
                            >
                              {index + 1}
                            </div>
                            <div className="flex-1">
                              <SortablePlayer
                                player={player}
                                teamColor={team.color}
                                onRemove={handleRemovePlayer}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Generate Rounds Button */}
      {canGenerateRounds && (
        <Button 
          onClick={onSwitchToRounds}
          size="lg"
          className="w-full h-14 text-lg bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700"
        >
          <Trophy className="h-5 w-5 mr-2" />
          Continue to Rounds ({totalPlayers} players ready)
        </Button>
      )}

      {!canGenerateRounds && teams.length === 2 && (
        <p className="text-center text-gray-500">
          Add at least 1 player to each team to continue
        </p>
      )}
    </div>
  );
}
