'use client';

/**
 * CourtSheet — reservation block.
 *
 * Renders one block in the grid: glassy, color-tinted, with a source badge,
 * an optional signup pill, and (when "now" sits inside its time range) the
 * slow breathing glow. Drag/resize live on the parent grid via @dnd-kit;
 * this component just renders, with handles exposed via slots.
 */

import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Reservation } from '@/lib/courtsheet/types';
import { blockStyleFor, sourceLabel } from '@/lib/courtsheet/theme';
import SignupPill from './SignupPill';

interface Props {
  reservation: Reservation;
  /** Pixels from the column's top edge — pre-computed by the grid. */
  topPx: number;
  /** Block height in pixels. */
  heightPx: number;
  /** UTC ms timestamp of "now" — used to detect live blocks. */
  nowMs: number;
  /** Active signups count for this reservation (drives pill). */
  signupsCount?: number;
  /** Block is desaturated by an active filter. */
  desaturated?: boolean;
  /** Block is currently being dragged. */
  isDragging?: boolean;
  /** Drag handle props from @dnd-kit. */
  dragHandleProps?: Record<string, unknown>;
  /** Click → open drawer. */
  onClick?: () => void;
  /** Click on the deep-link icon → open the source tool. */
  onDeepLink?: () => void;
  /** Bottom resize handle drag start. */
  onResizeStart?: (e: React.PointerEvent) => void;
}

export default function Block({
  reservation: r,
  topPx,
  heightPx,
  nowMs,
  signupsCount,
  desaturated,
  isDragging,
  dragHandleProps,
  onClick,
  onDeepLink,
  onResizeStart,
}: Props) {
  const style = useMemo(() => blockStyleFor(r.type, r.color), [r.type, r.color]);
  const startMs = new Date(r.starts_at).getTime();
  const endMs = new Date(r.ends_at).getTime();
  const isLive = nowMs >= startMs && nowMs < endMs;
  const isPast = endMs <= nowMs;

  const showSignupPill = r.signups_open && r.status === 'confirmed';

  const heightClass = heightPx >= 64 ? 'tall' : heightPx >= 40 ? 'medium' : 'compact';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick?.();
      }}
      className={[
        'absolute left-1 right-1 rounded-xl border backdrop-blur-sm',
        'cursor-pointer select-none overflow-hidden',
        'transition-[transform,opacity,filter] duration-150',
        style.bg,
        style.border,
        isPast ? 'opacity-60' : '',
        isLive ? 'cs-block-live' : '',
        desaturated ? 'cs-desat' : '',
        isDragging ? 'opacity-50 scale-[0.98]' : '',
        'hover:brightness-110 hover:-translate-y-px',
        'focus:outline-none focus:ring-2 focus:ring-[#D3FB52]/40',
      ].join(' ')}
      style={{
        top: `${topPx}px`,
        height: `${Math.max(heightPx, 24)}px`,
        ['--cs-block-glow' as string]: style.glow,
      }}
      {...(dragHandleProps ?? {})}
    >
      {/* Left source-color rail. */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: style.hex }}
      />

      <div className="pl-3 pr-2 py-1.5 h-full flex flex-col justify-between">
        {/* Top row: title + deep-link */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div
              className={[
                'font-medium truncate',
                heightClass === 'compact' ? 'text-[11px] leading-tight' : 'text-[12.5px] leading-tight',
                'text-white',
              ].join(' ')}
            >
              {r.title}
            </div>
            {heightClass !== 'compact' && (
              <div className="text-[10px] uppercase tracking-widest text-white/40 mt-0.5">
                {sourceLabel(r.source)}
              </div>
            )}
          </div>

          {r.source !== 'manual' && r.source !== 'ai' && onDeepLink && heightClass === 'tall' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeepLink();
              }}
              className="shrink-0 p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10"
              aria-label="Open in source tool"
              title={`Open in ${sourceLabel(r.source)}`}
            >
              <ExternalLink size={11} />
            </button>
          )}
        </div>

        {/* Bottom row: signup pill */}
        {showSignupPill && heightClass !== 'compact' && (
          <div className="mt-1">
            <SignupPill
              capacity={r.signups_capacity}
              count={signupsCount ?? 0}
              pitch={r.signups_pitch}
              hexAccent={style.hex}
              compact={heightClass === 'medium'}
            />
          </div>
        )}
      </div>

      {/* Bottom resize handle. */}
      {onResizeStart && (
        <div
          onPointerDown={onResizeStart}
          className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize"
          aria-label="Resize"
        >
          <div className="mx-auto mt-[2px] h-[3px] w-8 rounded-full bg-white/10" />
        </div>
      )}
    </div>
  );
}
