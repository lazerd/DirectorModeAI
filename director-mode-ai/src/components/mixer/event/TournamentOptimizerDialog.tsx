import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Loader2, Lightbulb, Calendar, Users, Trophy } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface TournamentOptimizerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyRecommendation?: (recommendation: TournamentRecommendation) => void;
}

interface TournamentRecommendation {
  recommendedFormat: string;
  reasoning: string;
  estimatedMatches: number;
  estimatedDuration: string;
  alternatives?: Array<{
    format: string;
    pros: string;
    cons: string;
  }>;
  schedule?: {
    rounds: number;
    matchesPerRound: number;
    minutesPerRound: number;
  };
}

export function TournamentOptimizerDialog({ 
  open, 
  onOpenChange,
  onApplyRecommendation 
}: TournamentOptimizerDialogProps) {
  const [playerCount, setPlayerCount] = useState<string>("");
  const [numCourts, setNumCourts] = useState<string>("");
  const [durationMinutes, setDurationMinutes] = useState<string>("");
  const [skillLevels, setSkillLevels] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recommendation, setRecommendation] = useState<TournamentRecommendation | null>(null);

  const handleAnalyze = async () => {
    if (!playerCount || !numCourts || !durationMinutes) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsAnalyzing(true);
    setRecommendation(null);

    try {
      const { data, error } = await supabase.functions.invoke("tournament-optimizer", {
        body: {
          playerCount: parseInt(playerCount),
          numCourts: parseInt(numCourts),
          durationMinutes: parseInt(durationMinutes),
          skillLevels,
        },
      });

      if (error) {
        throw error;
      }

      setRecommendation(data);
      toast.success("AI analysis complete!");
    } catch (error: any) {
      console.error("Error analyzing tournament:", error);
      if (error.message?.includes("429")) {
        toast.error("Rate limit exceeded. Please try again in a moment.");
      } else if (error.message?.includes("402")) {
        toast.error("AI credits exhausted. Please add credits to continue.");
      } else {
        toast.error("Failed to analyze tournament. Please try again.");
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApply = () => {
    if (recommendation && onApplyRecommendation) {
      onApplyRecommendation(recommendation);
      toast.success("Recommendation applied!");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            Smart Tournament Optimizer
          </DialogTitle>
          <DialogDescription>
            AI-powered analysis to find the perfect tournament format for your event
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="playerCount">Number of Players *</Label>
              <Input
                id="playerCount"
                type="number"
                min="4"
                value={playerCount}
                onChange={(e) => setPlayerCount(e.target.value)}
                placeholder="12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="numCourts">Available Courts *</Label>
              <Input
                id="numCourts"
                type="number"
                min="1"
                value={numCourts}
                onChange={(e) => setNumCourts(e.target.value)}
                placeholder="3"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="durationMinutes">Total Time (minutes) *</Label>
              <Input
                id="durationMinutes"
                type="number"
                min="30"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="180"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="skillLevels">Event Details</Label>
              <Textarea
                id="skillLevels"
                value={skillLevels}
                onChange={(e) => setSkillLevels(e.target.value)}
                placeholder="Tell me with as much detail as possible about the event you're trying to administer and I'll recommend the perfect format..."
                rows={3}
              />
            </div>
          </div>

          <Button 
            onClick={handleAnalyze} 
            disabled={isAnalyzing}
            className="w-full"
            size="lg"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing with AI...
              </>
            ) : (
              <>
                <Lightbulb className="mr-2 h-4 w-4" />
                Get AI Recommendation
              </>
            )}
          </Button>

          {recommendation && (
            <div className="space-y-4 animate-in fade-in-50 duration-500">
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-primary" />
                    Recommended Format
                  </CardTitle>
                  <Badge className="w-fit">{recommendation.recommendedFormat}</Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-2">Why This Format?</h4>
                    <p className="text-sm text-muted-foreground">{recommendation.reasoning}</p>
                  </div>

                  {recommendation.schedule && (
                    <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                          <Calendar className="h-4 w-4" />
                          Rounds
                        </div>
                        <p className="text-2xl font-bold">{recommendation.schedule.rounds}</p>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                          <Users className="h-4 w-4" />
                          Matches/Round
                        </div>
                        <p className="text-2xl font-bold">{recommendation.schedule.matchesPerRound}</p>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                          <Trophy className="h-4 w-4" />
                          Total Matches
                        </div>
                        <p className="text-2xl font-bold">{recommendation.estimatedMatches}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-4 border-t">
                    <div>
                      <span className="text-sm text-muted-foreground">Estimated Duration:</span>
                      <p className="font-semibold">{recommendation.estimatedDuration}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {recommendation.alternatives && recommendation.alternatives.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Alternative Formats</CardTitle>
                    <CardDescription>Other options to consider</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {recommendation.alternatives.map((alt, index) => (
                      <div key={index} className="p-3 rounded-lg border bg-card">
                        <h5 className="font-semibold mb-2">{alt.format}</h5>
                        <div className="text-sm space-y-1">
                          <p><span className="text-green-600 dark:text-green-400 font-medium">✓</span> {alt.pros}</p>
                          <p><span className="text-orange-600 dark:text-orange-400 font-medium">⚠</span> {alt.cons}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {onApplyRecommendation && (
                <Button onClick={handleApply} className="w-full" size="lg">
                  Apply This Recommendation
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
