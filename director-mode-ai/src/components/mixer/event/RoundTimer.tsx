import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Play, Pause, RotateCcw } from "lucide-react";

interface RoundTimerProps {
  startTime: string;
  durationMinutes: number;
}

const RoundTimer = ({ startTime, durationMinutes }: RoundTimerProps) => {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  useEffect(() => {
    const calculateTimeRemaining = () => {
      if (isPaused && pausedAt !== null) {
        setTimeRemaining(pausedAt);
        return;
      }

      const start = new Date(startTime).getTime();
      const duration = durationMinutes * 60 * 1000;
      const end = start + duration;
      const now = Date.now();
      const remaining = Math.max(0, end - now);
      setTimeRemaining(remaining);
    };

    calculateTimeRemaining();
    const interval = setInterval(calculateTimeRemaining, 1000);

    return () => clearInterval(interval);
  }, [startTime, durationMinutes, isPaused, pausedAt]);

  const minutes = Math.floor(timeRemaining / 60000);
  const seconds = Math.floor((timeRemaining % 60000) / 1000);
  const isLow = minutes < 2 && !isPaused;

  const handlePause = () => {
    if (isPaused) {
      setIsPaused(false);
      setPausedAt(null);
    } else {
      setIsPaused(true);
      setPausedAt(timeRemaining);
    }
  };

  const handleReset = () => {
    setIsPaused(false);
    setPausedAt(null);
    setTimeRemaining(durationMinutes * 60 * 1000);
  };

  return (
    <Card className={`border-4 transition-all ${isLow ? "bg-destructive/10 border-destructive animate-pulse" : "bg-primary/5 border-primary/30"}`}>
      <CardContent className="py-10">
        <div className="flex flex-col items-center gap-6">
          <Clock className={`h-12 w-12 ${isLow ? "text-destructive" : "text-primary"}`} />
          <div className="text-center">
            <p className="text-base font-medium text-muted-foreground mb-3">Time Remaining</p>
            <p className={`text-7xl md:text-8xl font-black tabular-nums tracking-tight ${isLow ? "text-destructive" : "text-primary"}`}>
              {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
            </p>
          </div>
          {timeRemaining === 0 && (
            <p className="text-destructive text-xl font-bold animate-bounce">Time's up!</p>
          )}
          <div className="flex gap-3 mt-4">
            <Button
              size="lg"
              variant={isPaused ? "default" : "outline"}
              onClick={handlePause}
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
