'use client';

/**
 * Public member view — what non-staff visitors see at /courtsheet/[slug].
 *
 * Shows only signups-open reservations as cards (a more inviting layout
 * than the staff grid for a public-facing surface). Members tap to join.
 * If they're not signed in, they enter name + email (creates a guest
 * signup; we can prompt them to claim their account later).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Users, Calendar, Check, ChevronRight, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import type { Court, Club } from '@/lib/courtsheet/types';
import { utcToLocalTime } from '@/lib/courtsheet/timezones';
import { blockStyleFor, typeLabel } from '@/lib/courtsheet/theme';
import DateNav from '@/components/courtsheet/DateNav';

interface PublicReservation {
  id: string;
  court_id: string;
  starts_at: string;
  ends_at: string;
  type: string;
  source: string;
  title: string;
  color: string | null;
  signups_open: boolean;
  signups_capacity: number | null;
  signups_pitch: string | null;
  signups_count: number;
  meta: Record<string, unknown>;
}

interface Props {
  club: Club;
  initialCourts: Court[];
}

export default function PublicClient({ club, initialCourts }: Props) {
  const todayISO = useMemo(() => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: club.timezone }).format(new Date());
  }, [club.timezone]);

  const [date, setDate] = useState(todayISO);
  const [reservations, setReservations] = useState<PublicReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [signupTarget, setSignupTarget] = useState<PublicReservation | null>(null);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/courtsheet/public/${club.slug}?date=${encodeURIComponent(date)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      setReservations((data.reservations as PublicReservation[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [club.slug, date]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  const openSignups = reservations.filter((r) => r.signups_open);
  const courtsById = useMemo(() => {
    const m: Record<string, Court> = {};
    for (const c of initialCourts) m[c.id] = c;
    return m;
  }, [initialCourts]);

  return (
    <div className="min-h-screen bg-[#001820] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#D3FB52]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 relative">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#D3FB52] mb-2">
            <LayoutGrid size={12} />
            CourtSheet
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">{club.name}</h1>
          <p className="text-white/50 text-sm flex items-center gap-2">
            <MapPin size={12} /> Public sheet — join open court time
          </p>

          <div className="mt-6">
            <DateNav date={date} onChange={setDate} todayISO={todayISO} />
          </div>
        </div>
      </div>

      {/* Open signups feed */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-white/60 mb-3">
          {openSignups.length === 0 ? 'No open signups today' : `${openSignups.length} open`}
        </h2>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="cs-shimmer h-20 rounded-2xl" />
            ))}
          </div>
        ) : openSignups.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <p className="text-white/50 text-sm">
              Nothing posted for this date. Check back, or pick another day.
            </p>
          </div>
        ) : (
          openSignups.map((r) => (
            <PublicSignupCard
              key={r.id}
              reservation={r}
              court={courtsById[r.court_id]}
              timezone={club.timezone}
              onJoin={() => setSignupTarget(r)}
            />
          ))
        )}
      </div>

      <PublicSignupSheet
        target={signupTarget}
        onClose={() => setSignupTarget(null)}
        onJoined={() => {
          setSignupTarget(null);
          fetchFeed();
        }}
      />
    </div>
  );
}

function PublicSignupCard({
  reservation: r,
  court,
  timezone,
  onJoin,
}: {
  reservation: PublicReservation;
  court: Court | undefined;
  timezone: string;
  onJoin: () => void;
}) {
  const style = blockStyleFor(r.type as any, r.color);
  const start = utcToLocalTime(r.starts_at, timezone);
  const end = utcToLocalTime(r.ends_at, timezone);
  const remaining = r.signups_capacity ? r.signups_capacity - r.signups_count : null;
  const isFull = remaining !== null && remaining <= 0;

  return (
    <button
      type="button"
      onClick={isFull ? undefined : onJoin}
      disabled={isFull}
      className={[
        'w-full text-left rounded-2xl border bg-white/[0.03] p-4 sm:p-5 transition',
        'flex items-center gap-3 sm:gap-4',
        isFull ? 'opacity-60 cursor-default' : 'hover:bg-white/[0.05] hover:border-white/15 hover:-translate-y-px',
        'border-white/10',
      ].join(' ')}
    >
      {/* Time block */}
      <div
        className="shrink-0 rounded-xl px-3 py-2 text-center min-w-[80px]"
        style={{ background: `${style.hex}1A`, borderLeft: `3px solid ${style.hex}` }}
      >
        <div className="text-[10px] uppercase tracking-widest text-white/40 mb-0.5">
          {typeLabel(r.type as any)}
        </div>
        <div className="text-sm font-bold tabular-nums" style={{ color: style.hex }}>
          {start}
        </div>
        <div className="text-[10px] text-white/40 tabular-nums">{end}</div>
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{r.title}</div>
        {r.signups_pitch && (
          <div className="text-xs text-white/50 italic truncate mt-0.5">"{r.signups_pitch}"</div>
        )}
        <div className="text-[11px] uppercase tracking-widest text-white/40 mt-1.5 flex items-center gap-2">
          <span>Court {court?.number ?? '?'}</span>
          <span className="text-white/20">·</span>
          <Users size={11} />
          <span className="tabular-nums">
            {r.signups_count}
            {r.signups_capacity ? ` / ${r.signups_capacity}` : ''}
          </span>
        </div>
      </div>

      {/* CTA */}
      <div className="shrink-0">
        {isFull ? (
          <div className="rounded-full px-3 py-1.5 text-[10px] uppercase tracking-widest font-semibold bg-white/10 text-white/40">
            Full
          </div>
        ) : (
          <div className="rounded-full px-3 py-1.5 text-[11px] uppercase tracking-widest font-semibold bg-[#D3FB52] text-[#001820] flex items-center gap-1">
            Join <ChevronRight size={11} />
          </div>
        )}
      </div>
    </button>
  );
}

function PublicSignupSheet({
  target,
  onClose,
  onJoined,
}: {
  target: PublicReservation | null;
  onClose: () => void;
  onJoined: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!target) return null;

  const submit = async () => {
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/courtsheet/reservations/${target.id}/signups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: { guest_name: name.trim(), guest_email: email.trim() },
          note: note.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Could not sign up');
        return;
      }
      if (data.status === 'waitlist') {
        toast.success(`You're on the waitlist (#${data.position ?? '?'})`);
      } else {
        toast.success("You're in!");
      }
      onJoined();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[#001820] border border-white/10 p-5 sm:p-6 space-y-4 shadow-2xl">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#D3FB52]">
          <Users size={11} />
          Sign up
        </div>
        <div>
          <h3 className="text-lg font-semibold">{target.title}</h3>
          {target.signups_pitch && (
            <p className="text-sm text-white/50 italic mt-1">"{target.signups_pitch}"</p>
          )}
        </div>
        <div className="space-y-2.5">
          <input
            autoFocus
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#D3FB52]/60"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#D3FB52]/60"
          />
          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#D3FB52]/60"
          />
        </div>
        <div className="flex gap-2">
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
            disabled={!name.trim() || !email.trim() || submitting}
            className="flex-1 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Check size={14} />
            {submitting ? 'Signing up…' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}
