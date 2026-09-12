'use client';

/**
 * The thing the whole product is.
 *
 * Every date the class meets, as a button. Click one and it becomes a skip
 * date; click it again and it comes back. One click, saved, and the public
 * page, the confirmation emails and the session count all follow.
 *
 * Deliberately NOT a date-picker and NOT a comma-separated text field. A
 * director looking at their season wants to see the Tuesdays and click the one
 * that is Thanksgiving — not read a date format spec, and certainly not ask a
 * developer to do it for them.
 */

import { useMemo } from 'react';
import { formatSessionDate, programSessions } from '@/lib/programs/sessions';

type Props = {
  program: {
    range_start: string;
    range_end: string;
    days_of_week: number[] | null;
    exclusions: string[] | null;
  };
  timeZone: string;
  /** Called with the complete new exclusions array. */
  onToggle: (exclusions: string[]) => void;
  busy?: boolean;
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function SessionGrid({ program, timeZone, onToggle, busy }: Props) {
  const sessions = useMemo(() => programSessions(program, timeZone), [program, timeZone]);

  /** Every date the class COULD meet, skipped ones included, grouped by month. */
  const months = useMemo(() => {
    const all = [
      ...sessions.dates.map((d) => ({ date: d, skipped: false })),
      ...sessions.skipped.map((d) => ({ date: d, skipped: true })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    const grouped = new Map<string, { date: string; skipped: boolean }[]>();
    for (const entry of all) {
      const key = entry.date.slice(0, 7);
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return [...grouped.entries()];
  }, [sessions]);

  const excluded = new Set((program.exclusions ?? []).map((d) => d.slice(0, 10)));

  const toggle = (date: string) => {
    const next = new Set(excluded);
    if (next.has(date)) next.delete(date);
    else next.add(date);
    onToggle([...next].sort());
  };

  if (months.length === 0) {
    return (
      <p className="text-sm text-white/40">
        No dates yet — set the start, end and days of the week.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-white">
          {sessions.count} {sessions.count === 1 ? 'session' : 'sessions'}
        </span>
        {sessions.skipped.length > 0 && (
          <span className="text-sm text-amber-300">
            {sessions.skipped.length} skipped
          </span>
        )}
        <span className="text-xs text-white/35">Click a date to skip it</span>
      </div>

      <div className="mt-3 space-y-3">
        {months.map(([key, dates]) => {
          const [year, month] = key.split('-').map((s) => parseInt(s, 10));
          return (
            <div key={key}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">
                {MONTHS[month - 1]} {year}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dates.map(({ date, skipped }) => (
                  <button
                    key={date}
                    type="button"
                    onClick={() => toggle(date)}
                    disabled={busy}
                    aria-pressed={skipped}
                    title={skipped ? 'Skipped — click to put it back' : 'Click to skip this date'}
                    className={`rounded-lg border px-2.5 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                      skipped
                        ? 'border-white/10 text-white/35 line-through hover:border-white/30 hover:text-white/60'
                        : 'border-[#D3FB52]/40 bg-[#D3FB52]/10 font-semibold text-white hover:border-[#D3FB52]'
                    }`}
                  >
                    {formatSessionDate(date, timeZone, { weekday: true })}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
