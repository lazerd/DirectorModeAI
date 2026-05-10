'use client';

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";

interface PublicRoundTimerProps {
  startTime: string;
  pausedAt: string | null;
  durationMinutes: number;
  roundNumber: number;
}

const PublicRoundTimer = ({ startTime, pausedAt, durationMinutes, roundNumber }: PublicRoundTimerProps) => {
  const [now, setNow] = useState(() => Date.now());

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
  const isDone = timeRemaining === 0 && !isPaused;

  return (
    <Card className={`border-4 transition-all ${isPaused ? "bg-muted/40 border-muted-foreground/40" : isDone ? "bg-muted border-muted-foreground/30" : isLow ? "bg-destructive/10 border-destructive animate-pulse" : "bg-primary/5 border-primary/30"}`}>
      <CardContent className="py-6 sm:py-8">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Clock className={`h-4 w-4 ${isLow ? "text-destructive" : "text-primary"}`} />
            Round {roundNumber} — {isPaused ? "Paused" : "Time Remaining"}
          </div>
          <p className={`text-6xl sm:text-7xl font-black tabular-nums tracking-tight ${isPaused ? "text-muted-foreground" : isDone ? "text-muted-foreground" : isLow ? "text-destructive" : "text-primary"}`}>
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
