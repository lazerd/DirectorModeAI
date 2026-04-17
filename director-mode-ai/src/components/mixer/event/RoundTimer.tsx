import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Play, Pause, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface RoundTimerProps {
  roundId: string;
  startTime: string;
  pausedAt: string | null;
  durationMinutes: number;
  onTimerChange?: () => void;
}

const RoundTimer = ({ roundId, startTime, pausedAt, durationMinutes, onTimerChange }: RoundTimerProps) => {
  const { toast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);

  const startMs = new Date(startTime).getTime();
  const durationMs = durationMinutes * 60 * 1000;
  const pausedMs = pausedAt ? new Date(pausedAt).getTime() : null;
  const isPaused = pausedMs !== null;

  const elapsedMs = isPaused ? Math.max(0, pausedMs! - startMs) : Math.max(0, now - startMs);
  const timeRemaining = Math.max(0, durationMs - elapsedMs);

  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isPaused]);

  const minutes = Math.floor(timeRemaining / 60000);
  const seconds = Math.floor((timeRemaining % 60000) / 1000);
  const isLow = !isPaused && timeRemaining > 0 && minutes < 2;

  const handlePauseToggle = async () => {
    setSaving(true);
    if (isPaused) {
      // Resume: shift start_time forward by the paused duration so elapsed stays the same.
      const pauseDuration = Date.now() - pausedMs!;
      const newStart = new Date(startMs + pauseDuration).toISOString();
      const { error } = await supabase
        .from("rounds")
        .update({ start_time: newStart, timer_paused_at: null })
        .eq("id", roundId);
      if (error) toast({ variant: "destructive", title: "Couldn't resume timer", description: error.message });
    } else {
      const { error } = await supabase
        .from("rounds")
        .update({ timer_paused_at: new Date().toISOString() })
        .eq("id", roundId);
      if (error) toast({ variant: "destructive", title: "Couldn't pause timer", description: error.message });
    }
    setSaving(false);
    onTimerChange?.();
  };

  const handleReset = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("rounds")
      .update({ start_time: new Date().toISOString(), timer_paused_at: null })
      .eq("id", roundId);
    if (error) toast({ variant: "destructive", title: "Couldn't reset timer", description: error.message });
    setSaving(false);
    onTimerChange?.();
  };

  return (
    <Card className={`border-4 transition-all ${isPaused ? "bg-muted/40 border-muted-foreground/40" : isLow ? "bg-destructive/10 border-destructive animate-pulse" : "bg-primary/5 border-primary/30"}`}>
      <CardContent className="py-10">
        <div className="flex flex-col items-center gap-6">
          <Clock className={`h-12 w-12 ${isPaused ? "text-muted-foreground" : isLow ? "text-destructive" : "text-primary"}`} />
          <div className="text-center">
            <p className="text-base font-medium text-muted-foreground mb-3">
              {isPaused ? "Paused" : "Time Remaining"}
            </p>
            <p className={`text-7xl md:text-8xl font-black tabular-nums tracking-tight ${isPaused ? "text-muted-foreground" : isLow ? "text-destructive" : "text-primary"}`}>
              {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
            </p>
          </div>
          {timeRemaining === 0 && !isPaused && (
            <p className="text-destructive text-xl font-bold animate-bounce">Time's up!</p>
          )}
          <div className="flex gap-3 mt-4">
            <Button
              size="lg"
              variant={isPaused ? "default" : "outline"}
              onClick={handlePauseToggle}
              disabled={saving}
              className="px-8"
            >
              {isPaused ? (
                <>
                  <Play className="h-5 w-5 mr-2" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="h-5 w-5 mr-2" />
                  Pause
                </>
              )}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={handleReset}
              disabled={saving}
              className="px-8"
            >
              <RotateCcw className="h-5 w-5 mr-2" />
              Reset
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default RoundTimer;
