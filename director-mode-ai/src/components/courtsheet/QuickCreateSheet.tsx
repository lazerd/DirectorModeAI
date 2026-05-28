'use client';

/**
 * QuickCreate — bottom sheet (mobile) / centered dialog (desktop) for
 * one-tap booking when a director clicks an empty cell.
 *
 * The form is intentionally minimal: type + title + duration + optional
 * "open for signups". The user can edit further in the Drawer once the
 * block exists.
 */

import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Calendar, Users, Clock } from 'lucide-react';
import type { Court, ReservationType, BookingIntent } from '@/lib/courtsheet/types';
import { allReservationTypes, typeLabel } from '@/lib/courtsheet/theme';
import { timeToMinutes, minutesToTime } from '@/lib/courtsheet/timezones';

interface Props {
  open: boolean;
  onClose: () => void;
  court: Court | null;
  date: string;
  timeLocal: string;
  clubId: string;
  onSubmit: (intent: BookingIntent) => Promise<void>;
}

export default function QuickCreateSheet({
  open,
  onClose,
  court,
  date,
  timeLocal,
  clubId,
  onSubmit,
}: Props) {
  const [type, setType] = useState<ReservationType>('lesson');
  const [title, setTitle] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [signupsOpen, setSignupsOpen] = useState(false);
  const [capacity, setCapacity] = useState<number | ''>('');
  const [pitch, setPitch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!court) return null;

  const endTime = minutesToTime(timeToMinutes(timeLocal) + durationMin);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    const intent: BookingIntent = {
      club_id: clubId,
      courts: [court.number ?? court.name ?? court.id],
      date_range: { start: date, end: date },
      time_range: { start: timeLocal, end: endTime },
      type,
      title: title.trim(),
      signups: signupsOpen
        ? {
            open: true,
            capacity: typeof capacity === 'number' ? capacity : undefined,
            pitch: pitch.trim() || undefined,
          }
        : undefined,
    };
    try {
      await onSubmit(intent);
      onClose();
      // Reset for next time.
      setTitle('');
      setSignupsOpen(false);
      setCapacity('');
      setPitch('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="bg-[#001820] border-t border-white/10 text-white">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-white">
            Quick book — Court {court.number}
          </DrawerTitle>
          <DrawerDescription className="text-white/50 text-sm flex items-center gap-2">
            <Calendar size={14} className="text-[#D3FB52]" />
            {date} · {timeLocal} – {endTime}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-4">
          {/* Type chips */}
          <div className="flex flex-wrap gap-1.5">
            {allReservationTypes()
              .filter((t) => t !== 'hold' && t !== 'blackout')
              .map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={[
                    'px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-widest border transition',
                    type === t
                      ? 'bg-[#D3FB52] text-[#001820] border-[#D3FB52]'
                      : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
                  ].join(' ')}
                >
                  {typeLabel(t)}
                </button>
              ))}
          </div>

          {/* Title */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1">
              Title
            </label>
            <input
              autoFocus
              type="text"
              placeholder="What is this?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#D3FB52]/60"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">
              <Clock size={10} className="inline mr-1 -mt-px" /> Duration
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[30, 60, 90, 120, 180, 240].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDurationMin(m)}
                  className={[
                    'px-3 py-1.5 rounded-full text-xs font-semibold tabular-nums border transition',
                    durationMin === m
                      ? 'bg-white/15 text-white border-white/30'
                      : 'bg-white/5 text-white/60 border-white/10',
                  ].join(' ')}
                >
                  {m < 60 ? `${m}m` : `${m / 60}h${m % 60 ? ` ${m % 60}m` : ''}`}
                </button>
              ))}
            </div>
          </div>

          {/* Signups */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={signupsOpen}
                onChange={(e) => setSignupsOpen(e.target.checked)}
                className="h-4 w-4 rounded accent-[#D3FB52]"
              />
              <div className="flex items-center gap-2">
                <Users size={14} className="text-[#D3FB52]" />
                <span className="text-sm font-medium">Open for signups</span>
              </div>
            </label>
            {signupsOpen && (
              <div className="space-y-2 pl-7">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-white/40 whitespace-nowrap">
                    Capacity
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    placeholder="Leave blank for unlimited"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    className="w-28 bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1 text-sm text-white tabular-nums"
                  />
                </div>
                <input
                  type="text"
                  placeholder='Pitch: "looking for 3 more for doubles"'
                  value={pitch}
                  onChange={(e) => setPitch(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-white/30"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!title.trim() || submitting}
              className="flex-1 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] hover:bg-[#c5f035] text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Booking…' : `Book ${court.number} @ ${timeLocal}`}
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
