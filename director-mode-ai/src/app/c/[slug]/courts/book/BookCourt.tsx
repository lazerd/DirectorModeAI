'use client';

/**
 * Booking a court.
 *
 * Pick a day, pick how long, pick a time, give a name and an email. No account,
 * because the person booking a court on a Thursday evening will not make one,
 * and the club loses the booking to a voicemail instead.
 *
 * The price on every button comes from the server. The client never computes
 * money — it only shows what it was told, and the server prices the booking
 * again when it is made.
 */

import { useCallback, useEffect, useState } from 'react';

type Slot = { time: string; cents: number; courtsFree: number };

type Availability = {
  enabled: boolean;
  reason?: string;
  audience?: 'member' | 'public';
  /** Their real standing, which decides whether the price toggle appears. */
  ownAudience?: 'member' | 'public';
  /** Whether there is a session — NOT whether they are a member. */
  signedIn?: boolean;
  otherAudience?: { audience: 'member' | 'public'; cents: number } | null;
  date?: string;
  minutes?: number;
  durations?: number[];
  dates?: string[];
  advanceDays?: number;
  slots?: Slot[];
  note?: string | null;
  club?: { name: string; phone: string | null; timezone: string };
};

type Booked = {
  court: string;
  date: string;
  time: string;
  end_time: string;
  amount_cents: number;
  rate_applied: 'member' | 'public';
  cancel_token: string;
  emailed: boolean;
  warning?: string;
  /** Resolved server-side, so this screen and the email agree. */
  payment?:
    | { kind: 'link'; url: string; label: string; note: string | null }
    | { kind: 'free' | 'in_person' };
};

const money = (cents: number) =>
  cents <= 0 ? 'Free' : cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

const pretty = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
};

/**
 * Morning / afternoon / evening, with the price said once per group.
 *
 * `mixed` is true when a group's slots are not all the same price — which is
 * exactly when a per-button price earns its space, and only then.
 */
function groupSlots(slots: Slot[]) {
  const buckets: { label: string; from: number; to: number; slots: Slot[] }[] = [
    { label: 'Morning', from: 0, to: 12, slots: [] },
    { label: 'Afternoon', from: 12, to: 17, slots: [] },
    { label: 'Evening', from: 17, to: 24, slots: [] },
  ];
  for (const s of slots) {
    const hour = parseInt(s.time.slice(0, 2), 10);
    (buckets.find((b) => hour >= b.from && hour < b.to) ?? buckets[2]).slots.push(s);
  }
  return buckets
    .filter((b) => b.slots.length > 0)
    .map((b) => {
      const prices = [...new Set(b.slots.map((s) => s.cents))];
      const mixed = prices.length > 1;
      return {
        label: b.label,
        slots: b.slots,
        mixed,
        priceLabel: mixed
          ? `${money(Math.min(...prices))}–${money(Math.max(...prices))} / hr`
          : prices[0] <= 0
            ? 'Free'
            : `${money(prices[0])} / hr`,
      };
    });
}

