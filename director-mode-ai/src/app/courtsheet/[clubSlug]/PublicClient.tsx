'use client';

/**
 * Public court sheet — what anyone sees at /courtsheet/[slug].
 *
 * Top: the sheet itself. Every court, every half hour, booked or open, and on
 * an open cell the per-hour price for THIS visitor (public rate signed out,
 * member rate signed in). Tapping an open cell goes to booking at that time.
 *
 * Below: sessions the club has opened for signups (drop-ins, clinics), which
 * people join rather than book.
 *
 * It used to be only that second list, so a club with nine courts and nothing
 * posted showed a visitor "Nothing open" — the opposite of the truth.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Users, Check, ChevronRight, MapPin, Handshake } from 'lucide-react';
import { toast } from 'sonner';
import type { Court, Club } from '@/lib/courtsheet/types';
import { utcToLocalTime } from '@/lib/courtsheet/timezones';
import { blockStyleFor, typeLabel } from '@/lib/courtsheet/theme';
import type { SheetGrid, SheetCell } from '@/lib/courts/sheet';
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

type SheetResponse = SheetGrid & {
  date: string;
  audience: 'member' | 'public';
  signedIn: boolean;
  bookable: boolean;
  bookingEnabled: boolean;
  bookingNote: string | null;
  memberFree: boolean;
};

interface Props {
  club: Club;
  initialCourts: Court[];
  /** The club has a /c site, so there is a booking page to send an open cell to. */
  hasSite: boolean;
}

const money = (cents: number) =>
  cents === 0 ? 'Free' : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** '17:30' → '5:30'; the row label, where am/pm is carried by the hour headers. */
function clock(hhmm: string): { label: string; onHour: boolean } {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { label: m === 0 ? `${h12}${h < 12 ? 'am' : 'pm'}` : `${h12}:${String(m).padStart(2, '0')}`, onHour: m === 0 };
}

