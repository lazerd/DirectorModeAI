'use client';

/**
 * Court bookings, for the front desk.
 *
 * Sorted by when they play, not when they booked — the question at the desk is
 * always "who is coming next", and the total owed sits at the top because that
 * is the other question.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Booking = {
  id: string;
  booker_name: string;
  booker_email: string;
  booker_phone: string | null;
  rate_applied: 'member' | 'public';
  minutes: number;
  amount_cents: number;
  payment_status: 'pending' | 'paid' | 'waived' | 'refunded';
  status: 'booked' | 'cancelled';
  notes: string | null;
  courts: { name: string | null; number: number | null } | null;
  reservations: { starts_at: string; ends_at: string } | null;
};

const money = (cents: number) =>
  cents <= 0 ? '—' : cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

export default function BookingList() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [timeZone, setTimeZone] = useState('America/Los_Angeles');
  const [unpaid, setUnpaid] = useState({ count: 0, cents: 0 });
  const [past, setPast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showPast: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/club-site/bookings${showPast ? '?past=1' : ''}`);
      const j = (await res.json().catch(() => ({}))) as {
        bookings?: Booking[];
        unpaid_count?: number;
        unpaid_cents?: number;
        timezone?: string;
        error?: string;
      };
      if (!res.ok) setError(j.error || 'Could not load bookings.');
      else {
        setBookings(j.bookings ?? []);
        setUnpaid({ count: j.unpaid_count ?? 0, cents: j.unpaid_cents ?? 0 });
        if (j.timezone) setTimeZone(j.timezone);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(past);
  }, [load, past]);

  async function update(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/club-site/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: id, ...body }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(j.error || 'Could not update.');
      else await load(past);
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string | undefined) =>
    iso
      ? new Intl.DateTimeFormat('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone,
        }).format(new Date(iso))
      : '—';

  const courtName = (b: Booking) =>
    b.courts?.name || (b.courts?.number != null ? `Court ${b.courts.number}` : 'Court');

  return (
    <div>
      {unpaid.count > 0 && !past && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] p-4">
          <div className="font-semibold text-amber-200">
            {money(unpaid.cents)} to collect
          </div>
          <div className="mt-0.5 text-sm text-amber-100/70">
            {unpaid.count} upcoming {unpaid.count === 1 ? 'booking has' : 'bookings have'} not been
            paid for. Mark them as you take the money.
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {[
          [false, 'Upcoming'],
          [true, 'Past'],
        ].map(([value, label]) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => setPast(value as boolean)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              past === value
                ? 'bg-[#D3FB52] text-[#001820]'
                : 'border border-white/15 text-white/60 hover:text-white'
            }`}
          >
            {label as string}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      {loading ? (
        <p className="mt-6 text-white/40">Loading…</p>
      ) : bookings.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-[#002838] p-8 text-center">
          <p className="text-white">{past ? 'No past bookings.' : 'Nothing booked yet.'}</p>
          {!past && (
            <p className="mt-2 text-sm text-white/50">
              Bookings from your website land here.{' '}
              <Link href="/run/site/courts" className="text-[#D3FB52] hover:underline">
                Check your rates
              </Link>{' '}
              if the booking page is not showing anything.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {bookings.map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#002838] p-4"
              style={b.status === 'cancelled' ? { opacity: 0.5 } : undefined}
            >
              <div className="min-w-0">
                <div className="font-medium text-white">
                  {when(b.reservations?.starts_at)} · {courtName(b)} · {b.minutes} min
                  {b.status === 'cancelled' && (
                    <span className="ml-2 text-xs font-normal text-white/40">cancelled</span>
                  )}
                </div>
                <div className="truncate text-sm text-white/45">
                  {b.booker_name} · {b.booker_email}
                  {b.booker_phone ? ` · ${b.booker_phone}` : ''} ·{' '}
                  {b.rate_applied === 'member' ? 'member rate' : 'public rate'}
                </div>
                {b.notes && <div className="mt-0.5 text-xs italic text-white/35">“{b.notes}”</div>}
              </div>

              <div className="flex shrink-0 items-center gap-3 text-xs">
                <span
                  className={
                    b.payment_status === 'paid'
                      ? 'text-[#D3FB52]'
                      : b.payment_status === 'pending' && b.amount_cents > 0
                        ? 'text-amber-300'
                        : 'text-white/35'
                  }
                >
                  {b.amount_cents > 0
                    ? b.payment_status === 'pending'
                      ? `${money(b.amount_cents)} due`
                      : `${money(b.amount_cents)} ${b.payment_status}`
                    : b.rate_applied === 'member'
                      ? 'member time'
                      : 'free'}
                </span>
                {b.status === 'booked' && b.payment_status === 'pending' && b.amount_cents > 0 && (
                  <button
                    type="button"
                    onClick={() => update(b.id, { payment_status: 'paid' })}
                    disabled={busy}
                    className="rounded-lg border border-white/15 px-2.5 py-1 font-medium text-white/70 hover:text-white disabled:opacity-50"
                  >
                    Mark paid
                  </button>
                )}
                {b.status === 'booked' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Cancel ${b.booker_name}'s court? It goes back into the pool immediately.`,
                        )
                      )
                        return;
                      update(b.id, { cancel: true });
                    }}
                    disabled={busy}
                    className="text-white/35 hover:text-red-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        <Link href="/run/site/courts" className="text-white/50 hover:text-white">
          ← Court rates
        </Link>
        <Link href="/courtsheet/staff" className="text-white/50 hover:text-white">
          See the court grid →
        </Link>
      </div>
    </div>
  );
}
