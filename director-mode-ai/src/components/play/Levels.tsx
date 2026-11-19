'use client';

import { LEVEL_SCALE, levelNum, type LevelSport } from '@/lib/play/levels';
import { C } from './shared';

const scale = (sport: string) => LEVEL_SCALE[(sport as LevelSport) in LEVEL_SCALE ? (sport as LevelSport) : 'tennis'];

/** A row of level chips in the sport's own scale (NTRP / DUPR / Playtomic). Tap again to clear. */
export function LevelChips({ sport, value, onChange, dark, size = 'md' }: { sport: string; value: number | null; onChange: (v: number | null) => void; dark?: boolean; size?: 'sm' | 'md' }) {
  const sc = scale(sport);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`mr-1 font-semibold ${size === 'sm' ? 'text-[11px]' : 'text-[12px]'}`} style={{ color: dark ? '#bccdbb' : C.muted }}>{sc.name}</span>
      {sc.picks.map((n) => {
        const on = value === n;
        return (
          <button key={n} type="button" onClick={() => onChange(on ? null : n)} aria-pressed={on}
            className={`rounded-lg font-semibold tabular-nums ${size === 'sm' ? 'px-2 py-1 text-[12px]' : 'px-2.5 py-1.5 text-[13px]'}`}
            style={on ? { background: C.lime, color: C.ink } : dark ? { background: '#ffffff14', color: '#fff' } : { background: '#eef1e8', color: C.ink }}>
            {levelNum(n)}
          </button>
        );
      })}
    </div>
  );
}

/** Quick ranges for a host: "3.0–3.5", "3.5–4.0", "4.0+". */
export function levelPresets(sport: string): string[] {
  if (sport === 'pickleball') return ['3.0–3.5', '3.5–4.0', '4.0–4.5', '4.5+'];
  if (sport === 'padel') return ['Beginner', '2.0–3.0', '3.0–4.0', '4.0+'];
  return ['3.0–3.5', '3.5–4.0', '4.0–4.5', '4.5+'];
}