export default function PublicClient({ club, initialCourts, hasSite }: Props) {
  const todayISO = useMemo(() => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: club.timezone }).format(new Date());
  }, [club.timezone]);

  const [date, setDate] = useState(todayISO);
  const [reservations, setReservations] = useState<PublicReservation[]>([]);
  const [sheet, setSheet] = useState<SheetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signupTarget, setSignupTarget] = useState<PublicReservation | null>(null);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    try {
      const q = `date=${encodeURIComponent(date)}`;
      const [feed, grid] = await Promise.all([
        fetch(`/api/courtsheet/public/${club.slug}?${q}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/clubs/${club.slug}/courts/sheet?${q}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      ]);
      setReservations((feed.reservations as PublicReservation[]) ?? []);
      setSheet(grid as SheetResponse | null);
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

  const openNow = sheet
    ? sheet.rows.reduce((n, r) => n + r.cells.filter((c) => c.state === 'open').length, 0)
    : 0;
  const here = `/courtsheet/${club.slug}`;

  return (
    <div className="min-h-screen bg-[var(--cm-ground,#001820)] text-white" style={{ fontFamily: "var(--cm-font, 'Inter', system-ui, sans-serif)" }}>
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[var(--cm-accent,#D3FB52)]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 relative">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--cm-accent,#D3FB52)] mb-2">
            <LayoutGrid size={12} />
            Court sheet
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">{club.name}</h1>
          <p className="text-white/50 text-sm flex items-center gap-2">
            <MapPin size={12} />
            {sheet ? `${sheet.courts.length} courts · what's booked and what's open` : 'What’s booked and what’s open'}
          </p>

          <div className="mt-6">
            <DateNav date={date} onChange={setDate} todayISO={todayISO} />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* The sheet */}
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-white/60">
              {loading && !sheet ? 'Loading courts…' : `${openNow} open half hours`}
            </h2>
            {sheet?.bookingEnabled && (
              <p className="text-xs text-white/50">
                Prices per hour ·{' '}
                {sheet.audience === 'member' ? (
                  <span className="text-[var(--cm-accent,#D3FB52)]">your member rate</span>
                ) : sheet.signedIn ? (
                  'guest rate'
                ) : (
                  <>
                    guest rate
                    {sheet.memberFree ? ' — members play free. ' : '. Members, '}
                    <Link href={`/login?next=${encodeURIComponent(here)}`} className="underline text-white/80 hover:text-white">
                      sign in
                    </Link>
                    {sheet.memberFree ? '' : ' for your rate.'}
                  </>
                )}
              </p>
            )}
          </div>

          {sheet && sheet.courts.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/60">
              {club.name} hasn&apos;t added its courts yet.
            </div>
          ) : sheet ? (
            <>
              <SheetTable
                sheet={sheet}
                bookHref={(time) =>
                  sheet.bookable && hasSite
                    ? `/c/${club.slug}/courts/book?date=${sheet.date}&time=${time}`
                    : null
                }
              />
              <Legend />
              {sheet.bookingNote && <p className="mt-2 text-xs text-white/50">{sheet.bookingNote}</p>}
              {!sheet.bookingEnabled && (
                <p className="mt-2 text-xs text-white/50">
                  Open courts aren&apos;t bookable online here yet — call or ask the front desk.
                </p>
              )}
              {sheet.assumedHours && (
                <p className="mt-1 text-xs text-white/40">Showing 7am–10pm; the club hasn&apos;t posted hours.</p>
              )}
            </>
          ) : (
            <div className="cs-shimmer h-64 rounded-2xl" />
          )}
        </section>

        {/* CourtConnect — the reason a member opens this page is often "who can I play with". */}
        <CourtConnectCard audience={sheet?.audience ?? 'public'} signedIn={!!sheet?.signedIn} />

        {/* Open signups feed */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-white/60 mb-3">
            {openSignups.length === 0 ? 'Drop-ins & clinics' : `${openSignups.length} open to join`}
          </h2>

          {loading && reservations.length === 0 ? (
            <div className="cs-shimmer h-20 rounded-2xl" />
          ) : openSignups.length === 0 ? (
            <p className="text-white/40 text-sm">
              Nothing posted to join on this day. Drop-in play and clinics show up here when the club opens them.
            </p>
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
        </section>
      </div>

      <PublicSignupSheet
        target={signupTarget}
        clubName={club.name}
        onClose={() => setSignupTarget(null)}
        onJoined={() => {
          setSignupTarget(null);
          fetchFeed();
        }}
      />
    </div>
  );
}

function SheetTable({ sheet, bookHref }: { sheet: SheetResponse; bookHref: (time: string) => string | null }) {
  // Today opens at NOW. At noon, six hours of finished morning is the whole
  // first screen and the open courts are below the fold.
  const [showEarlier, setShowEarlier] = useState(false);
  useEffect(() => setShowEarlier(false), [sheet.date]);
  const pastCount = sheet.rows.filter((r) => r.past).length;
  const rows = showEarlier ? sheet.rows : sheet.rows.filter((r) => !r.past);
  return (
    <>
    {pastCount > 0 && (
      <button
        type="button"
        onClick={() => setShowEarlier((v) => !v)}
        className="mb-2 text-xs text-white/50 underline hover:text-white/80"
      >
        {showEarlier ? 'Hide earlier today' : 'Show earlier today'}
      </button>
    )}
    // Scrolls sideways INSIDE the card on a phone; the time column stays put.
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-auto max-h-[70vh]">
      <table className="border-separate border-spacing-0 text-xs w-full">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 bg-[var(--cm-ground,#001820)] w-14 min-w-14 border-b border-white/10" />
            {sheet.courts.map((c) => (
              <th
                key={c.id}
                className="sticky top-0 z-10 bg-[var(--cm-ground,#001820)] px-1 py-2 min-w-[4.5rem] font-semibold text-white/70 border-b border-white/10 whitespace-nowrap"
              >
                {c.name.replace(/^Court\s+/i, 'Ct ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const t = clock(row.time);
            const href = bookHref(row.time);
            return (
              <tr key={row.time}>
                <th
                  className={`sticky left-0 z-10 bg-[var(--cm-ground,#001820)] pr-2 text-right font-normal tabular-nums whitespace-nowrap ${t.onHour ? 'text-white/70 border-t border-white/10' : 'text-white/30'}`}
                >
                  {t.label}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={sheet.courts[i].id} className={`p-0.5 ${t.onHour ? 'border-t border-white/10' : ''}`}>
                    <Cell cell={cell} href={href} court={sheet.courts[i].name} time={row.time} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

function Cell({ cell, href, court, time }: { cell: SheetCell; href: string | null; court: string; time: string }) {
  const base = 'h-8 rounded-md flex items-center justify-center tabular-nums';
  if (cell.state === 'booked') {
    return (
      <div className={`${base} bg-white/[0.08] text-white/40`} title={`${court} ${time} — booked`}>
        Booked
      </div>
    );
  }
  if (cell.state === 'past' || cell.state === 'maintenance') {
    return <div className={`${base} bg-white/[0.02] text-white/20`}>{cell.state === 'maintenance' ? 'Closed' : ''}</div>;
  }
  const label = cell.centsPerHour == null ? 'Open' : money(cell.centsPerHour);
  const cls = `${base} border border-[var(--cm-accent,#D3FB52)]/30 bg-[var(--cm-accent,#D3FB52)]/10 text-[var(--cm-accent,#D3FB52)] font-semibold`;
  return href ? (
    <Link href={href} className={`${cls} hover:bg-[var(--cm-accent,#D3FB52)]/25`} title={`Book ${court} at ${time}`}>
      {label}
    </Link>
  ) : (
    <div className={cls}>{label}</div>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-white/50">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm border border-[var(--cm-accent,#D3FB52)]/30 bg-[var(--cm-accent,#D3FB52)]/10" />
        Open — tap to book
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm bg-white/[0.08]" />
        Booked
      </span>
    </div>
  );
}

function CourtConnectCard({ audience, signedIn }: { audience: 'member' | 'public'; signedIn: boolean }) {
  const href = signedIn ? '/courtconnect/home' : `/login?next=${encodeURIComponent('/courtconnect/home')}`;
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 sm:p-5 hover:bg-emerald-400/[0.1] transition"
    >
      <div className="shrink-0 w-11 h-11 rounded-xl bg-emerald-400/15 flex items-center justify-center">
        <Handshake size={20} className="text-emerald-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold">Need a game? Find one on CourtConnect</div>
        <div className="text-sm text-white/60 mt-0.5">
          {audience === 'member'
            ? 'Post a time, and players at your level get the invite and join.'
            : 'Members post a time, and players at their level get the invite and join. Sign in to start one.'}
        </div>
      </div>
      <ChevronRight size={18} className="shrink-0 text-white/40" />
    </Link>
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
          <div className="rounded-full px-3 py-1.5 text-[11px] uppercase tracking-widest font-semibold bg-[var(--cm-accent,#D3FB52)] text-[var(--cm-on-accent,#001820)] flex items-center gap-1">
            Join <ChevronRight size={11} />
          </div>
        )}
      </div>
    </button>
  );
}

function PublicSignupSheet({
  target,
  clubName,
  onClose,
  onJoined,
}: {
  target: PublicReservation | null;
  // Named in the SMS consent line: carriers require the opt-in to say who the
  // messages come from, not just "this club".
  clubName: string;
  onClose: () => void;
  onJoined: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [smsPhone, setSmsPhone] = useState('');
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
          sms_opt_in: smsOptIn && !!smsPhone.trim(),
          sms_phone: smsOptIn ? smsPhone.trim() : null,
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
      <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[var(--cm-ground,#001820)] border border-white/10 p-5 sm:p-6 space-y-4 shadow-2xl">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--cm-accent,#D3FB52)]">
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
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--cm-accent,#D3FB52)]/60"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--cm-accent,#D3FB52)]/60"
          />
          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--cm-accent,#D3FB52)]/60"
          />
          {/*
            SMS CONSENT — carrier-mandated wording. Do not shorten this.

            It read "Text me a confirmation", which got the A2P 10DLC campaign
            rejected (error 30909/30924): the opt-in has to state who is
            messaging, what the messages are, how often, that rates may apply,
            how to stop, and link Terms + Privacy. Carriers review this exact
            string. Unchecked by default is also required (30925) - never
            initialise smsOptIn to true.
          */}
          <label className="flex items-start gap-2.5 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={smsOptIn}
              onChange={(e) => setSmsOptIn(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[var(--cm-accent,#D3FB52)]"
            />
            <span className="text-sm text-white/80">
              Text me a confirmation.
              <span className="block mt-1 text-[12px] leading-relaxed text-white/50">
                By checking this box you agree to receive booking confirmations and court
                updates by text message from {clubName || 'this club'} via ClubMode.
                Message frequency varies. Msg &amp; data rates may apply. Reply STOP to
                unsubscribe or HELP for help. See our{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">Terms</a>
                {' '}and{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">Privacy Policy</a>.
                We never sell or share your mobile number with third parties for marketing.
              </span>
            </span>
          </label>
          {smsOptIn && (
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+1 555 123 4567"
              value={smsPhone}
              onChange={(e) => setSmsPhone(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--cm-accent,#D3FB52)]/60"
            />
          )}
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
            className="flex-1 py-2.5 rounded-xl bg-[var(--cm-accent,#D3FB52)] text-[var(--cm-on-accent,#001820)] text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Check size={14} />
            {submitting ? 'Signing up…' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}
