'use client';

/**
 * Source/type filter chips — toggling a chip DESATURATES matching blocks
 * (doesn't hide them). Spatial memory preserved.
 */

import { allReservationSources, allReservationTypes, sourceLabel, typeLabel } from '@/lib/courtsheet/theme';
import type { ReservationSource, ReservationType } from '@/lib/courtsheet/types';

interface Props {
  desaturatedSources: Set<string>;
  desaturatedTypes: Set<string>;
  onToggleSource: (s: ReservationSource) => void;
  onToggleType: (t: ReservationType) => void;
}

export default function Filters({
  desaturatedSources,
  desaturatedTypes,
  onToggleSource,
  onToggleType,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allReservationTypes().map((t) => {
        const off = desaturatedTypes.has(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggleType(t)}
            className={[
              'px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-widest border transition',
              off
                ? 'bg-transparent text-white/30 border-white/10'
                : 'bg-white/10 text-white/80 border-white/15 hover:bg-white/15',
            ].join(' ')}
            aria-pressed={!off}
          >
            {typeLabel(t)}
          </button>
        );
      })}
      <span className="mx-1 text-white/20">·</span>
      {allReservationSources().map((s) => {
        const off = desaturatedSources.has(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onToggleSource(s)}
            className={[
              'px-2.5 py-1 rounded-full text-[10px] uppercase tracking-widest border transition',
              off
                ? 'bg-transparent text-white/30 border-white/10'
                : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10',
            ].join(' ')}
            aria-pressed={!off}
          >
            {sourceLabel(s)}
          </button>
        );
      })}
    </div>
  );
}