const dayLabel = (ymd: string, timeZone: string, today: string) => {
  if (ymd === today) return 'Today';
  const d = new Date(`${ymd}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(d);
};

export default function BookCourt({
  clubSlug,
  theme,
}: {
  clubSlug: string;
  theme: {
    primary: string;
    onPrimary: string;
    secondary: string;
    ink: string;
    surface: string;
    border: string;
    muted: string;
  };
}) {
  const [data, setData] = useState<Availability | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  /** A member viewing public prices — a director checking their own shop. */
  const [asPublic, setAsPublic] = useState(false);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);

  const load = useCallback(
    async (d: string | null, m: number | null, viewAsPublic = asPublic) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (d) qs.set('date', d);
        if (m) qs.set('minutes', String(m));
        if (viewAsPublic) qs.set('as', 'public');
        const res = await fetch(
          `/api/clubs/${encodeURIComponent(clubSlug)}/courts/availability?${qs}`,
          { cache: 'no-store' },
        );
        const j = (await res.json()) as Availability;
        setData(j);
        if (j.date) setDate(j.date);
        if (j.minutes) setMinutes(j.minutes);
      } catch {
        setError('Could not load court times.');
      } finally {
        setLoading(false);
      }
    },
    [clubSlug, asPublic],
  );

  useEffect(() => {
    load(null, null);
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked || !date || !minutes) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clubs/${encodeURIComponent(clubSlug)}/courts/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time: picked.time, minutes, ...form }),
      });
      const j = (await res.json().catch(() => ({}))) as Booked & { error?: string };
      if (!res.ok) {
        setError(j.error || 'Could not book that court.');
        // A slot lost to somebody else has to disappear from the page, or the
        // next tap fails the same way.
        setPicked(null);
        await load(date, minutes);
        setBusy(false);
        return;
      }
      setBooked(j);
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${theme.border}`,
    background: theme.surface,
    color: theme.ink,
    fontSize: 15,
  };
  const label: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 4,
    display: 'block',
  };

  // ------------------------------------------------------------- booked
  if (booked) {
    return (
      <div
        className="rounded-2xl border p-6"
        style={{ borderColor: theme.border, background: theme.surface }}
      >
        <div className="text-4xl">🎾</div>
        <h2 className="mt-3 text-2xl font-bold">Court booked</h2>
        <p className="mt-2" style={{ color: theme.muted }}>
          {booked.court} ·{' '}
          {dayLabel(booked.date, data?.club?.timezone || 'America/Los_Angeles', data?.dates?.[0] || '')}{' '}
          · {pretty(booked.time)}–{pretty(booked.end_time)}
        </p>
        <p className="mt-1 font-semibold" style={{ color: theme.primary }}>
          {booked.amount_cents > 0
            ? money(booked.amount_cents)
            : booked.rate_applied === 'member'
              ? 'Free — member court time'
              : 'Free'}
        </p>

        {/* The club's own checkout, where it has one. Wording comes from the
            server so this button and the confirmation email never disagree. */}
        {booked.payment?.kind === 'link' && (
          <>
            <p className="mt-2 text-sm" style={{ color: theme.muted }}>
              {booked.payment.note || 'Your court is held — pay now to lock it in.'}
            </p>
            <a
              href={booked.payment.url}
              className="mt-3 inline-block rounded-xl px-5 py-3 text-sm font-bold"
              style={{ background: theme.primary, color: theme.onPrimary }}
            >
              {booked.payment.label} →
            </a>
          </>
        )}
        {booked.payment?.kind === 'in_person' && booked.amount_cents > 0 && (
          <p className="mt-2 text-sm" style={{ color: theme.muted }}>
            Settle up at the desk when you arrive.
          </p>
        )}
        {booked.emailed ? (
          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            A confirmation is on its way, with a link to cancel if your plans change.
          </p>
        ) : (
          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            {booked.warning ||
              'Save this page — it has your cancellation link.'}{' '}
            <a
              href={`/c/${clubSlug}/courts/cancel/${booked.cancel_token}`}
              style={{ color: theme.primary, fontWeight: 600 }}
            >
              Cancel this booking
            </a>
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setBooked(null);
            setPicked(null);
            setForm({ name: '', email: '', phone: '', notes: '' });
            load(date, minutes);
          }}
          className="mt-5 rounded-xl px-5 py-2.5 text-sm font-bold"
          style={{ background: theme.primary, color: theme.onPrimary }}
        >
          Book another
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------- not enabled
  if (!loading && data && !data.enabled) {
    return (
      <div
        className="rounded-2xl border p-6"
        style={{ borderColor: theme.border, background: theme.surface }}
      >
        <p className="font-medium">{data.reason || 'Online booking is not available.'}</p>
        {data.club?.phone && (
          <a
            href={`tel:${data.club.phone.replace(/[^0-9+]/g, '')}`}
            className="mt-4 inline-block rounded-xl px-5 py-3 text-sm font-bold"
            style={{ background: theme.primary, color: theme.onPrimary }}
          >
            Call {data.club.phone}
          </a>
        )}
      </div>
    );
  }

  const today = data?.dates?.[0] || '';

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------- audience */}
      {data?.audience && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: theme.border, background: theme.surface }}
        >
          <div>
            {data.audience === 'member' ? (
              <>
                <strong>Member rates</strong> · book {data.advanceDays} days ahead
              </>
            ) : (
              <>
                <strong>Public rates</strong> · book {data.advanceDays} days ahead
                {data.otherAudience?.audience === 'member' && data.otherAudience.cents === 0 && (
                  // A membership pitch on the club's own booking page, from
                  // real rate data rather than marketing copy.
                  <span style={{ color: theme.muted }}> — members play free</span>
                )}
                {/*
                  The correction that matters most on this page.

                  Members play free, and a member who arrives signed out is
                  shown the public rate by a page that has just told them
                  members play free. Without this line their options are to
                  overpay or to phone the club — which is the thing online
                  booking was supposed to replace.

                  Offered ONLY when signed out. A signed-in non-member has
                  already proved they are not on the club's books, and telling
                  them to sign in is the page asking them to redo what they
                  just did.
                */}
                {data.signedIn === false && (
                  <div className="mt-1.5">
                    <a
                      href={`/login?next=${encodeURIComponent(`/c/${clubSlug}/courts/book`)}`}
                      className="text-sm font-semibold underline"
                      style={{ color: theme.primary }}
                    >
                      Already a member? Sign in for member rates
                    </a>
                  </div>
                )}
              </>
            )}
          </div>

          {/*
            A member can price the page as the public sees it.
            
            Without this a director checking their own booking page sees Free
            on every slot, because that is their own member rate, and cannot
            see the thing they are selling. Display only — the server decides
            what is actually charged from the session.
          */}
          {data.ownAudience === 'member' && (
            <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: theme.border }}>
              {(
                [
                  [false, 'Members'],
                  [true, 'Public'],
                ] as const
              ).map(([wantPublic, text]) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => {
                    setAsPublic(wantPublic);
                    setPicked(null);
                    load(date, minutes, wantPublic);
                  }}
                  className="rounded-md px-2.5 py-1 text-xs font-semibold transition-colors"
                  style={
                    asPublic === wantPublic
                      ? { background: theme.surface, color: theme.ink }
                      : { color: theme.muted }
                  }
                >
                  {text}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- day */}
      <div>
        <label style={label}>Day</label>
        {/*
          One scrolling row, not a wrapping grid. Eight day chips wrapped onto
          three rows on a phone and pushed the times — the thing people came
          for — below the fold.
        */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {(data?.dates ?? []).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setPicked(null);
                load(d, minutes);
              }}
              className="shrink-0 rounded-xl border px-3 py-2 text-sm font-medium"
              style={
                d === date
                  ? { borderColor: theme.primary, background: theme.primary, color: theme.onPrimary }
                  : { borderColor: theme.border, background: theme.surface }
              }
            >
              {dayLabel(d, data?.club?.timezone || 'America/Los_Angeles', today)}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------- duration */}
      {(data?.durations?.length ?? 0) > 1 && (
        <div>
          <label style={label}>How long</label>
          <div className="flex gap-2">
            {(data?.durations ?? []).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setPicked(null);
                  load(date, m);
                }}
                className="rounded-xl border px-3 py-2 text-sm font-medium"
                style={
                  m === minutes
                    ? { borderColor: theme.primary, background: theme.primary, color: theme.onPrimary }
                    : { borderColor: theme.border, background: theme.surface }
                }
              >
                {m % 60 === 0 ? `${m / 60} hr` : `${m} min`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- slots */}
      <div>
        {loading ? (
          <p className="text-sm" style={{ color: theme.muted }}>
            Checking the courts…
          </p>
        ) : (data?.slots?.length ?? 0) === 0 ? (
          <p className="text-sm" style={{ color: theme.muted }}>
            {data?.note || 'Nothing available.'}
          </p>
        ) : (
          <>
            {/*
              Grouped by part of the day, and the price stated ONCE per group
              rather than on every button.
              
              The first version printed the same two facts — the price and the
              court count — on all twenty-nine buttons, so the page was a wall
              of "Free · 9 courts" and the only thing that varied, the time,
              was the hardest thing to read. Repeating identical information is
              what made it feel like a form rather than a shop.
            */}
            {groupSlots(data?.slots ?? []).map((group) => (
              <div key={group.label} className="mb-5">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span style={label}>{group.label}</span>
                  <span className="text-sm font-semibold" style={{ color: theme.primary }}>
                    {group.priceLabel}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {group.slots.map((s) => {
                    const on = picked?.time === s.time;
                    // Only worth saying when it is actually scarce. "9 courts"
                    // on every button is noise; "2 left" is information.
                    const scarce = s.courtsFree <= 2;
                    return (
                      <button
                        key={s.time}
                        type="button"
                        onClick={() => setPicked(s)}
                        className="rounded-xl border px-2 py-2.5 text-center transition-colors"
                        style={
                          on
                            ? { borderColor: theme.primary, background: theme.primary, color: theme.onPrimary }
                            : { borderColor: theme.border, background: theme.surface }
                        }
                      >
                        <div className="text-sm font-bold leading-tight">{pretty(s.time)}</div>
                        {/* Per-button price only where the group is mixed. */}
                        {group.mixed && (
                          <div className="text-[11px]" style={{ opacity: on ? 0.85 : 0.6 }}>
                            {money(s.cents)}
                          </div>
                        )}
                        {scarce && (
                          <div
                            className="text-[11px] font-semibold"
                            style={{ color: on ? theme.onPrimary : '#b45309', opacity: on ? 0.9 : 1 }}
                          >
                            {s.courtsFree} left
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/*
              Through to the club's REAL court sheet.

              This list answers "is something free at 6pm"; the sheet answers
              "what is actually on court", which is a different question and
              one the club already runs a grid for. Building a second grid here
              would be a parallel reservation system — these bookings write
              into the same `reservations` table the sheet draws, so the sheet
              is simply the fuller view of the same thing.
            */}
            <a
              href={`/courtsheet/${clubSlug}`}
              className="inline-block text-sm font-semibold underline"
              style={{ color: theme.primary }}
            >
              See the club&apos;s full court sheet →
            </a>
          </>
        )}
      </div>

      {/* ------------------------------------------------------- the form */}
      {picked && (
        <form
          onSubmit={submit}
          className="rounded-2xl border p-5"
          style={{ borderColor: theme.border, background: theme.surface }}
        >
          <div className="text-sm font-semibold">
            {dayLabel(date || '', data?.club?.timezone || 'America/Los_Angeles', today)} ·{' '}
            {pretty(picked.time)} · {minutes} min ·{' '}
            <span style={{ color: theme.primary }}>{money(picked.cents)}</span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label style={label} htmlFor="bk-name">
                Your name *
              </label>
              <input
                id="bk-name"
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                style={field}
              />
            </div>
            <div>
              <label style={label} htmlFor="bk-email">
                Email *
              </label>
              <input
                id="bk-email"
                type="email"
                required
                maxLength={200}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                style={field}
              />
            </div>
            <div>
              <label style={label} htmlFor="bk-phone">
                Phone
              </label>
              <input
                id="bk-phone"
                type="tel"
                maxLength={40}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                style={field}
              />
            </div>
          </div>

          {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-xl px-6 py-3.5 text-base font-bold disabled:opacity-50"
            style={{ background: theme.primary, color: theme.onPrimary }}
          >
            {busy
              ? 'Booking…'
              : picked.cents > 0
                ? `Book it · ${money(picked.cents)}`
                : 'Book it'}
          </button>
          <p className="mt-2 text-xs" style={{ color: theme.muted }}>
            {/* How to pay depends on whether the club has a checkout, which the
                server decides — so before booking this only promises the email. */}
            We email you a confirmation with a link to cancel.
          </p>
        </form>
      )}

      {!picked && error && <p className="text-sm font-medium text-red-600">{error}</p>}
    </div>
  );
}
