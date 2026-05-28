'use client';

/**
 * Week-at-a-glance heatmap strip.
 *
 * 7 day cells (today ± 3 by default), each showing:
 *   - Day-of-week + date
 *   - Load heatmap (0 / light / medium / heavy by reservation count)
 *   - "Today" badge
 *   - Active = current selected date
 *
 * Tap a cell → jump the sheet to that day.
 */

import { useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';

interface Props {
  /** Currently selected club-local YYYY-MM-DD. */
  date: string;
  todayISO: string;
  clubId: string;
  /** Called when a day cell is tapped. */
  onPick: (date: string) => void;
  /** Optional override: how many days to show centered on the current. */
  span?: number;
}

interface DayLoad {
  date: string;
  count: number;
}

export default function WeekStrip({ date, todayISO, clubId, onPick, span = 7 }: Props) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Build the visible window: anchor on the selected date, show span days
  // centered on it.
  const days = useMemo(() => {
    const anchor = parseISO(date);
    const half = Math.floor(span / 2);
    const arr: string[] = [];
    for (let i = -half; i < span - half; i++) {
      arr.push(format(addDays(anchor, i), 'yyyy-MM-dd'));
    }
    return arr;
  }, [date, span]);

  // Fetch reservation counts for the window. One round-trip.
  useEffect(() => {
    const start = days[0];
    const end = days[days.length - 1];
    if (!start || !end) return;
    let cancelled = false;
    fetch(`/api/courtsheet/reservations?start=${start}&end=${end}`, {
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const reservations = (data.reservations ?? []) as Array<{ starts_at: string }>;
        // Bucket by local date string for the WEEK STRIP — server returns
        // UTC, but display uses club-local. The slice is good enough for
        // the heatmap (off-by-one near midnight is fine for "at a glance").
        const map: Record<string, number> = {};
        for (const d of days) map[d] = 0;
        for (const r of reservations) {
          const k = r.starts_at.slice(0, 10);
          if (map[k] !== undefined) map[k]++;
        }
        setCounts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [days, clubId]);

  return (
    <div
      role="tablist"
      aria-label="Week at a glance"
      className="flex items-stretch gap-1 sm:gap-2 overflow-x-auto pb-1"
    >
      {days.map((d) => {
        const isActive = d === date;
        const isToday = d === todayISO;
        const count = counts[d] ?? 0;
        const heat = heatLevel(count);
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onPick(d)}
            className={[
              'shrink-0 rounded-xl border px-2.5 py-1.5 text-left transition',
              'min-w-[60px] sm:min-w-[78px]',
              isActive
                ? 'bg-[#D3FB52]/15 border-[#D3FB52]/40'
                : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]',
            ].join(' ')}
          >
            <div className="flex items-center justify-between">
              <span
                className={[
                  'text-[9px] uppercase tracking-widest',
                  isActive ? 'text-[#D3FB52]' : 'text-white/40',
                ].join(' ')}
              >
                {format(parseISO(d), 'EEE')}
              </span>
              {isToday && (
                <span className="text-[8px] uppercase tracking-widest text-emerald-300 ml-1">
                  •
                </span>
              )}
            </div>
            <div
              className={[
                'text-sm font-semibold tabular-nums leading-tight',
                isActive ? 'text-white' : 'text-white/80',
              ].join(' ')}
            >
              {format(parseISO(d), 'd')}
            </div>
            <div
              className={[
                'mt-1 h-1 rounded-full',
                heat === 0
                  ? 'bg-white/[0.06]'
                  : heat === 1
                  ? 'bg-[#D3FB52]/30'
                  : heat === 2
                  ? 'bg-[#D3FB52]/55'
                  : 'bg-[#D3FB52]',
              ].join(' ')}
              aria-label={`${count} reservation${count === 1 ? '' : 's'}`}
            />
          </button>
        );
      })}
    </div>
  );
}

function heatLevel(count: number): 0 | 1 | 2 | 3 {
  if (count === 0) return 0;
  if (count <= 4) return 1;
  if (count <= 12) return 2;
  return 3;
}
