'use client';

/**
 * CourtSheet — the grid.
 *
 * Courts as columns, time as rows. Day view. Mobile = horizontal scroll
 * snap (one court per viewport); desktop = grid with all courts visible.
 *
 * Interactions:
 *   - Tap/click an empty cell → onEmptyCellClick(court, time)
 *   - Tap/click a block → onBlockClick(reservation)
 *   - Drag a block (pointer drag) → optimistic ghost preview, plan+apply on drop
 *   - Drag the resize handle → adjust end time, plan+apply on drop
 *
 * Implementation note: dnd-kit handles activation and pointer tracking
 * but here we use a simpler raw-pointer approach because we need precise
 * time-snapping (15-min grid) and conflict-detection feedback that the
 * generic dnd-kit overlay doesn't give us cleanly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Court, Reservation } from '@/lib/courtsheet/types';
import { utcToLocalDate, utcToLocalTime, localToUtc, timeToMinutes, minutesToTime } from '@/lib/courtsheet/timezones';
import Block from './Block';

interface Props {
  club: { id: string; timezone: string };
  courts: Court[];
  reservations: Reservation[];
  /** Active signup counts keyed by reservation_id. */
  signupCountsById?: Record<string, number>;
  /** Set of sources currently filtered (desaturated). */
  desaturatedSources?: Set<string>;
  /** Set of types currently filtered (desaturated). */
  desaturatedTypes?: Set<string>;
  /** Club-local YYYY-MM-DD. */
  date: string;
  /** First visible hour (default 6). */
  dayStartHour?: number;
  /** Last visible hour (default 22). */
  dayEndHour?: number;
  /** Snap granularity in minutes. */
  snapMinutes?: number;
  /** Pixels per hour. Mobile defaults to 80, desktop 60. */
  hourHeightPx?: number;
  onBlockClick?: (r: Reservation) => void;
  onEmptyCellClick?: (court: Court, dateLocal: string, timeLocal: string) => void;
  onBlockMove?: (
    r: Reservation,
    target: { court_id: string; starts_at: string; ends_at: string }
  ) => Promise<void>;
  onBlockResize?: (r: Reservation, ends_at: string) => Promise<void>;
  /** Sheet is in read-only mode (Free tier or member). */
  readOnly?: boolean;
}

interface DragState {
  reservationId: string;
  mode: 'move' | 'resize';
  startPointerY: number;
  startPointerX: number;
  startTopPx: number;
  startHeightPx: number;
  startCourtIdx: number;
  ghostTopPx: number;
  ghostHeightPx: number;
  ghostCourtIdx: number;
  conflicting: boolean;
}

