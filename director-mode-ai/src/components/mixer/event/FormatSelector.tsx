import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Users, Sparkles, CheckCircle } from "lucide-react";

interface FormatOption {
  id: string;
  name: string;
  description: string;
  playersPerCourt: number;
  icon: string;
  recommended?: boolean;
  requiresGender?: boolean;
}

interface FormatSelectorProps {
  eventId: string;
  playerCount: number;
  courtCount: number;
  onFormatSelected: () => void;
  onFormatUpdated?: () => void;
}

const FormatSelector = ({ eventId, playerCount, courtCount, onFormatSelected, onFormatUpdated }: FormatSelectorProps) => {
  const { toast } = useToast();
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [formats, setFormats] = useState<FormatOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    analyzeAndRecommend();
  }, [playerCount, courtCount]);

  const analyzeAndRecommend = () => {
    const allFormats: FormatOption[] = [
      {
        id: "doubles",
        name: "Doubles",
        description: "4 players per court. Teams rotate each round for balanced play.",
        playersPerCourt: 4,
        icon: "👥",
      },
      {
        id: "singles",
        name: "Singles",
        description: "2 players per court. Head-to-head matchups.",
        playersPerCourt: 2,
        icon: "🎾",
      },
      {
        id: "mixed-doubles",
        name: "Mixed Doubles",
        description: "4 players per court. One male, one female per team.",
        playersPerCourt: 4,
        icon: "👫",
        requiresGender: true,
      },
      {
        id: "king-of-court",
        name: "King of the Court",
        description: "Winners stay, losers rotate. Continuous play format.",
        playersPerCourt: 4,
        icon: "👑",
      },
      {
        id: "round-robin",
        name: "Team Round Robin",
        description: "Fixed partner pairs stay together all rounds. Add players in pairs: player 1 & 2 are partners, player 3 & 4 are partners, etc.",
        playersPerCourt: 4,
        icon: "🔄",
      },
      {
        id: "maximize-courts",
        name: "Maximize Courts",
        description: "Fills all courts optimally with mixed singles/doubles. Handles odd numbers with BY system.",
        playersPerCourt: 0, // Variable
        icon: "🎯",
      },
    ];

    // Recommendation logic
    const doublesIdeal = playerCount === courtCount * 4;
    const singlesIdeal = playerCount === courtCount * 2;
    const hasEnoughForDoubles = playerCount >= courtCount * 4;
    const hasEnoughForSingles = playerCount >= courtCount * 2;
    const hasOddOrMixed = playerCount % 4 !== 0 || (playerCount % 2 !== 0);

    const recommended = allFormats.map((format) => {
      let isRecommended = false;
      
      if (format.id === "doubles" && (doublesIdeal || (hasEnoughForDoubles && playerCount % 4 === 0))) {
        isRecommended = true;
      } else if (format.id === "singles" && (singlesIdeal || (hasEnoughForSingles && playerCount % 2 === 0))) {
        isRecommended = true;
      } else if (format.id === "king-of-court" && playerCount > courtCount * 4) {
        isRecommended = true;
      } else if (format.id === "maximize-courts" && hasOddOrMixed) {
        isRecommended = true;
      }

      return { ...format, recommended: isRecommended };
    });

    // Sort recommended first
    recommended.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
    setFormats(recommended);
  };

  const handleSelectFormat = async (formatId: string) => {
    setLoading(true);
    
    const { error } = await supabase
      .from("events")
      .update({ match_format: formatId })
      .eq("id", eventId);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error selecting format",
        description: error.message,
      });
      setLoading(false);
      return;
    }

    setSelectedFormat(formatId);
    
    toast({
      title: "Format selected!",
      description: `${formats.find(f => f.id === formatId)?.name} format will be used.`,
    });

    // Trigger event refresh in parent component
    onFormatUpdated?.();

    // Wait a moment then callback
    setTimeout(() => {
      onFormatSelected();
      setLoading(false);
    }, 500);
  };

  const getFormatPreview = (format: FormatOption) => {
    if (format.id === "maximize-courts") {
      // Calculate optimal mix
      const doublesCount = Math.floor(playerCount / 4);
      const remaining = playerCount % 4;
      const singlesCount = Math.floor(remaining / 2);
      const byCount = remaining % 2;
      
      return {
        matchesPerRound: doublesCount + singlesCount,
        playersPerRound: playerCount - byCount,
        sitOutCount: byCount,
        details: `${doublesCount} doubles${singlesCount > 0 ? ` + ${singlesCount} singles` : ""}${byCount > 0 ? " (1 BY)" : ""}`,
      };
    }

    const matchesPerRound = Math.floor(playerCount / format.playersPerCourt);
    const playersPerRound = matchesPerRound * format.playersPerCourt;
    const sitOutCount = playerCount - playersPerRound;

    return {
      matchesPerRound,
      playersPerRound,
      sitOutCount,
    };
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Select Event Format
          </CardTitle>
          <CardDescription>
            {playerCount} players · {courtCount} courts available
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {formats.map((format) => {
              const preview = getFormatPreview(format);
              const isSelected = selectedFormat === format.id;
              
              return (
                <Card
                  key={format.id}
                  className={`cursor-pointer transition-all hover:shadow-lg border-2 ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : format.recommended
                      ? "border-accent"
                      : "border-border"
                  }`}
                  onClick={() => !loading && handleSelectFormat(format.id)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-4xl">{format.icon}</span>
                        <div>
                          <CardTitle className="text-lg">{format.name}</CardTitle>
                          {format.recommended && (
                            <Badge variant="secondary" className="mt-1 gap-1">
                              <Sparkles className="h-3 w-3" />
                              Recommended
                            </Badge>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <CheckCircle className="h-6 w-6 text-primary" />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {format.description}
                    </p>
                    
                    <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                      <p className="font-medium">Preview:</p>
                      {(preview as any).details ? (
                        <p>• {(preview as any).details}</p>
                      ) : (
                        <p>• {preview.matchesPerRound} matches per round</p>
                      )}
                      <p>• {preview.playersPerRound} players active</p>
                      {preview.sitOutCount > 0 && (
                        <p className="text-muted-foreground">
                          • {preview.sitOutCount} {format.id === "maximize-courts" ? "on BY" : "sit out"}
                        </p>
                      )}
                    </div>
                    
                    {format.requiresGender && (
                      <Badge variant="outline" className="text-xs">
                        Requires gender info
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FormatSelector;