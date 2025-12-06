'use client';

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Users, Trophy, ListOrdered, Flag, Award, Settings, Share2, GitBranch, Swords } from "lucide-react";
import PlayersTab from "@/components/mixer/event/PlayersTab";
import RoundsTab from "@/components/mixer/event/RoundsTab";
import StandingsTab from "@/components/mixer/event/StandingsTab";
import EventSummary from "@/components/mixer/event/EventSummary";
import EditEventFormatDialog from "@/components/mixer/event/EditEventFormatDialog";
import EventCodeQR from "@/components/mixer/event/EventCodeQR";
import TournamentBracket from "@/components/mixer/event/TournamentBracket";
import { format } from "date-fns";

interface Event {
  id: string;
  name: string;
  event_date: string;
  start_time: string;
  num_courts: number;
  scoring_format: string;
  round_length_minutes: number | null;
  target_games: number | null;
  match_format: string | null;
  event_code: string;
}

export default function EventDashboard() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("share");
  const [eventEnded, setEventEnded] = useState(false);
  const [showEditFormatDialog, setShowEditFormatDialog] = useState(false);

  useEffect(() => {
    if (params.id) {
      fetchEvent();
    }
  }, [params.id]);

  const fetchEvent = async () => {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("id", params.id)
      .maybeSingle();

    if (error) {
      toast({
        variant: "destructive",
        title: "Error fetching event",
        description: error.message,
      });
      router.push("/mixer/home");
    } else if (!data) {
      toast({
        variant: "destructive",
        title: "Event not found",
        description: "This event doesn't exist or has been deleted.",
      });
      router.push("/mixer/home");
    } else {
      setEvent(data);
    }
    setLoading(false);
  };

  const endEvent = async () => {
    const { error } = await supabase
      .from("rounds")
      .update({ status: "completed", end_time: new Date().toISOString() })
      .eq("event_id", params.id)
      .neq("status", "completed");

    if (error) {
      toast({
        variant: "destructive",
        title: "Error ending event",
        description: error.message,
      });
    } else {
      setEventEnded(true);
      setActiveTab("summary");
      toast({
        title: "Event completed!",
        description: "View final results and export data.",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!event) return null;

  const isTournament = event.match_format === 'single-elimination' || 
                       event.match_format === 'single-elimination-singles' || 
                       event.match_format === 'single-elimination-doubles';

  const isTeamBattle = event.match_format === 'team-battle';

  const getFormatDisplay = (format: string | null) => {
    if (!format) return null;
    const displays: Record<string, string> = {
      'singles': '🎾 Singles',
      'doubles': '👥 Doubles',
      'mixed-doubles': '🎯 Mixed Doubles',
      'king-of-court': '👑 King of Court',
      'round-robin': '🔄 Round Robin',
      'maximize-courts': '⚡ Optimize Courts',
      'single-elimination': '🏆 Tournament',
      'single-elimination-singles': '🏆 Singles Tournament',
      'single-elimination-doubles': '🏅 Doubles Tournament',
      'team-battle': '⚔️ Team Battle',
    };
    return displays[format] || format;
  };

  // Determine which tabs to show based on format
  const getTabConfig = () => {
    if (isTournament) {
      return { middleTab: 'bracket', middleIcon: GitBranch, middleLabel: 'Bracket' };
    } else if (isTeamBattle) {
      return { middleTab: 'teams', middleIcon: Swords, middleLabel: 'Teams' };
    } else {
      return { middleTab: 'rounds', middleIcon: ListOrdered, middleLabel: 'Rounds' };
    }
  };

  const tabConfig = getTabConfig();

  return (
    <div className={`min-h-screen ${isTeamBattle ? 'bg-gradient-to-br from-red-50 via-background to-blue-50' : 'bg-gradient-to-br from-primary/5 via-background to-accent/5'}`}>
      <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-2 gap-2">
            <Button variant="ghost" onClick={() => router.push("/mixer/home")} className="w-full sm:w-auto">
              <ArrowLeft className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Back to Events</span>
              <span className="sm:hidden">Back</span>
            </Button>
            
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Button variant="outline" size="lg" onClick={() => setShowEditFormatDialog(true)} className="w-full sm:w-auto bg-white">
                <Settings className="h-5 w-5 mr-2" />
                <span className="hidden sm:inline">Edit Format</span>
                <span className="sm:hidden">Edit</span>
              </Button>
              
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="lg" className="w-full sm:w-auto">
                    <Flag className="h-5 w-5 mr-2" />
                    End Event
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-white">
                  <AlertDialogHeader>
                    <AlertDialogTitle>End Event?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will complete all rounds and show final standings. You can still view the event details afterwards.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={endEvent}>End Event</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">{event.name}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {format(new Date(event.event_date), "EEEE, MMMM d, yyyy")}
              {event.start_time && ` at ${event.start_time}`}
            </p>
            <div className="flex flex-wrap gap-2 sm:gap-3 mt-2">
              <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                {event.num_courts} {event.num_courts === 1 ? 'Court' : 'Courts'}
              </span>
              {event.match_format && (
                <span className={`inline-flex items-center px-2 sm:px-3 py-1 rounded-full text-xs font-medium ${
                  isTeamBattle ? 'bg-red-100 text-red-700' : 'bg-secondary/10 text-secondary-foreground'
                }`}>
                  {getFormatDisplay(event.match_format)}
                </span>
              )}
              <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent">
                {event.scoring_format === 'timed' && `Timed: ${event.round_length_minutes} min`}
                {event.scoring_format === 'fixed_games' && `Fixed: ${event.target_games}`}
                {event.scoring_format === 'first_to_x' && `First to ${event.target_games}`}
                {event.scoring_format === 'pro_set' && '8 Game Pro-Set'}
                {event.scoring_format === 'best_of_3_sets' && 'Best of 3 Sets'}
                {event.scoring_format === 'best_of_3_tiebreak' && 'Best of 3 w/ Tiebreak'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-7xl">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-3xl mx-auto grid-cols-5 h-auto sm:h-14 p-1 gap-1">
            <TabsTrigger value="share" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-base font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 sm:py-3">
              <Share2 className="h-4 w-4 sm:h-5 sm:w-5" />
              <span className="hidden sm:inline">Share</span>
            </TabsTrigger>
            {isTeamBattle ? (
              <TabsTrigger value="teams" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-base font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 sm:py-3">
                <Swords className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">Teams</span>
              </TabsTrigger>
            ) : (
              <TabsTrigger value="players" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-base font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 sm:py-3">
                <Users className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">Players</span>
              </TabsTrigger>
            )}
            {isTournament ? (
              <TabsTrigger value="bracket" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-base font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 sm:py-3">
                <GitBranch className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">Bracket</span>
              </TabsTrigger>
            ) : (
              <TabsTrigger value="rounds" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-base font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 sm:py-3">
                <ListOrdered className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">Rounds</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="standings" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-base font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 sm:py-3">
              <Trophy className="h-4 w-4 sm:h-5 sm:w-5" />
              <span className="hidden sm:inline">Standings</span>
            </TabsTrigger>
            <TabsTrigger value="summary" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-base font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 sm:py-3" disabled={!eventEnded}>
              <Award className="h-4 w-4 sm:h-5 sm:w-5" />
              <span className="hidden sm:inline">Summary</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="share" className="space-y-4">
            <EventCodeQR eventCode={event.event_code} eventName={event.name} />
          </TabsContent>

          {isTeamBattle ? (
            <TabsContent value="teams" className="space-y-4">
              {/* TeamBattleTab will be created next */}
              <div className="bg-white rounded-xl border-2 border-gray-200 p-8 text-center">
                <Swords className="h-16 w-16 mx-auto text-red-400 mb-4" />
                <h2 className="text-2xl font-bold mb-2">Team Battle Mode</h2>
                <p className="text-gray-600">Team management component coming next...</p>
              </div>
            </TabsContent>
          ) : (
            <TabsContent value="players" className="space-y-4">
              <PlayersTab event={event} onFormatUpdated={fetchEvent} onSwitchToRounds={() => setActiveTab("rounds")} />
            </TabsContent>
          )}

          {isTournament ? (
            <TabsContent value="bracket" className="space-y-4">
              <TournamentBracket event={event} />
            </TabsContent>
          ) : (
            <TabsContent value="rounds" className="space-y-4">
              <RoundsTab event={event} />
            </TabsContent>
          )}

          <TabsContent value="standings" className="space-y-4">
            <StandingsTab eventId={event.id} />
          </TabsContent>

          <TabsContent value="summary" className="space-y-4">
            <EventSummary eventId={event.id} eventName={event.name} />
          </TabsContent>
        </Tabs>
      </main>

      <EditEventFormatDialog
        event={event}
        open={showEditFormatDialog}
        onOpenChange={setShowEditFormatDialog}
        onFormatUpdated={fetchEvent}
      />
    </div>
  );
}
