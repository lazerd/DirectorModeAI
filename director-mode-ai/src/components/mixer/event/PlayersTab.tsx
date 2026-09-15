'use client';

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, GripVertical, X, Pencil, Play, Database, Check } from "lucide-react";
import VaultPicker from "@/components/shared/VaultPicker";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import FormatSelector from "@/components/mixer/event/FormatSelector";
import EditPlayerDialog from "@/components/mixer/event/EditPlayerDialog";
import { RoundGenerator } from "@/lib/advancedMatchGeneration";
import { resolveCourtList } from "@/lib/quads";

interface Event {
  id: string;
  num_courts: number;
  match_format?: string | null;
  court_names?: string[] | null;
}

interface EventPlayer {
  id: string;
  player_id: string;
  strength_order: number;
  player_name: string;
  player_gender?: string;
  /**
   * Checked in and standing on a court. `event_players.active` already
   * existed and defaulted true; nothing read it, so a no-show still got put
   * into a match and three other people stood waiting for them.
   */
  active: boolean;
}

interface SortablePlayerProps {
  player: EventPlayer;
  onToggle: (id: string, next: boolean) => void;
  onRemove: (id: string) => void;
  onEdit: (player: EventPlayer) => void;
}

function SortablePlayer({ player, onToggle, onRemove, onEdit }: SortablePlayerProps) {
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
      className={`flex items-center gap-2 sm:gap-4 p-4 sm:p-6 bg-card border-2 rounded-2xl transition-all ${
        player.active
          ? 'hover:shadow-lg hover:border-primary/50'
          : // Absent players stay visible but recede — they arrive late and
            // need to be found again in one tap.
            'opacity-45 border-dashed'
      }`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing touch-none p-1 sm:p-2 hover:bg-muted rounded-lg transition-colors"
      >
        <GripVertical className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
      </button>

      {/*
        Check-in, as a CHECKBOX.
        
        It was a badge reading HERE or OUT, which was ambiguous in the worst
        way: a word describing the current state, on the control that changes
        it. A director read HERE as "tap this to check them in" and tapped it
        on everyone who had arrived — marking all of them absent. He got down
        to one checked-in player before working out it was inverted.
        
        A checkbox cannot be misread. Ticked means here; tapping a ticked box
        unticks it, which everybody already knows. Sized for a thumb, because
        this is used standing on court with people saying hello.
      */}
      <button
        type="button"
        role="checkbox"
        aria-checked={player.active}
        aria-label={`${player.player_name} is here`}
        onClick={() => onToggle(player.id, !player.active)}
        title={player.active ? 'Here — tap to mark absent' : 'Absent — tap to check in'}
        className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border-2 transition-colors ${
          player.active
            ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
            : 'border-muted-foreground/30 bg-transparent text-transparent hover:border-muted-foreground/60'
        }`}
      >
        <Check className="h-6 w-6" strokeWidth={3} />
      </button>

      <div className="flex-1 min-w-0">
        <p
          className={`text-base sm:text-lg font-semibold truncate ${
            player.active ? '' : 'line-through decoration-1'
          }`}
        >
          {player.player_name}
        </p>
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
  onSwitchToRounds?: () => void;
}

export default function PlayersTab({ event, onFormatUpdated, onSwitchToRounds }: PlayersTabProps) {
  const { toast } = useToast();
  
  const [players, setPlayers] = useState<EventPlayer[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerGender, setNewPlayerGender] = useState<string>("male");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showFormatSelector, setShowFormatSelector] = useState(false);
  const [hasFormat, setHasFormat] = useState(false);
  const [matchFormat, setMatchFormat] = useState<string | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<EventPlayer | null>(null);
  const [hasRounds, setHasRounds] = useState(false);
  const [showVaultPicker, setShowVaultPicker] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    fetchPlayers();
    checkEventFormat();
    checkExistingRounds();
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

  const checkExistingRounds = async () => {
    const { data } = await supabase
      .from("rounds")
      .select("id")
      .eq("event_id", event.id)
      .limit(1);
    
    setHasRounds((data?.length || 0) > 0);
  };

  const fetchPlayers = async () => {
    const { data, error } = await supabase
      .from("event_players")
      .select(`
        id,
        player_id,
        strength_order,
        active,
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
        // Older rows predate check-in and are null; a registered player with
        // no explicit answer is treated as here, which is what the column's
        // own default says.
        active: ep.active !== false,
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
    
    if (!newPlayerName.trim()) {
      toast({
        variant: "destructive",
        title: "Name required",
        description: "Please enter a player name.",
      });
      setAdding(false);
      return;
    }

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

  const handleVaultImport = async (vaultPlayers: { id: string; full_name: string; gender: string | null; email: string | null }[]) => {
    setShowVaultPicker(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    for (const vp of vaultPlayers) {
      const { data: player } = await supabase
        .from("players")
        .insert([{ user_id: user.id, name: vp.full_name, gender: vp.gender === 'female' ? 'female' : 'male' }])
        .select()
        .single();

      if (player) {
        await supabase
          .from("event_players")
          .insert([{ event_id: event.id, player_id: player.id, strength_order: players.length }]);
      }
    }

    toast({
      title: "Players imported",
      description: `${vaultPlayers.length} player${vaultPlayers.length !== 1 ? 's' : ''} imported from PlayerVault.`,
    });
    fetchPlayers();
  };

  /**
   * Check someone in or out.
   *
   * Optimistic: the tap lands while a player is standing there saying hello,
   * so the button must change colour now and reconcile after. On failure it
   * goes back and says so — silently keeping a wrong state would put a no-show
   * into a match.
   */
  const handleToggleActive = async (rowId: string, next: boolean) => {
    setPlayers((prev) => prev.map((p) => (p.id === rowId ? { ...p, active: next } : p)));

    const { error } = await supabase
      .from("event_players")
      .update({ active: next })
      .eq("id", rowId);

    if (error) {
      setPlayers((prev) => prev.map((p) => (p.id === rowId ? { ...p, active: !next } : p)));
      toast({
        variant: "destructive",
        title: "Could not save check-in",
        description: error.message,
      });
    }
  };

  /**
   * Check everyone in, or everyone out.
   *
   * One statement rather than a loop of updates: seventeen sequential requests
   * from a phone on club wifi is a visibly slow button, and a half-finished
   * loop leaves the roster in a state nobody chose.
   */
  const handleSetAllActive = async (next: boolean) => {
    setBulkBusy(true);
    const before = players;
    setPlayers((prev) => prev.map((p) => ({ ...p, active: next })));

    const { error } = await supabase
      .from("event_players")
      .update({ active: next })
      .eq("event_id", event.id);

    if (error) {
      setPlayers(before);
      toast({
        variant: "destructive",
        title: "Could not update check-in",
        description: error.message,
      });
    }
    setBulkBusy(false);
  };

  /** Everyone here to play — the only people a round may be built from. */
  const presentPlayers = players.filter((p) => p.active);

  const handleGenerateRound1 = async () => {
    if (!matchFormat) {
      toast({
        variant: "destructive",
        title: "No format selected",
        description: "Please select a match format first.",
      });
      return;
    }

    const minPlayers = matchFormat === 'singles' ? 2 : 4;
    // Counted on who is HERE, not who registered. Nineteen signed up and
    // fourteen turned up is the normal case for a social.
    if (presentPlayers.length < minPlayers) {
      toast({
        variant: "destructive",
        title: "Not enough players checked in",
        description:
          players.length >= minPlayers
            ? `${presentPlayers.length} of ${players.length} are checked in. Need ${minPlayers} for ${matchFormat}.`
            : `Need at least ${minPlayers} players for ${matchFormat}.`,
      });
      return;
    }

    // A Wild Card builds every round at once from the Rounds tab panel.
    if (matchFormat === 'wild-card') {
      onSwitchToRounds?.();
      return;
    }

    setGenerating(true);

    // Fetch full player data
    const { data: eventPlayers, error: playersError } = await supabase
      .from("event_players")
      .select(`
        player_id,
        wins,
        losses,
        games_won,
        games_lost,
        players(name, gender)
      `)
      .eq("event_id", event.id)
      // The whole point of check-in. Without this a no-show is put into a
      // match and three other people stand on a court waiting for them.
      .eq("active", true)
      .order("strength_order");

    if (playersError || !eventPlayers) {
      toast({
        variant: "destructive",
        title: "Error fetching players",
        description: playersError?.message || "Could not load players.",
      });
      setGenerating(false);
      return;
    }

    const playerData = eventPlayers.map((ep: any) => ({
      player_id: ep.player_id,
      name: ep.players.name,
      gender: ep.players.gender,
      wins: ep.wins || 0,
      losses: ep.losses || 0,
      games_won: ep.games_won || 0,
      games_lost: ep.games_lost || 0,
    }));

    // Generate round
    const generator = new RoundGenerator(playerData, event.num_courts, matchFormat);
    const pairings = generator.generateMultipleRounds(1)[0];

    // Create round in database
    const { data: round, error: roundError } = await supabase
      .from("rounds")
      .insert([{
        event_id: event.id,
        round_number: 1,
        status: "upcoming",
      }])
      .select()
      .single();

    if (roundError) {
      toast({
        variant: "destructive",
        title: "Error creating round",
        description: roundError.message,
      });
      setGenerating(false);
      return;
    }

    // Create matches — stamp the actual court number for each court slot.
    const courtList = resolveCourtList({ courtNames: event.court_names, numCourts: event.num_courts });
    const courtFor = (idx: number) => {
      const n = parseInt(courtList[idx], 10);
      return Number.isFinite(n) ? n : idx + 1;
    };
    const matchInserts = pairings.map((pairing, idx) => ({
      round_id: round.id,
      court_number: courtFor(idx),
      ...pairing,
    }));

    const { error: matchError } = await supabase.from("matches").insert(matchInserts);

    if (matchError) {
      toast({
        variant: "destructive",
        title: "Error creating matches",
        description: matchError.message,
      });
      setGenerating(false);
      return;
    }

    toast({
      title: "Round 1 created!",
      description: "Switching to Rounds tab...",
    });

    setGenerating(false);
    setHasRounds(true);

    // Switch to Rounds tab
    if (onSwitchToRounds) {
      setTimeout(() => onSwitchToRounds(), 500);
    }
  };

  const handleFormatSelected = () => {
    setShowFormatSelector(false);
    checkEventFormat();
    if (onFormatUpdated) onFormatUpdated();
    toast({
      title: "Format selected!",
      description: "Now you can generate Round 1.",
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

  const minPlayersRequired = matchFormat === 'singles' ? 2 : 4;
  /*
   * Whether to SHOW the button, and separately whether it can be pressed.
   *
   * These were one condition, which was a bad bug: marking players out took
   * the count below the minimum and the button silently VANISHED. From the
   * director's side the feature had broken — he had checked one person in,
   * Generate Round 1 was gone, and nothing on screen said why.
   *
   * A control that cannot act right now must stay visible and say what is
   * missing. Only an event that already has rounds hides it.
   */
  const showGenerateRound = hasFormat && !hasRounds;
  const enoughCheckedIn = presentPlayers.length >= minPlayersRequired;

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
        <CardTitle>Players ({players.length})</CardTitle>
        <CardDescription>
          Add players and drag to reorder by strength (strongest at top).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleAddPlayer} className="flex gap-3">
          <Input
            placeholder="Player name"
            value={newPlayerName}
            onChange={(e) => setNewPlayerName(e.target.value)}
            className="flex-1 h-12 text-base bg-white"
          />
          <Select value={newPlayerGender} onValueChange={setNewPlayerGender}>
            <SelectTrigger className="w-[120px] h-12 bg-white">
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
        <Button variant="outline" onClick={() => setShowVaultPicker(true)} className="w-full">
          <Database className="h-4 w-4 mr-2" />
          Import from PlayerVault
        </Button>

        {/*
          Start from either end, in one tap.
          
          Two clubs run this two opposite ways. Most socials have most people
          turn up, so everyone starts checked in and you tap the no-shows out.
          But a director who wants a real arrival desk wants the opposite:
          everyone out, check them in at the gate. Defaulting to one and making
          the other twenty taps would be picking a side, so this picks neither.
        */}
        {!loading && players.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2">
            <p className="text-sm font-semibold">
              <span className="text-emerald-600">{presentPlayers.length} here</span>
              {presentPlayers.length < players.length && (
                <span className="text-muted-foreground">
                  {' '}
                  · {players.length - presentPlayers.length} out
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkBusy || presentPlayers.length === players.length}
                onClick={() => handleSetAllActive(true)}
              >
                Mark all here
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkBusy || presentPlayers.length === 0}
                onClick={() => handleSetAllActive(false)}
              >
                Mark all out
              </Button>
            </div>
          </div>
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
                {players.map((player, index) => (
                  <div key={player.id} className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shadow-md bg-primary text-primary-foreground">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <SortablePlayer 
                        player={player} 
                        onToggle={handleToggleActive}
                        onRemove={handleRemovePlayer}
                        onEdit={setEditingPlayer}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {players.length > 0 && players.length < minPlayersRequired && (
          <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
            Add at least {minPlayersRequired - players.length} more player(s) to start
          </p>
        )}

        {/* Format Selection */}
        {players.length >= 2 && !hasFormat && (
          <Button 
            type="button"
            onClick={() => setShowFormatSelector(true)} 
            size="lg" 
            className="w-full"
          >
            Choose Match Format
          </Button>
        )}

        {/* Generate Round 1 Button - Big and prominent! */}
        {showGenerateRound && (
          <>
            {/*
              Says WHO the round will be built from, before it is built.
              
              The count on the button is the whole reassurance: a director about
              to press this needs to know it is fourteen of nineteen and not all
              nineteen, without counting green badges up the screen.
            */}
            <Button 
              type="button"
              onClick={handleGenerateRound1}
              disabled={generating || !enoughCheckedIn}
              size="lg" 
              className="w-full h-16 text-xl bg-green-600 hover:bg-green-700"
            >
              <Play className="h-6 w-6 mr-3" />
              {generating
                ? "Generating..."
                : enoughCheckedIn
                  ? matchFormat === 'wild-card'
                    ? `Build the Wild Card schedule — ${presentPlayers.length} checked in`
                    : `Generate Round 1 — ${presentPlayers.length} checked in`
                  : `Check in ${minPlayersRequired - presentPlayers.length} more to start`}
            </Button>
            {!enoughCheckedIn ? (
              // Says what is missing, on the screen, rather than removing the
              // control and leaving the director to guess.
              <p className="text-center text-sm text-muted-foreground">
                {presentPlayers.length} of {players.length} checked in.{' '}
                {matchFormat === 'singles' ? 'Singles' : 'Doubles'} needs at least{' '}
                {minPlayersRequired}. Tick someone&apos;s box to check them in, or{' '}
                <span className="font-semibold">Mark all here</span> above.
              </p>
            ) : presentPlayers.length < players.length ? (
              <p className="text-center text-sm text-muted-foreground">
                {players.length - presentPlayers.length} unticked and will be left out of the
                round. Tick their box to add them back.
              </p>
            ) : null}
          </>
        )}

        {/* Already has rounds */}
        {hasRounds && (
          <div className="bg-green-100 border-2 border-green-300 rounded-lg p-4 text-center">
            <p className="text-green-800 font-medium">
              ✅ Round already generated! Go to Rounds tab to continue.
            </p>
          </div>
        )}

        {/* Change Format Option */}
        {hasFormat && !hasRounds && (
          <Button 
            type="button"
            variant="outline" 
            size="lg"
            onClick={() => setShowFormatSelector(true)}
            className="w-full"
          >
            Change Format ({matchFormat})
          </Button>
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
      {showVaultPicker && (
        <VaultPicker
          onSelect={() => {}}
          onClose={() => setShowVaultPicker(false)}
          multiSelect
          onMultiSelect={handleVaultImport}
        />
      )}
    </Card>
  );
}