export default function Sheet({
  club,
  courts,
  reservations,
  signupCountsById,
  desaturatedSources,
  desaturatedTypes,
  date,
  dayStartHour = 6,
  dayEndHour = 22,
  snapMinutes = 15,
  hourHeightPx,
  onBlockClick,
  onEmptyCellClick,
  onBlockMove,
  onBlockResize,
  readOnly,
}: Props) {
  const [hoverGhost, setHoverGhost] = useState<{
    courtIdx: number;
    topPx: number;
    timeLocal: string;
  } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Live tick of "now" — 30s is plenty for a grid where rows are ≥15min.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const isMobile = useMobileViewport();
  const effectiveHourHeight = hourHeightPx ?? (isMobile ? 84 : 60);
  const minuteHeight = effectiveHourHeight / 60;
  const totalMinutes = (dayEndHour - dayStartHour) * 60;
  const totalHeightPx = totalMinutes * minuteHeight;

  const dayStartUtcMs = useMemo(
    () => localToUtc(date, `${String(dayStartHour).padStart(2, '0')}:00`, club.timezone).getTime(),
    [date, dayStartHour, club.timezone]
  );

  // Now-line top position (pixels). Only render if the current minute is
  // within the visible day window AND the date matches today.
  const nowLineTopPx = useMemo(() => {
    const nowDate = utcToLocalDate(new Date(nowMs), club.timezone);
    if (nowDate !== date) return null;
    const nowMinutes = timeToMinutes(utcToLocalTime(new Date(nowMs), club.timezone));
    const startMinutes = dayStartHour * 60;
    const endMinutes = dayEndHour * 60;
    if (nowMinutes < startMinutes || nowMinutes > endMinutes) return null;
    return (nowMinutes - startMinutes) * minuteHeight;
  }, [nowMs, club.timezone, date, dayStartHour, dayEndHour, minuteHeight]);

  // Auto-scroll to "now" on mount (if today). Centers the now-line in viewport.
  const containerRef = useRef<HTMLDivElement>(null);
  const scrolledToNowRef = useRef(false);
  useEffect(() => {
    if (scrolledToNowRef.current) return;
    if (nowLineTopPx === null) return;
    const el = containerRef.current;
    if (!el) return;
    const target = Math.max(0, nowLineTopPx - el.clientHeight / 2);
    el.scrollTo({ top: target, behavior: 'smooth' });
    scrolledToNowRef.current = true;
  }, [nowLineTopPx]);

  // Map reservations → per-column placements (top/height in px).
  const placementsByCourt = useMemo(() => {
    const map: Record<string, Array<{ res: Reservation; topPx: number; heightPx: number }>> = {};
    for (const c of courts) map[c.id] = [];
    for (const r of reservations) {
      const startLocal = utcToLocalTime(r.starts_at, club.timezone);
      const endLocal = utcToLocalTime(r.ends_at, club.timezone);
      const startM = timeToMinutes(startLocal);
      const endM = timeToMinutes(endLocal);
      const dayStartM = dayStartHour * 60;
      const topPx = (startM - dayStartM) * minuteHeight;
      const heightPx = Math.max(8, (endM - startM) * minuteHeight);
      if (!map[r.court_id]) map[r.court_id] = [];
      map[r.court_id].push({ res: r, topPx, heightPx });
    }
    return map;
  }, [reservations, courts, club.timezone, dayStartHour, minuteHeight]);

  // Hour-row gridlines.
  const hourLines = useMemo(() => {
    const lines: Array<{ hour: number; topPx: number }> = [];
    for (let h = dayStartHour; h <= dayEndHour; h++) {
      lines.push({ hour: h, topPx: (h - dayStartHour) * 60 * minuteHeight });
    }
    return lines;
  }, [dayStartHour, dayEndHour, minuteHeight]);

  const pixelsToTimeLocal = useCallback(
    (px: number): string => {
      const minutesFromStart = Math.round(px / minuteHeight / snapMinutes) * snapMinutes;
      const m = dayStartHour * 60 + minutesFromStart;
      return minutesToTime(Math.max(0, Math.min(24 * 60 - snapMinutes, m)));
    },
    [minuteHeight, snapMinutes, dayStartHour]
  );

  const handleCellPointerMove = useCallback(
    (courtIdx: number, e: React.PointerEvent<HTMLDivElement>) => {
      if (readOnly || drag) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const py = e.clientY - rect.top;
      const snappedTopPx = Math.floor(py / (minuteHeight * snapMinutes)) * (minuteHeight * snapMinutes);
      setHoverGhost({
        courtIdx,
        topPx: snappedTopPx,
        timeLocal: pixelsToTimeLocal(snappedTopPx),
      });
    },
    [drag, minuteHeight, snapMinutes, pixelsToTimeLocal, readOnly]
  );

  const handleCellPointerLeave = useCallback(() => {
    if (!drag) setHoverGhost(null);
  }, [drag]);

  const handleCellClick = useCallback(
    (court: Court, e: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const py = e.clientY - rect.top;
      const snappedTopPx = Math.floor(py / (minuteHeight * snapMinutes)) * (minuteHeight * snapMinutes);
      onEmptyCellClick?.(court, date, pixelsToTimeLocal(snappedTopPx));
    },
    [readOnly, minuteHeight, snapMinutes, onEmptyCellClick, date, pixelsToTimeLocal]
  );

  // ---- drag/resize ----

  const beginDrag = useCallback(
    (
      r: Reservation,
      mode: 'move' | 'resize',
      placement: { topPx: number; heightPx: number },
      courtIdx: number,
      e: React.PointerEvent
    ) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDrag({
        reservationId: r.id,
        mode,
        startPointerY: e.clientY,
        startPointerX: e.clientX,
        startTopPx: placement.topPx,
        startHeightPx: placement.heightPx,
        startCourtIdx: courtIdx,
        ghostTopPx: placement.topPx,
        ghostHeightPx: placement.heightPx,
        ghostCourtIdx: courtIdx,
        conflicting: false,
      });
    },
    [readOnly]
  );

  const updateDrag = useCallback(
    (e: PointerEvent) => {
      if (!drag) return;
      const dy = e.clientY - drag.startPointerY;
      const snapPx = minuteHeight * snapMinutes;
      const snappedDy = Math.round(dy / snapPx) * snapPx;

      if (drag.mode === 'resize') {
        const ghostHeightPx = Math.max(snapPx, drag.startHeightPx + snappedDy);
        const candidateEndsLocal = pixelsToTimeLocal(drag.startTopPx + ghostHeightPx);
        const candidateEndsMs = localToUtc(date, candidateEndsLocal, club.timezone).getTime();
        const candidateStartsMs = localToUtc(date, pixelsToTimeLocal(drag.startTopPx), club.timezone).getTime();
        // Check overlap with other reservations in same court.
        const sameCourt = reservations.filter(
          (r) => r.court_id === courts[drag.startCourtIdx]?.id && r.id !== drag.reservationId
        );
        const conflicting = sameCourt.some((r) => {
          const sM = new Date(r.starts_at).getTime();
          const eM = new Date(r.ends_at).getTime();
          return sM < candidateEndsMs && candidateStartsMs < eM;
        });
        setDrag({ ...drag, ghostHeightPx, conflicting });
        return;
      }

      // Move.
      const ghostTopPx = Math.max(0, drag.startTopPx + snappedDy);
      // Horizontal court swap detection: by pointer X delta against measured column width.
      const dx = e.clientX - drag.startPointerX;
      const colEl = document.querySelector(
        `[data-court-idx="${drag.startCourtIdx}"]`
      ) as HTMLElement | null;
      const colWidth = colEl?.getBoundingClientRect().width ?? 1;
      const colShift = Math.round(dx / colWidth);
      const ghostCourtIdx = Math.max(0, Math.min(courts.length - 1, drag.startCourtIdx + colShift));

      const candidateCourtId = courts[ghostCourtIdx]?.id;
      const candidateStartsLocal = pixelsToTimeLocal(ghostTopPx);
      const candidateEndsLocal = pixelsToTimeLocal(ghostTopPx + drag.startHeightPx);
      const candidateStartsMs = localToUtc(date, candidateStartsLocal, club.timezone).getTime();
      const candidateEndsMs = localToUtc(date, candidateEndsLocal, club.timezone).getTime();
      const conflicting = reservations.some((r) => {
        if (r.id === drag.reservationId) return false;
        if (r.court_id !== candidateCourtId) return false;
        const sM = new Date(r.starts_at).getTime();
        const eM = new Date(r.ends_at).getTime();
        return sM < candidateEndsMs && candidateStartsMs < eM;
      });

      setDrag({ ...drag, ghostTopPx, ghostCourtIdx, conflicting });
    },
    [drag, minuteHeight, snapMinutes, pixelsToTimeLocal, courts, club.timezone, date, reservations]
  );

  const endDrag = useCallback(async () => {
    if (!drag) return;
    const r = reservations.find((rr) => rr.id === drag.reservationId);
    if (!r) {
      setDrag(null);
      return;
    }
    if (drag.conflicting) {
      // Snap-back animation, then drop.
      const el = document.querySelector(`[data-rid="${drag.reservationId}"]`);
      el?.classList.add('cs-shake');
      setTimeout(() => el?.classList.remove('cs-shake'), 360);
      setDrag(null);
      return;
    }
    try {
      if (drag.mode === 'resize') {
        const newEndsLocal = pixelsToTimeLocal(drag.startTopPx + drag.ghostHeightPx);
        const newEndsAt = localToUtc(date, newEndsLocal, club.timezone).toISOString();
        await onBlockResize?.(r, newEndsAt);
      } else {
        const newCourt = courts[drag.ghostCourtIdx];
        const startsLocal = pixelsToTimeLocal(drag.ghostTopPx);
        const endsLocal = pixelsToTimeLocal(drag.ghostTopPx + drag.startHeightPx);
        await onBlockMove?.(r, {
          court_id: newCourt.id,
          starts_at: localToUtc(date, startsLocal, club.timezone).toISOString(),
          ends_at: localToUtc(date, endsLocal, club.timezone).toISOString(),
        });
      }
    } finally {
      setDrag(null);
    }
  }, [drag, reservations, pixelsToTimeLocal, date, club.timezone, courts, onBlockMove, onBlockResize]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => updateDrag(e);
    const onUp = () => endDrag();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, updateDrag, endDrag]);

  return (
    <div className="relative w-full bg-[#001820] text-white">
      {/* Time gutter is shared on the left. */}
      <div className="flex">
        <div
          className="w-12 shrink-0 sticky left-0 z-20 bg-[#001820]/95 backdrop-blur-sm border-r border-white/5"
          style={{ height: totalHeightPx }}
        >
          {hourLines.map((line) => (
            <div
              key={line.hour}
              className="absolute right-2 text-[10px] font-mono tabular-nums uppercase tracking-wider text-white/30"
              style={{ top: `${line.topPx - 6}px` }}
            >
              {String(line.hour).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Court strip: horizontal on mobile (snap), grid on desktop. */}
        <div
          ref={containerRef}
          className={[
            'relative flex-1',
            isMobile ? 'overflow-x-auto snap-x snap-mandatory' : 'overflow-x-auto',
          ].join(' ')}
          style={{ height: totalHeightPx }}
        >
          <div
            className="flex"
            style={{ height: totalHeightPx, width: isMobile ? `${courts.length * 100}vw` : 'auto' }}
          >
            {courts.map((court, idx) => {
              const placements = placementsByCourt[court.id] ?? [];
              const colWidth = isMobile ? '100vw' : `${Math.max(150, 1100 / Math.max(courts.length, 1))}px`;
              return (
                <div
                  key={court.id}
                  data-court-idx={idx}
                  className={[
                    'relative shrink-0 border-r border-white/5',
                    isMobile ? 'snap-start' : '',
                  ].join(' ')}
                  style={{ width: colWidth, height: totalHeightPx }}
                  onPointerMove={(e) => handleCellPointerMove(idx, e)}
                  onPointerLeave={handleCellPointerLeave}
                  onClick={(e) => {
                    // Only treat as "empty click" if the click landed on the column bg.
                    if (e.target === e.currentTarget) handleCellClick(court, e);
                  }}
                >
                  {/* Hour gridlines */}
                  {hourLines.map((line) => (
                    <div
                      key={line.hour}
                      className="absolute left-0 right-0 border-t border-white/[0.04]"
                      style={{ top: `${line.topPx}px` }}
                    />
                  ))}

                  {/* Empty-cell hover preview */}
                  {!readOnly && hoverGhost && hoverGhost.courtIdx === idx && !drag && (
                    <div
                      className="cs-hover-ghost absolute left-1 right-1 pointer-events-none flex items-end justify-center pb-1"
                      style={{
                        top: `${hoverGhost.topPx}px`,
                        height: `${60 * minuteHeight}px`,
                      }}
                    >
                      <div className="text-[10px] font-mono tabular-nums uppercase tracking-widest text-[#D3FB52]/70">
                        + book at {hoverGhost.timeLocal}
                      </div>
                    </div>
                  )}

                  {/* Drag ghost preview */}
                  {drag && drag.ghostCourtIdx === idx && (
                    <div
                      className="cs-ghost absolute left-1 right-1"
                      style={{
                        top: `${drag.ghostTopPx}px`,
                        height: `${drag.ghostHeightPx}px`,
                      }}
                    />
                  )}

                  {/* Reservation blocks */}
                  {placements.map(({ res, topPx, heightPx }) => {
                    const isDesat =
                      (desaturatedSources?.has(res.source) ?? false) ||
                      (desaturatedTypes?.has(res.type) ?? false);
                    const isDragging = drag?.reservationId === res.id;
                    return (
                      <div key={res.id} data-rid={res.id} className="contents">
                        <Block
                          reservation={res}
                          topPx={topPx}
                          heightPx={heightPx}
                          nowMs={nowMs}
                          signupsCount={signupCountsById?.[res.id]}
                          desaturated={isDesat}
                          isDragging={isDragging}
                          dragHandleProps={
                            readOnly
                              ? {}
                              : {
                                  onPointerDown: (e: React.PointerEvent) =>
                                    beginDrag(res, 'move', { topPx, heightPx }, idx, e),
                                }
                          }
                          onClick={() => onBlockClick?.(res)}
                          onResizeStart={
                            readOnly
                              ? undefined
                              : (e) =>
                                  beginDrag(res, 'resize', { topPx, heightPx }, idx, e)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Now line (overlay across all columns). */}
          {nowLineTopPx !== null && (
            <>
              <div className="cs-now-line" style={{ top: `${nowLineTopPx}px` }}>
                <div className="cs-now-badge">
                  {utcToLocalTime(new Date(nowMs), club.timezone)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sticky court header strip (rendered ABOVE the grid by parent — see staff/page) */}
    </div>
  );
}

function useMobileViewport(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 640
  );
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mobile;
}
