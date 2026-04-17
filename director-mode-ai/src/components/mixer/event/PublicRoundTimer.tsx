'use client';

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";

interface PublicRoundTimerProps {
  startTime: string;
  durationMinutes: number;
  roundNumber: number;
}

const PublicRoundTimer = ({ startTime, durationMinutes, roundNumber }: PublicRoundTimerProps) => {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  useEffect(() => {
    const tick = () => {
      const start = new Date(startTime).getTime();
      const end = start + durationMinutes * 60 * 1000;
      setTimeRemaining(Math.max(0, end - Date.now()));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTime, durationMinutes]);

  const minutes = Math.floor(timeRemaining / 60000);
  const seconds = Math.floor((timeRemaining % 60000) / 1000);
  const isLow = timeRemaining > 0 && minutes < 2;
  const isDone = timeRemaining === 0;

  return (
    <Card className={`border-4 transition-all ${isDone ? "bg-muted border-muted-foreground/30" : isLow ? "bg-destructive/10 border-destructive animate-pulse" : "bg-primary/5 border-primary/30"}`}>
      <CardContent className="py-6 sm:py-8">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Clock className={`h-4 w-4 ${isLow && !isDone ? "text-destructive" : "text-primary"}`} />
            Round {roundNumber} — Time Remaining
          </div>
          <p className={`text-6xl sm:text-7xl font-black tabular-nums tracking-tight ${isDone ? "text-muted-foreground" : isLow ? "text-destructive" : "text-primary"}`}>
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </p>
          {isDone && (
            <p className="text-destructive text-lg font-bold">Time's up!</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default PublicRoundTimer;
