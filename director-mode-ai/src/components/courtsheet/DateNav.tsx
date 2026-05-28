'use client';

/**
 * Date nav strip — prev/today/next + an inline date picker.
 *
 * Mobile: swipe the surrounding sheet area to navigate days. The nav here
 * exposes the same actions as buttons for accessibility.
 */

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalIcon } from 'lucide-react';
import { format, parseISO, addDays } from 'date-fns';

interface Props {
  /** Club-local YYYY-MM-DD. */
  date: string;
  onChange: (date: string) => void;
  /** "Today" in the club's local time (computed by the parent). */
  todayISO: string;
}

export default function DateNav({ date, onChange, todayISO }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const isToday = date === todayISO;
  const parsed = parseISO(date);
  const dayLabel = format(parsed, 'EEE'); // Mon
  const dateLabel = format(parsed, 'MMM d'); // Jun 15
  const yearLabel = format(parsed, 'yyyy');

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={() => onChange(format(addDays(parsed, -1), 'yyyy-MM-dd'))}
        className="h-9 w-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition"
        aria-label="Previous day"
      >
        <ChevronLeft size={16} />
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowPicker((v) => !v)}
          className="flex items-center gap-2 px-3 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/90"
        >
          <CalIcon size={14} className="text-[#D3FB52]" />
          <span className="text-[11px] uppercase tracking-widest text-white/50">{dayLabel}</span>
          <span className="text-sm font-medium tabular-nums">{dateLabel}</span>
          <span className="text-xs text-white/40 tabular-nums">{yearLabel}</span>
        </button>
        {showPicker && (
          <div className="absolute top-11 left-0 z-40 p-2 rounded-2xl bg-[#002838] border border-white/10 shadow-2xl">
            <input
              type="date"
              value={date}
              onChange={(e) => {
                onChange(e.target.value);
                setShowPicker(false);
              }}
              className="px-3 py-2 rounded-lg text-sm"
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onChange(format(addDays(parsed, 1), 'yyyy-MM-dd'))}
        className="h-9 w-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition"
        aria-label="Next day"
      >
        <ChevronRight size={16} />
      </button>

      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(todayISO)}
          className="h-9 px-3 rounded-xl bg-[#D3FB52]/10 hover:bg-[#D3FB52]/15 border border-[#D3FB52]/30 text-[#D3FB52] text-xs font-semibold uppercase tracking-widest"
        >
          Today
        </button>
      )}
    </div>
  );
}
