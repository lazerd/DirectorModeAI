'use client';

/**
 * Open-signup affordance on a reservation block.
 *
 * Three shapes, derived from capacity + count:
 *   - "+N spots" lime pulse pill (spots remain)
 *   - "Full ✓" filled lime pill (capacity reached) — scale-bounces when it flips
 *   - "Open" (no capacity, open RSVP) — simple pill
 */

import { Users, Check } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface Props {
  capacity: number | null;
  count: number;
  pitch: string | null;
  hexAccent: string;
  compact?: boolean;
}

export default function SignupPill({ capacity, count, pitch, hexAccent, compact }: Props) {
  const fullRef = useRef<HTMLDivElement>(null);
  const lastFull = useRef(false);
  const isFull = capacity !== null && count >= capacity;

  useEffect(() => {
    if (isFull && !lastFull.current && fullRef.current) {
      fullRef.current.classList.remove('cs-bounce');
      // Force reflow so the animation can re-trigger.
      void fullRef.current.offsetWidth;
      fullRef.current.classList.add('cs-bounce');
    }
    lastFull.current = isFull;
  }, [isFull]);

  if (isFull) {
    return (
      <div
        ref={fullRef}
        className={[
          'inline-flex items-center gap-1 rounded-full font-medium',
          compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]',
        ].join(' ')}
        style={{ background: '#D3FB52', color: '#001820' }}
      >
        <Check size={compact ? 9 : 10} strokeWidth={3} />
        Full
      </div>
    );
  }

  if (capacity === null) {
    return (
      <div
        className={[
          'inline-flex items-center gap-1 rounded-full font-medium',
          compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]',
          'border',
        ].join(' ')}
        style={{
          color: hexAccent,
          borderColor: `${hexAccent}66`,
          background: `${hexAccent}1A`,
        }}
      >
        <Users size={compact ? 9 : 10} />
        Open ({count})
      </div>
    );
  }

  const remaining = capacity - count;
  return (
    <div
      className={[
        'inline-flex items-center gap-1 rounded-full font-medium',
        compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]',
      ].join(' ')}
      style={{
        background: '#D3FB52',
        color: '#001820',
      }}
      title={pitch ?? undefined}
    >
      <span
        className="cs-signup-pulse-dot inline-block"
        style={{
          width: compact ? 5 : 6,
          height: compact ? 5 : 6,
          background: '#001820',
          color: '#001820',
        }}
      />
      +{remaining} spot{remaining === 1 ? '' : 's'}
    </div>
  );
}
