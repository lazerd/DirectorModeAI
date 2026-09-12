'use client';

/**
 * Court rates, and the switch that turns online booking on.
 *
 * A club with no rate cards is not taking bookings — that is the whole gate, so
 * this screen says which state it is in at the top rather than leaving a
 * director to check the public page.
 *
 * Two presets, because the two shapes cover almost every club: "free to
 * members, $X to the public" and "peak / off-peak". Typing four rows by hand is
 * the thing a director pays somebody else to do.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Rate = {
  id: string;
  label: string;
  applies_to: 'member' | 'public';
  days_of_week: number[] | null;
  time_start: string;
  time_end: string;
  price_cents: number;
  advance_days: number;
  min_minutes: number | null;
  max_minutes: number | null;
  active: boolean;
  display_order: number;
  note: string | null;
};

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function RateEditor() {
  const [rates, setRates] = useState<Rate[]>([]);
  const [club, setClub] = useState<{ slug: string; name: string } | null>(null);
  const [bookings, setBookings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/club-site/rates');
    const j = (await res.json().catch(() => ({}))) as {
      rates?: Rate[];
      bookings?: number;
      club?: { slug: string; name: string };
      error?: string;
    };
    if (!res.ok) setError(j.error || 'Could not load your rates.');
    else {
      setRates(j.rates ?? []);
      setBookings(j.bookings ?? 0);
      setClub(j.club ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/club-site/rates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; rate?: Rate };
      if (!res.ok) {
        setError(j.error || 'Could not save.');
        await load();
        return;
      }
      if (j.rate) setRates((rs) => rs.map((r) => (r.id === id ? j.rate! : r)));
      setSaved(id);
      setTimeout(() => setSaved((s) => (s === id ? null : s)), 1600);
    } finally {
      setBusy(false);
    }
  }

  async function create(rate: Partial<Rate> & { label: string; applies_to: 'member' | 'public' }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/club-site/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rate),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(j.error || 'Could not add that rate.');
      else await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this rate? Existing bookings keep the price they were made at.'))
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/club-site/rates/${id}`, { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as { error?: string; booking_now_off?: boolean };
      if (!res.ok) setError(j.error || 'Could not delete it.');
      else {
        if (j.booking_now_off) {
          setError('That was your last rate, so online court booking is now off.');
        }
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  /** "Free to members, $24 to the public" — the commonest club in the world. */
  async function presetSimple() {
    const price = window.prompt('What do you charge the public, per hour? e.g. 24', '24');
    if (price === null) return;
    const cents = Math.round(parseFloat(price) * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    await create({
      label: 'Members',
      applies_to: 'member',
      price_cents: 0,
      advance_days: 7,
      display_order: 0,
    });
    await create({
      label: 'Public',
      applies_to: 'public',
      price_cents: cents,
      advance_days: 3,
      display_order: 1,
    });
  }

  /** Peak and off-peak, for both audiences. */
  async function presetPeak() {
    const off = window.prompt('Off-peak price per hour for the public? e.g. 20', '20');
    if (off === null) return;
    const peak = window.prompt('Peak price per hour for the public? e.g. 36', '36');
    if (peak === null) return;
    const offCents = Math.round(parseFloat(off) * 100);
    const peakCents = Math.round(parseFloat(peak) * 100);
    if (!Number.isFinite(offCents) || !Number.isFinite(peakCents)) return;

    await create({
      label: 'Members',
      applies_to: 'member',
      price_cents: 0,
      advance_days: 7,
      display_order: 0,
    });
    await create({
      label: 'Off-peak',
      applies_to: 'public',
      price_cents: offCents,
      time_start: '06:00',
      time_end: '16:00',
      advance_days: 3,
      display_order: 1,
    });
    await create({
      label: 'Peak',
      applies_to: 'public',
      price_cents: peakCents,
      time_start: '16:00',
      time_end: '22:00',
      advance_days: 3,
      display_order: 2,
    });
  }

  if (loading) return <p className="text-white/40">Loading your rates…</p>;

  const active = rates.filter((r) => r.active);
  const field =
    'rounded-lg border border-white/10 bg-[#001820] px-2.5 py-1.5 text-sm focus:border-[#D3FB52]/50 focus:outline-none';
  const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40';

  return (
    <div>
      {/* --------------------------------------------------------- the switch */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#002838] p-4">
        <div>
          <div className="font-semibold text-white">
            {active.length > 0 ? 'Online court booking is ON' : 'Online court booking is OFF'}
          </div>
          <div className="mt-0.5 text-sm text-white/50">
            {active.length > 0 ? (
              <>
                {bookings > 0
                  ? `${bookings} ${bookings === 1 ? 'booking' : 'bookings'} so far. `
                  : 'No bookings yet. '}
                {club && (
                  <a
                    href={`/c/${club.slug}/courts/book`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    See your booking page ↗
                  </a>
                )}
              </>
            ) : (
              'Add at least one rate and your website starts taking court bookings.'
            )}
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      {/* ----------------------------------------------------------- presets */}
      {rates.length === 0 && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-[#002838] p-6">
          <p className="font-medium text-white">Start from how your club already works</p>
          <p className="mt-1 text-sm text-white/50">
            Both of these make real rates you can then edit. Nothing goes live until you have at
            least one.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={presetSimple}
              disabled={busy}
              className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] disabled:opacity-50"
            >
              Free to members, $X to the public
            </button>
            <button
              type="button"
              onClick={presetPeak}
              disabled={busy}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white disabled:opacity-50"
            >
              Peak and off-peak
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- rates */}
      <div className="mt-6 space-y-3">
        {rates.map((r) => (
          <div
            key={r.id}
            className="rounded-2xl border border-white/[0.08] bg-[#002838] p-4"
            style={r.active ? undefined : { opacity: 0.55 }}
          >
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className={labelCls}>Name</label>
                <input
                  defaultValue={r.label}
                  onBlur={(e) => e.target.value !== r.label && patch(r.id, { label: e.target.value })}
                  style={{ color: '#ffffff' }}
                  className={`${field} w-32`}
                />
              </div>
              <div>
                <label className={labelCls}>Who</label>
                <select
                  defaultValue={r.applies_to}
                  onChange={(e) => patch(r.id, { applies_to: e.target.value })}
                  style={{ color: '#ffffff' }}
                  className={`${field} w-28`}
                >
                  <option value="member">Members</option>
                  <option value="public">Public</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Per hour</label>
                <div className="flex items-center gap-1">
                  <span className="text-white/40">$</span>
                  <input
                    inputMode="decimal"
                    defaultValue={String(r.price_cents / 100)}
                    onBlur={(e) => {
                      const cents = Math.round(parseFloat(e.target.value.trim()) * 100);
                      if (!Number.isFinite(cents) || cents < 0 || cents === r.price_cents) return;
                      patch(r.id, { price_cents: cents });
                    }}
                    style={{ color: '#ffffff' }}
                    className={`${field} w-20`}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>From</label>
                <input
                  type="time"
                  defaultValue={r.time_start.slice(0, 5)}
                  onBlur={(e) => patch(r.id, { time_start: e.target.value })}
                  style={{ color: '#ffffff' }}
                  className={`${field} w-28`}
                />
              </div>
              <div>
                <label className={labelCls}>Until</label>
                <input
                  type="time"
                  defaultValue={r.time_end.slice(0, 5)}
                  onBlur={(e) => patch(r.id, { time_end: e.target.value })}
                  style={{ color: '#ffffff' }}
                  className={`${field} w-28`}
                />
              </div>
              <div>
                <label className={labelCls}>Book ahead</label>
                <div className="flex items-center gap-1">
                  <input
                    inputMode="numeric"
                    defaultValue={String(r.advance_days)}
                    onBlur={(e) => {
                      const n = parseInt(e.target.value.trim(), 10);
                      if (!Number.isFinite(n) || n < 0 || n === r.advance_days) return;
                      patch(r.id, { advance_days: n });
                    }}
                    style={{ color: '#ffffff' }}
                    className={`${field} w-16`}
                  />
                  <span className="text-xs text-white/40">days</span>
                </div>
              </div>
              {saved === r.id && <span className="text-xs text-[#D3FB52]">Saved</span>}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4">
              <div>
                <label className={labelCls}>Days it applies</label>
                <div className="flex gap-1">
                  {DOW.map((name, dow) => {
                    // An empty array means every day, so all seven look on.
                    const all = !r.days_of_week || r.days_of_week.length === 0;
                    const on = all || r.days_of_week!.includes(dow);
                    return (
                      <button
                        key={dow}
                        type="button"
                        onClick={() => {
                          const current = all ? [0, 1, 2, 3, 4, 5, 6] : [...r.days_of_week!];
                          const next = on
                            ? current.filter((d) => d !== dow)
                            : [...current, dow].sort((a, b) => a - b);
                          // Back to all seven reads as "every day", which is
                          // what an empty array means in the price maths.
                          patch(r.id, { days_of_week: next.length === 7 ? [] : next });
                        }}
                        disabled={busy}
                        aria-pressed={on}
                        className={`h-7 w-8 rounded-lg border text-[11px] font-medium disabled:opacity-50 ${
                          on
                            ? 'border-[#D3FB52]/50 bg-[#D3FB52]/15 text-white'
                            : 'border-white/10 text-white/30'
                        }`}
                      >
                        {name.charAt(0)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => patch(r.id, { active: !r.active })}
                disabled={busy}
                className="mt-4 text-xs font-medium text-white/50 hover:text-white disabled:opacity-50"
              >
                {r.active ? 'Turn off' : 'Turn on'}
              </button>
              <button
                type="button"
                onClick={() => remove(r.id)}
                disabled={busy}
                className="mt-4 text-xs text-white/35 hover:text-red-300 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {rates.length > 0 && (
        <button
          type="button"
          onClick={() => create({ label: 'New rate', applies_to: 'public', price_cents: 0 })}
          disabled={busy}
          className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white disabled:opacity-50"
        >
          Add a rate
        </button>
      )}

      <div className="mt-8 rounded-2xl border border-white/[0.08] bg-[#002838] p-4 text-sm text-white/50">
        <p>
          <strong className="text-white/80">A booking that crosses two rates</strong> is charged per
          part — 3:30 to 5:30 with a 4pm peak is half an hour off-peak and ninety minutes peak, not
          two hours of either.
        </p>
        <p className="mt-2">
          <strong className="text-white/80">Member rates need a login.</strong> Somebody signed in
          as a member of your club gets member pricing and the longer booking window; everyone else
          gets public. It is not a checkbox on the form, because at a club where members play free
          that would be a free-courts checkbox.
        </p>
        <p className="mt-2">
          <strong className="text-white/80">Money is collected at the desk for now.</strong> The
          booking records what is owed and emails the player; taking the card online needs your own
          Square or Stripe connected, which is the next thing we build.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <Link href="/run/site" className="text-white/50 hover:text-white">
          ← Club site
        </Link>
        <Link href="/run/site/bookings" className="text-white/50 hover:text-white">
          See your bookings →
        </Link>
      </div>
    </div>
  );
}
