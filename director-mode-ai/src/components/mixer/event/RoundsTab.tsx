
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Play, Plus, Check, RotateCcw, ChevronLeft, ChevronRight, Shuffle, Edit, Users, Trash2 } from "lucide-react";
import RoundTimer from "@/components/mixer/event/RoundTimer";
import MatchScoreDialog from "@/components/mixer/event/MatchScoreDialog";
import TournamentMatchScoreDialog from "@/components/mixer/event/TournamentMatchScoreDialog";
import RoundGenerationDialog from "@/components/mixer/event/RoundGenerationDialog";
import ManualMatchEditor from "@/components/mixer/event/ManualMatchEditor";
import ManagePlayersDialog from "@/components/mixer/event/ManagePlayersDialog";
import { RoundGenerator, type GenerationMode } from "@/lib/advancedMatchGeneration";
import { resolveCourtList } from "@/lib/quads";

interface Event {
  id: string;
  num_courts: number;
  scoring_format: string;
  round_length_minutes: number | null;
  match_format: string | null;
  target_games: number | null;
  team_battle_singles_courts?: number;
  team_battle_doubles_courts?: number;
  court_names?: string[] | null;
}

interface Round {
  id: string;
  round_number: number;
  status: string;
  start_time: string | null;
  end_time: string | null;
  timer_paused_at: string | null;
}

interface Match {
  id: string;
  court_number: number;
  team1_score: number;
  team2_score: number;
  winner_team: number | null;
  tiebreaker_winner: number | null;
  round_id: string;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  player1: { name: string } | null;
  player2: { name: string } | null;
  player3: { name: string } | null;
  player4: { name: string } | null;
}

interface RoundsTabProps {
  event: Event;
}

