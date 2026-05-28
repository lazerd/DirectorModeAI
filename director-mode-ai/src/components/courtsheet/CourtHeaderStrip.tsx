'use client';

/**
 * Sticky court header strip — number / name / live indicator per court.
 *
 * On mobile, courts are a horizontal scroll-snap carousel below; the
 * header here is just one "current court" indicator at the top. On
 * desktop, the header is a flex row matching column widths.
 */

import { useMemo } from 'react';
import type { Court, Reservation } from '@/lib/courtsheet/types';

interface Props {
  courts: Court[];
  reservations: Reservation[];
  nowMs: number;
  isMobile: boolean;
  hourGutterPx?: number;
}

export default function CourtHeaderStrip({
  courts,
  reservations,
  nowMs,
  isMobile,
  hourGutterPx = 48,
}: Props) {
  const liveByCourt = useMemo(() => {
    const m: Record<string, Reservation | undefined> = {};
    for (const r of reservations) {
      const s = new Date(r.starts_at).getTime();
      const e = new Date(r.ends_at).getTime();
      if (nowMs >= s && nowMs < e && r.status !== 'cancelled') m[r.court_id] = r;
    }
    return m;
  }, [reservations, nowMs]);

  if (isMobile) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-widest text-white/40">
        <span>{courts.length} courts</span>
        <span className="text-white/20">·</span>
        <span>scroll →</span>
      </div>
    );
  }

  const totalCols = courts.length;
  const colWidth = `${Math.max(150, 1100 / Math.max(totalCols, 1))}px`;

  return (
    <div className="sticky top-0 z-30 flex bg-[#001820]/95 backdrop-blur-md border-b border-white/[0.06]">
      <div className="shrink-0 border-r border-white/[0.04]" style={{ width: hourGutterPx }} />
      <div className="flex">
        {courts.map((c) => {
          const live = liveByCourt[c.id];
          return (
            <div
              key={c.id}
              className="shrink-0 px-2 py-3 flex items-center gap-2 border-r border-white/[0.04]"
              style={{ width: colWidth }}
            >
              <div
                className={[
                  'h-7 w-7 rounded-full flex items-center justify-center',
                  'bg-[#D3FB52]/10 border border-[#D3FB52]/20',
                  'font-semibold text-[#D3FB52] text-[11px]',
                ].join(' ')}
              >
                {c.number ?? (c.name ?? '?').slice(0, 3)}
              </div>
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-white/90 truncate">
                  {c.name ?? `Court ${c.number}`}
                </div>
                <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-white/40">
                  <span
                    className={[
                      'inline-block w-1.5 h-1.5 rounded-full',
                      live ? 'bg-emerald-400 animate-pulse' : 'bg-white/20',
                    ].join(' ')}
                  />
                  {live ? 'In use' : 'Free'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