const RoundsTab = ({ event }: RoundsTabProps) => {
  const { toast } = useToast();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [currentRound, setCurrentRound] = useState<Round | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [showMultiRoundDialog, setShowMultiRoundDialog] = useState(false);
  const [showScoreDialog, setShowScoreDialog] = useState(false);
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [showManagePlayers, setShowManagePlayers] = useState(false);

  const isTeamBattle = event.match_format === 'team-battle';

  // The actual court numbers in use, in court order. Uses the event's custom
  // court_names (e.g. ["2","3","4","5"]) when set, else 1..num_courts.
  const courtList = resolveCourtList({ courtNames: event.court_names, numCourts: event.num_courts });
  // The court number to stamp on the match in the idx-th court slot.
  const courtFor = (idx: number) => {
    const n = parseInt(courtList[idx], 10);
    return Number.isFinite(n) ? n : idx + 1;
  };

  useEffect(() => {
    fetchRounds();
  }, [event.id]);

  const fetchRounds = async (targetRoundId?: string) => {
    const { data, error } = await supabase
      .from("rounds")
      .select("*")
      .eq("event_id", event.id)
      .order("round_number");

    if (error) {
      toast({
        variant: "destructive",
        title: "Error fetching rounds",
        description: error.message,
      });
    } else {
      setRounds(data || []);
      
      const roundToFind = targetRoundId || selectedRoundId;
      if (roundToFind) {
        const selected = data?.find((r) => r.id === roundToFind);
        if (selected) {
          setCurrentRound(selected);
          setSelectedRoundId(selected.id);
          fetchMatches(selected.id);
          setLoading(false);
          return;
        }
      }

      const inProgress = data?.find((r) => r.status === "in_progress");
      if (inProgress) {
        setCurrentRound(inProgress);
        setSelectedRoundId(inProgress.id);
        fetchMatches(inProgress.id);
      } else {
        const upcoming = data?.find((r) => r.status === "upcoming");
        if (upcoming) {
          setCurrentRound(upcoming);
          setSelectedRoundId(upcoming.id);
          fetchMatches(upcoming.id);
        } else if (data && data.length > 0) {
          const lastRound = data[data.length - 1];
          setCurrentRound(lastRound);
          setSelectedRoundId(lastRound.id);
          fetchMatches(lastRound.id);
        }
      }
    }
    setLoading(false);
  };

  const fetchMatches = async (roundId: string) => {
    const { data, error } = await supabase
      .from("matches")
      .select(`
        *,
        player1:players!matches_player1_id_fkey(name),
        player2:players!matches_player2_id_fkey(name),
        player3:players!matches_player3_id_fkey(name),
        player4:players!matches_player4_id_fkey(name)
      `)
      .eq("round_id", roundId)
      .order("court_number");

    if (error) {
      toast({
        variant: "destructive",
        title: "Error fetching matches",
        description: error.message,
      });
    } else {
      setMatches(data || []);
    }
  };

  const generateMultipleRoundsHandler = async (numRounds: number, randomize: boolean = true) => {
    setGenerating(true);

    const { data: playerCountData } = await supabase
      .from("event_players")
      .select("player_id")
      .eq("event_id", event.id);
    
    const playerCount = playerCountData?.length || 0;
    
    let matchFormat = event.match_format;
    const wasAutoDetected = !matchFormat;
    
    if (!matchFormat) {
      if (playerCount === event.num_courts * 2) {
        matchFormat = "singles";
      } else if (playerCount === event.num_courts * 4) {
        matchFormat = "doubles";
      } else {
        matchFormat = "maximize-courts";
      }
    }

    if (!matchFormat) {
      toast({
        variant: "destructive",
        title: "No format selected",
        description: "Please select a match format in the Players tab first.",
      });
      setGenerating(false);
      return;
    }

    if (wasAutoDetected) {
      const formatNames: Record<string, string> = {
        singles: "Singles",
        doubles: "Doubles",
        "maximize-courts": "Optimize Courts"
      };
      toast({
        title: `Auto-selected ${formatNames[matchFormat]} format`,
        description: `Based on ${playerCount} players and ${event.num_courts} court(s)`,
      });
    }

    // Fetch players with team_id for team battles
    const { data: eventPlayers, error: playersError } = await supabase
      .from("event_players")
      .select(`
        player_id,
        team_id,
        wins,
        losses,
        games_won,
        games_lost,
        strength_order,
        players(name, gender)
      `)
      .eq("event_id", event.id)
      .eq("active", true)
      .order("strength_order");

    const minPlayers = matchFormat === 'singles' || matchFormat === 'team-battle' ? 2 : 4;
    if (playersError || !eventPlayers || eventPlayers.length < minPlayers) {
      toast({
        variant: "destructive",
        title: "Not enough players",
        description: `Need at least ${minPlayers} players to generate rounds.`,
      });
      setGenerating(false);
      return;
    }

    const playerData = eventPlayers.map((ep: any) => ({
      player_id: ep.player_id,
      name: ep.players.name,
      gender: ep.players.gender,
      wins: ep.wins,
      losses: ep.losses,
      games_won: ep.games_won,
      games_lost: ep.games_lost,
      team_id: ep.team_id,
      strength_order: ep.strength_order,
    }));

    // For team battle, get team IDs
    let teamBattleConfig = null;
    if (matchFormat === 'team-battle') {
      const { data: teams } = await supabase
        .from("event_teams")
        .select("id")
        .eq("event_id", event.id)
        .order("created_at");

      if (!teams || teams.length < 2) {
        toast({
          variant: "destructive",
          title: "Teams not configured",
          description: "Please set up both teams first.",
        });
        setGenerating(false);
        return;
      }

      // Re-fetch event to get latest court config
      const { data: freshEvent } = await supabase
        .from("events")
        .select("team_battle_singles_courts, team_battle_doubles_courts")
        .eq("id", event.id)
        .single();

      teamBattleConfig = {
        singlesCourts: freshEvent?.team_battle_singles_courts ?? event.num_courts,
        doublesCourts: freshEvent?.team_battle_doubles_courts ?? 0,
        team1Id: teams[0].id,
        team2Id: teams[1].id,
      };
    }

    const { data: existingRounds } = await supabase
      .from("rounds")
      .select("id, round_number")
      .eq("event_id", event.id)
      .order("round_number");

    const existingRoundIds = existingRounds?.map(r => r.id) || [];

    let historicalMatches: any[] = [];
    if (existingRoundIds.length > 0) {
      const { data } = await supabase
        .from("matches")
        .select("player1_id, player2_id, player3_id, player4_id")
        .in("round_id", existingRoundIds);

      historicalMatches = data || [];
    }

    // Pick generation mode:
    //   - Multiple rounds at once  → multi-random (completely random, hard-avoid repeat partners/opponents)
    //   - First ever round (1 at a time) → single-r1-balanced (snake by strength_order)
    //   - Single new round after existing rounds → single-rN-tiered (courts stack by live standings)
    const mode: GenerationMode = numRounds > 1
      ? 'multi-random'
      : existingRoundIds.length === 0
        ? 'single-r1-balanced'
        : 'single-rN-tiered';

    const generator = new RoundGenerator(playerData, event.num_courts, matchFormat);
    generator.setRandomize(randomize);
    generator.setMode(mode);

    // Set team battle config if applicable
    if (teamBattleConfig) {
      generator.setTeamBattleConfig(teamBattleConfig);
    }

    const currentPlayerIds = new Set(playerData.map(p => p.player_id));
    const validHistoricalMatches = historicalMatches.filter(match => {
      const playerIds = [match.player1_id, match.player2_id, match.player3_id, match.player4_id].filter(Boolean);
      return playerIds.every(id => currentPlayerIds.has(id));
    });

    if (validHistoricalMatches.length > 0) {
      generator.seedMatchHistory(validHistoricalMatches);
    }

    const allRoundsPairings = generator.generateMultipleRounds(numRounds);

    const startingRoundNumber = rounds.length + 1;
    let newRoundId: string | null = null;
    
    for (let i = 0; i < allRoundsPairings.length; i++) {
      const pairings = allRoundsPairings[i];
      const roundNumber = startingRoundNumber + i;

      const { data: round, error: roundError } = await supabase
        .from("rounds")
        .insert([
          {
            event_id: event.id,
            round_number: roundNumber,
            status: "upcoming",
          },
        ])
        .select()
        .single();

      if (roundError) {
        toast({
          variant: "destructive",
          title: `Error creating round ${roundNumber}`,
          description: roundError.message,
        });
        continue;
      }

      if (i === 0) {
        newRoundId = round.id;
      }

      const matchInserts = pairings.map((pairing, idx) => ({
        round_id: round.id,
        court_number: courtFor(idx),
        ...pairing,
      }));

      await supabase.from("matches").insert(matchInserts);
    }

    toast({
      title: `${numRounds} round${numRounds > 1 ? 's' : ''} created!`,
      description: isTeamBattle 
        ? "Team vs Team matches generated!" 
        : "Matches generated with fresh randomized pairings.",
    });

    setGenerating(false);
    await fetchRounds(newRoundId || undefined);
  };

  const generateRound = async () => {
    await generateMultipleRoundsHandler(1, true);
  };

  const regenerateRound = async (roundId: string) => {
    setGenerating(true);

    const { data: playerCountData } = await supabase
      .from("event_players")
      .select("player_id")
      .eq("event_id", event.id);
    
    const playerCount = playerCountData?.length || 0;
    
    let matchFormat = event.match_format;
    if (!matchFormat) {
      if (playerCount === event.num_courts * 2) {
        matchFormat = "singles";
      } else if (playerCount === event.num_courts * 4) {
        matchFormat = "doubles";
      } else {
        matchFormat = "maximize-courts";
      }
    }

    if (!matchFormat) {
      toast({
        variant: "destructive",
        title: "No format selected",
        description: "Please select a match format in the Players tab first.",
      });
      setGenerating(false);
      return;
    }

    const { data: eventPlayers, error: playersError } = await supabase
      .from("event_players")
      .select(`
        player_id,
        team_id,
        wins,
        losses,
        games_won,
        games_lost,
        strength_order,
        players(name, gender)
      `)
      .eq("event_id", event.id)
      .eq("active", true)
      .order("strength_order");

    const minPlayers = matchFormat === 'singles' || matchFormat === 'team-battle' ? 2 : 4;
    if (playersError || !eventPlayers || eventPlayers.length < minPlayers) {
      toast({
        variant: "destructive",
        title: "Not enough players",
        description: `Need at least ${minPlayers} players to generate rounds.`,
      });
      setGenerating(false);
      return;
    }

    const playerData = eventPlayers.map((ep: any) => ({
      player_id: ep.player_id,
      name: ep.players.name,
      gender: ep.players.gender,
      wins: ep.wins,
      losses: ep.losses,
      games_won: ep.games_won,
      games_lost: ep.games_lost,
      team_id: ep.team_id,
      strength_order: ep.strength_order,
    }));

    // For team battle, get team IDs
    let teamBattleConfig = null;
    if (matchFormat === 'team-battle') {
      const { data: teams } = await supabase
        .from("event_teams")
        .select("id")
        .eq("event_id", event.id)
        .order("created_at");

      if (!teams || teams.length < 2) {
        toast({
          variant: "destructive",
          title: "Teams not configured",
          description: "Please set up both teams first.",
        });
        setGenerating(false);
        return;
      }

      const { data: freshEvent } = await supabase
        .from("events")
        .select("team_battle_singles_courts, team_battle_doubles_courts")
        .eq("id", event.id)
        .single();

      teamBattleConfig = {
        singlesCourts: freshEvent?.team_battle_singles_courts ?? event.num_courts,
        doublesCourts: freshEvent?.team_battle_doubles_courts ?? 0,
        team1Id: teams[0].id,
        team2Id: teams[1].id,
      };
    }

    const { data: currentRoundData } = await supabase
      .from("rounds")
      .select("round_number")
      .eq("id", roundId)
      .single();

    const currentRoundNumber = currentRoundData?.round_number || 1;

    // Seed history from ALL other rounds (not this one — we're regenerating it)
    const { data: otherRounds } = await supabase
      .from("rounds")
      .select("id")
      .eq("event_id", event.id)
      .neq("id", roundId);

    const otherRoundIds = otherRounds?.map(r => r.id) || [];

    let historicalMatches: any[] = [];
    if (otherRoundIds.length > 0) {
      const { data } = await supabase
        .from("matches")
        .select("player1_id, player2_id, player3_id, player4_id")
        .in("round_id", otherRoundIds);

      historicalMatches = data || [];
    }

    await supabase.from("matches").delete().eq("round_id", roundId);

    // Round 1 regen → balanced by strength_order. Round 2+ → tiered by standings.
    const mode: GenerationMode = currentRoundNumber === 1 ? 'single-r1-balanced' : 'single-rN-tiered';

    const generator = new RoundGenerator(playerData, event.num_courts, matchFormat);
    generator.setRandomize(true);
    generator.setMode(mode);

    if (teamBattleConfig) {
      generator.setTeamBattleConfig(teamBattleConfig);
    }

    if (historicalMatches.length > 0) {
      generator.seedMatchHistory(historicalMatches);
    }

    const pairings = generator.generateMultipleRounds(1)[0];

    const matchInserts = pairings.map((pairing, idx) => ({
      round_id: roundId,
      court_number: courtFor(idx),
      ...pairing,
    }));

    await supabase.from("matches").insert(matchInserts);

    toast({
      title: "Round regenerated!",
      description: "New randomized pairings have been created.",
    });

    setGenerating(false);
    fetchMatches(roundId);
  };

  const startRound = async () => {
    if (!currentRound) return;

    const { error } = await supabase
      .from("rounds")
      .update({ status: "in_progress", start_time: new Date().toISOString() })
      .eq("id", currentRound.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error starting round",
        description: error.message,
      });
    } else {
      toast({
        title: "Round started",
        description: "The timer has begun.",
      });
      fetchRounds();
    }
  };

  const completeRound = async () => {
    if (!currentRound) return;

    const unfinishedMatches = matches.filter((m) => {
      const isByeMatch = !m.player2 && !m.player3 && !m.player4;
      return !isByeMatch && m.team1_score === 0 && m.team2_score === 0;
    });
    
    if (unfinishedMatches.length > 0) {
      toast({
        variant: "destructive",
        title: "Cannot complete round",
        description: "Please enter scores for all matches first.",
      });
      return;
    }

    const { error } = await supabase
      .from("rounds")
      .update({ status: "completed", end_time: new Date().toISOString() })
      .eq("id", currentRound.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error completing round",
        description: error.message,
      });
    } else {
      toast({
        title: "Round completed",
        description: "Standings have been updated.",
      });
      
      setSelectedRoundId(null);
      await fetchRounds();
      
      const { data: nextRounds } = await supabase
        .from("rounds")
        .select("*")
        .eq("event_id", event.id)
        .eq("status", "upcoming")
        .order("round_number");
      
      if (nextRounds && nextRounds.length > 0) {
        setCurrentRound(nextRounds[0]);
        setSelectedRoundId(nextRounds[0].id);
        fetchMatches(nextRounds[0].id);
      }
    }
  };

  const handleScoreSaved = () => {
    if (currentRound) {
      fetchMatches(currentRound.id);
    }
    setShowScoreDialog(false);
  };

  const handleMatchClick = (match: Match) => {
    setSelectedMatch(match);
    setShowScoreDialog(true);
  };

  const selectRound = (round: Round) => {
    setCurrentRound(round);
    setSelectedRoundId(round.id);
    fetchMatches(round.id);
  };

  // Nuke every round + match and zero out per-event W/L so the event can be
  // regenerated from scratch (e.g. after changing the singles/doubles config).
  const deleteAllRounds = async () => {
    if (!confirm(`Delete all ${rounds.length} round${rounds.length > 1 ? 's' : ''} and their matches? Players and teams are kept — you can regenerate fresh rounds right after.`)) return;

    const roundIds = rounds.map(r => r.id);
    const { error: matchError } = await supabase
      .from("matches")
      .delete()
      .in("round_id", roundIds);
    if (matchError) {
      toast({ variant: "destructive", title: "Error deleting matches", description: matchError.message });
      return;
    }

    const { error: roundError } = await supabase
      .from("rounds")
      .delete()
      .eq("event_id", event.id);
    if (roundError) {
      toast({ variant: "destructive", title: "Error deleting rounds", description: roundError.message });
      return;
    }

    await supabase
      .from("event_players")
      .update({ wins: 0, losses: 0, games_won: 0, games_lost: 0 })
      .eq("event_id", event.id);

    setRounds([]);
    setCurrentRound(null);
    setSelectedRoundId(null);
    setMatches([]);
    toast({
      title: "All rounds deleted",
      description: "Set your court configuration on the Teams tab, then generate fresh rounds.",
    });
  };

  // Delete a SINGLE round (keep the rest). Reverses that round's contribution
  // to each player's W/L/games (mirror of MatchScoreDialog), deletes its
  // matches + the round, then renumbers later rounds down so numbering stays
  // contiguous (e.g. delete R2 of R1/R2/R3 → R3 becomes R2).
  const deleteRound = async (round: Round) => {
    if (
      !confirm(
        `Delete Round ${round.round_number} and its matches? Any standings from this round are reversed; your other rounds are kept.`
      )
    )
      return;

    // Pull this round's matches so we can undo their standings impact.
    const { data: roundMatches, error: fetchErr } = await supabase
      .from("matches")
      .select("player1_id, player2_id, player3_id, player4_id, team1_score, team2_score, winner_team")
      .eq("round_id", round.id);
    if (fetchErr) {
      toast({ variant: "destructive", title: "Error reading round", description: fetchErr.message });
      return;
    }

    // Sum the W/L/games each player earned in this round (only scored matches).
    const deltas = new Map<string, { w: number; l: number; gw: number; gl: number }>();
    const bump = (pid: string, w: number, l: number, gw: number, gl: number) => {
      const d = deltas.get(pid) || { w: 0, l: 0, gw: 0, gl: 0 };
      d.w += w; d.l += l; d.gw += gw; d.gl += gl;
      deltas.set(pid, d);
    };
    for (const m of roundMatches || []) {
      if (m.winner_team == null) continue;
      const slots = [
        { pid: m.player1_id, isTeam1: true },
        { pid: m.player2_id, isTeam1: false },
        { pid: m.player3_id, isTeam1: true },
        { pid: m.player4_id, isTeam1: false },
      ];
      for (const s of slots) {
        if (!s.pid) continue;
        const won = (s.isTeam1 && m.winner_team === 1) || (!s.isTeam1 && m.winner_team === 2);
        const lost = (s.isTeam1 && m.winner_team === 2) || (!s.isTeam1 && m.winner_team === 1);
        const gw = s.isTeam1 ? (m.team1_score || 0) : (m.team2_score || 0);
        const gl = s.isTeam1 ? (m.team2_score || 0) : (m.team1_score || 0);
        bump(s.pid, won ? 1 : 0, lost ? 1 : 0, gw, gl);
      }
    }

    if (deltas.size > 0) {
      const pids = [...deltas.keys()];
      const { data: standings } = await supabase
        .from("event_players")
        .select("id, player_id, wins, losses, games_won, games_lost")
        .eq("event_id", event.id)
        .in("player_id", pids);
      for (const sp of standings || []) {
        const d = deltas.get(sp.player_id);
        if (!d) continue;
        await supabase
          .from("event_players")
          .update({
            wins: Math.max(0, (sp.wins || 0) - d.w),
            losses: Math.max(0, (sp.losses || 0) - d.l),
            games_won: Math.max(0, (sp.games_won || 0) - d.gw),
            games_lost: Math.max(0, (sp.games_lost || 0) - d.gl),
          })
          .eq("id", sp.id);
      }
    }

    const { error: matchErr } = await supabase.from("matches").delete().eq("round_id", round.id);
    if (matchErr) {
      toast({ variant: "destructive", title: "Error deleting matches", description: matchErr.message });
      return;
    }
    const { error: roundErr } = await supabase.from("rounds").delete().eq("id", round.id);
    if (roundErr) {
      toast({ variant: "destructive", title: "Error deleting round", description: roundErr.message });
      return;
    }

    // Close the gap: shift later rounds down by one (ascending order = no
    // transient collision on the unique round_number).
    const later = rounds
      .filter((r) => r.round_number > round.round_number)
      .sort((a, b) => a.round_number - b.round_number);
    for (const r of later) {
      await supabase.from("rounds").update({ round_number: r.round_number - 1 }).eq("id", r.id);
    }

    // Move focus off the deleted round before reloading.
    if (currentRound?.id === round.id) {
      setSelectedRoundId(null);
      setCurrentRound(null);
      setMatches([]);
    }
    await fetchRounds();
    toast({ title: `Round ${round.round_number} deleted`, description: "Other rounds kept and renumbered." });
  };

  const restartRound = async () => {
    if (!currentRound) return;

    const { error } = await supabase
      .from("matches")
      .update({ team1_score: 0, team2_score: 0, winner_team: null })
      .eq("round_id", currentRound.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error restarting round",
        description: error.message,
      });
    } else {
      await supabase
        .from("rounds")
        .update({ status: "upcoming", start_time: null, end_time: null })
        .eq("id", currentRound.id);

      toast({
        title: "Round restarted",
        description: "All scores have been reset.",
      });
      fetchRounds();
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-white border-2">
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle style={{ color: "#111827" }}>Rounds</CardTitle>
              <CardDescription className="text-gray-500">Generate and manage rounds</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => setShowManagePlayers(true)} className="bg-white" style={{ color: "#111827" }}>
                <Users className="h-4 w-4 mr-1" />
                Manage Players
              </Button>
              {rounds.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={deleteAllRounds}
                  className="bg-white border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete All & Start Over
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {rounds.length === 0 ? (
            <div className="text-center py-8 space-y-4">
              <p className="text-gray-500 mb-4">No rounds created yet</p>
              <div className="flex gap-3 justify-center">
                <Button onClick={generateRound} disabled={generating} size="lg">
                  <Plus className="h-4 w-4 mr-2" />
                  {generating ? "Generating..." : "Generate Round 1"}
                </Button>
                <Button 
                  onClick={() => setShowMultiRoundDialog(true)} 
                  disabled={generating}
                  size="lg"
                  variant="default"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Generate Multiple
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        const currentIndex = rounds.findIndex((r) => r.id === currentRound?.id);
                        if (currentIndex > 0) selectRound(rounds[currentIndex - 1]);
                      }}
                      disabled={!currentRound || rounds.findIndex((r) => r.id === currentRound.id) === 0}
                      className="bg-white"
                      style={{ color: "#111827" }}
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    
                    <Select
                      value={currentRound?.id}
                      onValueChange={(value) => {
                        const round = rounds.find((r) => r.id === value);
                        if (round) selectRound(round);
                      }}
                    >
                      <SelectTrigger className="w-[180px] h-12 bg-white font-semibold" style={{ color: "#111827" }}>
                        <SelectValue>
                          Round {currentRound?.round_number}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {rounds.map((round) => (
                          <SelectItem key={round.id} value={round.id} style={{ color: "#111827" }}>
                            Round {round.round_number} ({round.status})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        const currentIndex = rounds.findIndex((r) => r.id === currentRound?.id);
                        if (currentIndex < rounds.length - 1) selectRound(rounds[currentIndex + 1]);
                      }}
                      disabled={!currentRound || rounds.findIndex((r) => r.id === currentRound.id) === rounds.length - 1}
                      className="bg-white"
                      style={{ color: "#111827" }}
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>

                    {currentRound && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => currentRound && deleteRound(currentRound)}
                        className="bg-white text-red-600 hover:bg-red-50 border-red-200"
                        title={`Delete Round ${currentRound.round_number} only (keeps other rounds)`}
                      >
                        <Trash2 className="h-5 w-5" />
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {currentRound?.status === "upcoming" && (
                      <>
                        <Button 
                          onClick={async () => {
                            if (currentRound) {
                              await fetchMatches(currentRound.id);
                            }
                            setShowManualEditor(true);
                          }}
                          variant="outline"
                          size="lg"
                          className="bg-white"
                          style={{ color: "#111827" }}
                        >
                          <Edit className="h-5 w-5 mr-2" />
                          Manual Edit
                        </Button>
                        <Button
                          onClick={() => currentRound && regenerateRound(currentRound.id)}
                          variant="outline"
                          size="lg"
                          disabled={generating}
                          className="bg-white"
                          style={{ color: "#111827" }}
                        >
                          <Shuffle className="h-5 w-5 mr-2" />
                          Shuffle Pairings
                        </Button>
                        <Button onClick={startRound} size="lg">
                          <Play className="h-5 w-5 mr-2" />
                          {event.scoring_format === "timed" ? "Start Round & Timer" : "Start Round"}
                        </Button>
                      </>
                    )}
                    {currentRound?.status === "in_progress" && (
                      <>
                        <Button
                          onClick={async () => {
                            if (currentRound) {
                              await fetchMatches(currentRound.id);
                            }
                            setShowManualEditor(true);
                          }}
                          variant="outline"
                          size="lg"
                          className="bg-white"
                          style={{ color: "#111827" }}
                        >
                          <Edit className="h-5 w-5 mr-2" />
                          Manual Edit
                        </Button>
                        <Button onClick={restartRound} variant="outline" size="lg" className="bg-white" style={{ color: "#111827" }}>
                          <RotateCcw className="h-5 w-5 mr-2" />
                          Restart
                        </Button>
                        <Button onClick={completeRound} variant="default" size="lg">
                          <Check className="h-5 w-5 mr-2" />
                          Complete
                        </Button>
                      </>
                    )}
                    {(currentRound?.status === "completed" || currentRound?.status === "in_progress") && currentRound.round_number === rounds.length && (
                      <>
                        <Button onClick={generateRound} disabled={generating} size="lg">
                          <Plus className="h-5 w-5 mr-2" />
                          Advance to Next Round
                        </Button>
                        <Button onClick={() => setShowMultiRoundDialog(true)} disabled={generating} size="lg" variant="outline" className="bg-white" style={{ color: "#111827" }}>
                          <Plus className="h-5 w-5 mr-2" />
                          Create Multiple New Rounds
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {currentRound?.status === "in_progress" &&
                event.scoring_format === "timed" &&
                event.round_length_minutes && (
                  <RoundTimer
                    roundId={currentRound.id}
                    startTime={currentRound.start_time || new Date().toISOString()}
                    pausedAt={currentRound.timer_paused_at}
                    durationMinutes={event.round_length_minutes}
                    onTimerChange={() => fetchRounds(currentRound.id)}
                  />
                )}

              {(() => {
                const activeMatches = matches.filter((m) => m.player2 || m.player3 || m.player4);
                const byeMatches = matches.filter((m) => !m.player2 && !m.player3 && !m.player4);
                
                return (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {activeMatches.map((match) => (
                        <Card
                          key={match.id}
                          className="cursor-pointer hover:shadow-xl hover:border-primary/50 transition-all border-2 rounded-2xl overflow-hidden bg-white"
                          onClick={() => handleMatchClick(match)}
                        >
                          <div className="bg-primary/10 px-3 sm:px-5 py-2 sm:py-3 border-b-2">
                            <div className="flex items-center justify-between">
                              <p className="text-base sm:text-lg font-bold text-primary">
                                Court {match.court_number}
                              </p>
                              {match.winner_team && (
                                <span className="bg-success text-white px-2 sm:px-3 py-1 rounded-full text-xs font-medium">
                                  ✓ Complete
                                </span>
                              )}
                            </div>
                          </div>
                          <CardContent className="p-3 sm:p-5 space-y-3 sm:space-y-4">
                            <div className="flex items-center justify-between p-3 sm:p-4 bg-gray-50 rounded-xl border-2">
                              <div className="flex-1 min-w-0 pr-2">
                                <p className="font-semibold text-sm sm:text-base truncate" style={{ color: "#111827" }}>
                                  {match.player1?.name || "TBD"}
                                </p>
                                {match.player3 && (
                                  <p className="font-semibold text-sm sm:text-base truncate" style={{ color: "#111827" }}>
                                    {match.player3.name}
                                  </p>
                                )}
                              </div>
                              <p className="text-3xl sm:text-4xl font-black text-primary flex-shrink-0">{match.team1_score}</p>
                            </div>
                            <div className="flex items-center justify-between p-3 sm:p-4 bg-gray-50 rounded-xl border-2">
                              <div className="flex-1 min-w-0 pr-2">
                                <p className="font-semibold text-sm sm:text-base truncate" style={{ color: "#111827" }}>
                                  {match.player2?.name || "TBD"}
                                </p>
                                {match.player4 && (
                                  <p className="font-semibold text-sm sm:text-base truncate" style={{ color: "#111827" }}>
                                    {match.player4.name}
                                  </p>
                                )}
                              </div>
                              <p className="text-3xl sm:text-4xl font-black text-primary flex-shrink-0">{match.team2_score}</p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {byeMatches.length > 0 && (
                      <div className="mt-6">
                        <h3 className="text-base sm:text-lg font-semibold mb-3" style={{ color: "#111827" }}>On BYE</h3>
                        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                          {byeMatches.map((match) => (
                            <Card key={match.id} className="border-2 border-gray-200 bg-white">
                              <CardContent className="p-3 sm:p-4">
                                <p className="text-center font-semibold text-base sm:text-lg truncate" style={{ color: "#111827" }}>
                                  {match.player1?.name || "TBD"}
                                </p>
                                <p className="text-center text-sm text-gray-500 mt-1">
                                  sitting out this round
                                </p>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </CardContent>
      </Card>

      {selectedMatch && (
        <>
          {(event.scoring_format === "pro_set" || event.scoring_format === "best_of_3_sets" || event.scoring_format === "best_of_3_tiebreak") ? (
            <TournamentMatchScoreDialog
              match={selectedMatch}
              open={showScoreDialog}
              onOpenChange={setShowScoreDialog}
              onScoreSaved={handleScoreSaved}
              eventId={event.id}
              scoringFormat={event.scoring_format}
            />
          ) : (
            <MatchScoreDialog
              match={selectedMatch}
              open={showScoreDialog}
              onOpenChange={setShowScoreDialog}
              onScoreSaved={handleScoreSaved}
              eventId={event.id}
              scoringFormat={event.scoring_format}
              targetGames={event.target_games}
            />
          )}
        </>
      )}

      <RoundGenerationDialog
        open={showMultiRoundDialog}
        onOpenChange={setShowMultiRoundDialog}
        onGenerate={generateMultipleRoundsHandler}
        maxRounds={6}
      />

      <ManualMatchEditor
        matches={matches}
        open={showManualEditor}
        onOpenChange={setShowManualEditor}
        onSaved={() => {
          if (currentRound) {
            fetchMatches(currentRound.id);
          }
        }}
      />

      <ManagePlayersDialog
        eventId={event.id}
        open={showManagePlayers}
        onOpenChange={setShowManagePlayers}
        onPlayersChanged={() => {
          if (currentRound) fetchMatches(currentRound.id);
        }}
      />
    </div>
  );
};

export default RoundsTab;
