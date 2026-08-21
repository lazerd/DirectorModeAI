import Link from 'next/link';
import { format } from 'date-fns';
import {
  AlertCircle,
  MapPin,
  Clock,
  CalendarDays,
  Users,
  Ticket,
  Trophy,
  Check,
} from 'lucide-react';
import type { Sponsor } from '@/config/sponsors';
import { quadScoringLabel, formatTimeDisplay } from '@/lib/quads';
import { PLAYERS_PER_QUAD, type QuadDivision } from '@/lib/quadDivisions';
import SponsorWordmark from './SponsorWordmark';
import RegisterForm from '@/app/quads/[slug]/RegisterForm';

export type DivisionStatus = QuadDivision & {
  inLine: number;
  spotsLeft: number;
  waiting: number;
};

export type SiblingDate = {
  slug: string;
  eventDate: string;
  isCurrent: boolean;
  isOpen: boolean;
};

const GENDER_LABELS: Record<string, string> = {
  boys: 'Boys only',
  girls: 'Girls only',
  coed: 'Open to boys and girls',
};

/** Adjectival form, for "one 2-hour window". */
function durationLabel(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '2-hour block';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m block`;
  if (h) return `${h}-hour block`;
  return `${m}-minute block`;
}

/** Noun form, for "four matches in 2 hours". */
function durationNoun(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '2 hours';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h} hour${h === 1 ? '' : 's'}`;
  return `${m} minutes`;
}

export default function SponsoredQuadLanding({
  event,
  sponsor,
  spotsLeft,
  spotsTotal,
  waitlistCount,
  closedReason,
  cancelled,
  divisions = [],
  siblings = [],
}: {
  event: any;
  sponsor: Sponsor;
  spotsLeft: number | null;
  spotsTotal: number | null;
  waitlistCount: number;
  closedReason: string | null;
  cancelled: boolean;
  divisions?: DivisionStatus[];
  siblings?: SiblingDate[];
}) {
  const c = sponsor.colors;
  const e = event;
  const requestMode = e.entry_flow === 'request_then_invite';

  // How long a PLAYER is actually on court: four rounds back to back. That's
  // not the same as the booking window — a 9am-1pm block can hold more than
  // one wave of quads — so never describe the format using the block length.
  const playMinutes = 4 * (e.round_duration_minutes ?? 30);

  const dateLabel = e.event_date
    ? format(new Date(e.event_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')
    : 'Date to be announced';
  const timeLabel = e.start_time
    ? e.end_time
      ? `${formatTimeDisplay(e.start_time)} – ${formatTimeDisplay(e.end_time)}`
      : `${formatTimeDisplay(e.start_time)} · ${durationLabel(e.duration_minutes)}`
    : `Time TBD · ${durationLabel(e.duration_minutes)}`;
  const blockNote = e.start_time && e.end_time ? 'Arrive 15 min early' : null;
  // The scheduling promise parents actually plan around: four matches, one
  // fixed window, done at the end time. Only claim it when both ends are set.
  const guaranteedWindow =
    e.start_time && e.end_time
      ? `${formatTimeDisplay(e.start_time)} – ${formatTimeDisplay(e.end_time)}`
      : null;
  const doneBy = e.end_time ? formatTimeDisplay(e.end_time) : null;
  const feeLabel = e.entry_fee_cents > 0 ? `$${(e.entry_fee_cents / 100).toFixed(0)}` : 'Free';

  const facts = [
    { icon: CalendarDays, label: 'Date', value: dateLabel },
    { icon: Clock, label: 'Time', value: timeLabel, sub: blockNote ?? undefined },
    { icon: Ticket, label: 'Entry fee', value: feeLabel, sub: 'Everything below included' },
    {
      icon: Users,
      label: 'Divisions',
      value:
        divisions.length > 0
          ? divisions.map((d) => d.label.replace(' & Under', 'U').replace(' & Over', '+')).join(' · ')
          : e.age_max
            ? `${e.age_max} & Under`
            : 'All ages',
      sub: GENDER_LABELS[e.gender_restriction] ?? 'Open to boys and girls',
    },
  ];

  const rounds = [
    {
      n: '1',
      title: 'Singles',
      body: 'You play the #4 seed in your quad. Fast4 set, no-ad scoring.',
    },
    { n: '2', title: 'Singles', body: 'A second Fast4 singles match against a new opponent.' },
    {
      n: '3',
      title: 'Singles',
      body: 'Your last singles match. Now the quad has a 1-2-3-4 ladder.',
    },
    {
      n: '4',
      title: 'Doubles',
      body: 'Auto-paired off the ladder: 1st plays with 4th against 2nd and 3rd. Same Fast4, no-ad.',
      highlight: true,
    },
  ];

  return (
    <div style={{ backgroundColor: c.cream, color: c.ink }} className="min-h-screen">
      {/* ---- Sponsor bar ---- */}
      <div
        className="w-full border-b"
        style={{ backgroundColor: c.surface, borderColor: 'rgba(0,0,0,0.08)' }}
      >
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="text-[10px] uppercase tracking-[0.18em] font-bold whitespace-nowrap"
              style={{ color: 'rgba(0,0,0,0.45)' }}
            >
              {sponsor.presentedBy}
            </span>
            <SponsorWordmark sponsor={sponsor} size="md" />
          </div>
          {!closedReason && (
            <a
              href="#register"
              className="text-xs sm:text-sm font-bold px-4 py-2 rounded-full text-white whitespace-nowrap"
              style={{ backgroundColor: c.primary }}
            >
              Register — {feeLabel}
            </a>
          )}
        </div>
      </div>

      {/* ---- Date switcher (multi-date series) ---- */}
      {siblings.length > 1 && (
        <div className="w-full" style={{ backgroundColor: c.cream }}>
          <div className="max-w-4xl mx-auto px-4 pt-4 pb-1">
            <div className="text-[10px] uppercase tracking-[0.18em] font-bold mb-2" style={{ color: 'rgba(0,0,0,0.45)' }}>
              Pick your date
            </div>
            <div className="flex flex-wrap gap-2">
              {siblings.map((s) => {
                const label = format(new Date(s.eventDate + 'T00:00:00'), 'EEE, MMM d');
                return s.isCurrent ? (
                  <span
                    key={s.slug}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: c.primary }}
                  >
                    <Check size={14} /> {label}
                  </span>
                ) : (
                  <Link
                    key={s.slug}
                    href={`/quads/${s.slug}`}
                    className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold border transition-colors hover:bg-white"
                    style={{ borderColor: 'rgba(0,0,0,0.15)', color: c.ink }}
                  >
                    {label}
                    {!s.isOpen && (
                      <span className="ml-1.5 text-xs" style={{ color: 'rgba(0,0,0,0.45)' }}>
                        (closed)
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ---- Hero ---- */}
      <header
        className="relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${c.primary} 0%, ${c.secondary} 100%)`,
        }}
      >
        {/* soft donut-ish rings */}
        <div
          aria-hidden
          className="absolute -right-16 -top-16 w-64 h-64 rounded-full border-[24px]"
          style={{ borderColor: 'rgba(255,255,255,0.12)' }}
        />
        <div
          aria-hidden
          className="absolute -left-10 -bottom-20 w-52 h-52 rounded-full border-[20px]"
          style={{ borderColor: 'rgba(255,255,255,0.10)' }}
        />
        <div className="relative max-w-4xl mx-auto px-4 py-12 sm:py-16 text-white">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-xs font-bold uppercase tracking-wider mb-4">
            <Trophy size={13} /> Quads · 4 players · 4 matches
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight max-w-2xl">{e.name}</h1>
          <p className="mt-3 text-base sm:text-lg text-white/90 max-w-xl font-medium">
            {sponsor.tagline}
          </p>
          {guaranteedWindow && (
            <p className="mt-3 inline-flex items-center gap-2 text-sm sm:text-base font-bold bg-white/20 rounded-full px-4 py-1.5">
              <Clock size={15} />
              Four matches, one {durationLabel(e.duration_minutes).replace(' block', '')} window —
              done by {doneBy}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold">
            <span className="flex items-center gap-1.5">
              <CalendarDays size={15} /> {dateLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={15} /> {timeLabel}
            </span>
            {e.venue && (
              <span className="flex items-center gap-1.5">
                <MapPin size={15} /> {e.venue}
              </span>
            )}
          </div>
          {!closedReason && divisions.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {divisions.map((d) => (
                <div
                  key={d.id}
                  className="bg-white rounded-xl px-3.5 py-2 text-sm font-bold"
                  style={{ color: d.spotsLeft > 0 ? c.primary : 'rgba(0,0,0,0.5)' }}
                >
                  {d.label}:{' '}
                  {d.spotsLeft > 0 ? `${d.spotsLeft} of ${PLAYERS_PER_QUAD} left` : 'waitlist'}
                </div>
              ))}
            </div>
          )}
          {!closedReason && divisions.length === 0 && spotsLeft !== null && (
            <div className="mt-6 inline-block bg-white rounded-xl px-4 py-2.5 text-sm font-bold" style={{ color: c.primary }}>
              {spotsLeft > 0
                ? `${spotsLeft} of ${spotsTotal} spots left`
                : 'Field full — join the waitlist below'}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-10 space-y-8">
        {cancelled && (
          <div className="rounded-xl p-3 text-sm flex items-start gap-2 bg-amber-50 border border-amber-300 text-amber-900">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            Payment was cancelled — your spot wasn&rsquo;t saved. Feel free to try again below.
          </div>
        )}

        {/* ---- Quick facts ---- */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {facts.map((f) => (
            <div
              key={f.label}
              className="rounded-2xl p-4"
              style={{ backgroundColor: c.surface, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}
            >
              <div
                className="text-[10px] uppercase tracking-widest font-bold mb-1.5 flex items-center gap-1"
                style={{ color: c.secondary }}
              >
                <f.icon size={12} /> {f.label}
              </div>
              <div className="font-bold text-sm leading-snug" style={{ color: c.ink }}>
                {f.value}
              </div>
              {f.sub && (
                <div className="text-xs mt-0.5" style={{ color: 'rgba(0,0,0,0.5)' }}>
                  {f.sub}
                </div>
              )}
            </div>
          ))}
        </section>

        {/* ---- Divisions + how spots are awarded ---- */}
        {divisions.length > 0 && (
          <section
            className="rounded-3xl p-6 sm:p-8"
            style={{ backgroundColor: c.surface, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}
          >
            <h2 className="text-xl sm:text-2xl font-extrabold mb-1" style={{ color: c.ink }}>
              Three quads, three divisions
            </h2>
            <p className="text-sm mb-5" style={{ color: 'rgba(0,0,0,0.6)' }}>
              The block fits {e.total_quads ?? divisions.length} groups of four. First four signups
              in a division get the spots; after that you join that division&rsquo;s waitlist.
            </p>

            <div className="grid sm:grid-cols-3 gap-3">
              {divisions.map((d) => {
                const full = d.spotsLeft === 0;
                return (
                  <div
                    key={d.id}
                    className="rounded-2xl p-4 border-2"
                    style={{
                      backgroundColor: c.cream,
                      borderColor: full ? 'rgba(0,0,0,0.10)' : c.primary,
                    }}
                  >
                    <div className="font-extrabold text-base" style={{ color: c.ink }}>
                      {d.label}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      {Array.from({ length: PLAYERS_PER_QUAD }).map((_, i) => (
                        <span
                          key={i}
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={
                            i < Math.min(d.inLine, PLAYERS_PER_QUAD)
                              ? { backgroundColor: c.primary, color: '#fff' }
                              : { backgroundColor: 'rgba(0,0,0,0.08)', color: 'rgba(0,0,0,0.35)' }
                          }
                        >
                          {i + 1}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs mt-2 font-semibold" style={{ color: full ? 'rgba(0,0,0,0.5)' : c.secondary }}>
                      {full
                        ? d.waiting > 0
                          ? `Full · ${d.waiting} on the waitlist`
                          : 'Full'
                        : `${d.spotsLeft} spot${d.spotsLeft === 1 ? '' : 's'} left`}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              className="mt-5 rounded-2xl p-4 border-2 border-dashed"
              style={{ borderColor: c.primary }}
            >
              <div
                className="text-[10px] uppercase tracking-[0.18em] font-bold mb-1.5"
                style={{ color: c.secondary }}
              >
                If a division doesn&rsquo;t fill
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(0,0,0,0.7)' }}>
                A division needs four players to run. If one comes up short we cancel it and give
                its court block to a division with players waiting — so eight signups at 10 &amp;
                Under becomes two 10U quads. Nobody in a cancelled division is charged.
              </p>
            </div>
          </section>
        )}

        {/* ---- Perks: what the sponsor brings ---- */}
        <section
          className="rounded-3xl p-6 sm:p-8"
          style={{ backgroundColor: c.surface, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl sm:text-2xl font-extrabold" style={{ color: c.ink }}>
              Breakfast is on
            </h2>
            <SponsorWordmark sponsor={sponsor} size="md" />
          </div>
          <p className="text-sm mb-6" style={{ color: 'rgba(0,0,0,0.6)' }}>
            Courtside all morning, free for every family in the event.
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            {sponsor.perks.map((p) => (
              <div
                key={p.title}
                className="rounded-2xl p-4"
                style={{ backgroundColor: c.cream }}
              >
                <div className="text-3xl mb-2" aria-hidden>
                  {p.emoji}
                </div>
                <div className="font-bold text-sm mb-1" style={{ color: c.primary }}>
                  {p.title}
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'rgba(0,0,0,0.65)' }}>
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Prize ---- */}
        <section
          className="rounded-3xl p-6 sm:p-8 text-white relative overflow-hidden"
          style={{ background: `linear-gradient(120deg, ${c.secondary} 0%, ${c.primary} 100%)` }}
        >
          <div
            aria-hidden
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[120px] leading-none opacity-20 select-none hidden sm:block"
          >
            🎁
          </div>
          <div className="relative max-w-xl">
            <div className="text-[10px] uppercase tracking-[0.2em] font-bold mb-2 text-white/80">
              Champion&rsquo;s prize
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold leading-tight">
              {sponsor.prize.headline}
            </h2>
            <p className="mt-3 text-sm sm:text-base text-white/90 leading-relaxed">
              {sponsor.prize.body}
            </p>
            {divisions.length > 0 && (
              <p className="mt-2 text-sm text-white/80">
                That&rsquo;s one winner per quad — up to {e.total_quads ?? divisions.length} gift
                cards on the day.
              </p>
            )}
          </div>
        </section>

        {/* ---- Format ---- */}
        <section
          className="rounded-3xl p-6 sm:p-8"
          style={{ backgroundColor: c.surface, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}
        >
          <h2 className="text-xl sm:text-2xl font-extrabold mb-1" style={{ color: c.ink }}>
            Four matches in {durationNoun(playMinutes)}
          </h2>
          <p className="text-sm mb-4" style={{ color: 'rgba(0,0,0,0.6)' }}>
            You&rsquo;re grouped into a quad of four players at your level. Everybody plays every
            round — no draws, no early exits, nobody sitting out.
          </p>

          {guaranteedWindow && (
            <div
              className="mb-6 rounded-2xl p-4 flex items-start gap-3"
              style={{ backgroundColor: c.cream }}
            >
              <Clock size={18} className="mt-0.5 flex-shrink-0" style={{ color: c.secondary }} />
              <div>
                <div className="font-bold text-sm" style={{ color: c.ink }}>
                  Plan your day around {guaranteedWindow}
                </div>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(0,0,0,0.65)' }}>
                  Every quad runs at the same time on its own pair of courts, and rounds are on a
                  clock — so all four matches finish inside the window. No waiting around for a
                  draw to come back to you, and no chance of a 1pm finish. Drop off at{' '}
                  {formatTimeDisplay(e.start_time)}, pick up at {doneBy}.
                </p>
              </div>
            </div>
          )}

          <ol className="space-y-3">
            {rounds.map((r) => (
              <li
                key={r.n}
                className="flex gap-4 rounded-2xl p-4"
                style={{
                  backgroundColor: r.highlight ? c.cream : 'transparent',
                  border: `1px solid ${r.highlight ? c.primary : 'rgba(0,0,0,0.08)'}`,
                }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-white flex-shrink-0"
                  style={{ backgroundColor: r.highlight ? c.secondary : c.primary }}
                >
                  {r.n}
                </div>
                <div>
                  <div className="font-bold text-sm" style={{ color: c.ink }}>
                    Round {r.n} — {r.title}
                  </div>
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'rgba(0,0,0,0.65)' }}>
                    {r.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {/* Winner rule */}
          <div
            className="mt-5 rounded-2xl p-4 border-2 border-dashed"
            style={{ borderColor: c.primary }}
          >
            <div
              className="text-[10px] uppercase tracking-[0.18em] font-bold mb-1.5"
              style={{ color: c.secondary }}
            >
              How the winner is decided
            </div>
            <p className="text-sm font-semibold" style={{ color: c.ink }}>
              Most games won across all four rounds.
            </p>
            <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'rgba(0,0,0,0.65)' }}>
              Every game you win counts — singles and doubles. That keeps the last match live for
              all four players: win the doubles and you bank up to four more games. Ties are broken
              by matches won, then head-to-head, then fewest games lost.
            </p>
            <p className="text-xs mt-2" style={{ color: 'rgba(0,0,0,0.5)' }}>
              Scoring: {quadScoringLabel(e.event_scoring_format) || 'Fast4, no-ad'}
            </p>
          </div>
        </section>

        {/* ---- Register ---- */}
        <section id="register" className="scroll-mt-4">
          {closedReason ? (
            <div
              className="rounded-3xl p-6 flex items-start gap-3"
              style={{ backgroundColor: c.surface, border: `2px solid ${c.primary}` }}
            >
              <AlertCircle size={20} className="mt-0.5 flex-shrink-0" style={{ color: c.primary }} />
              <div>
                <p className="font-bold" style={{ color: c.ink }}>
                  Registration unavailable
                </p>
                <p className="text-sm" style={{ color: 'rgba(0,0,0,0.65)' }}>
                  {closedReason}
                </p>
                <Link
                  href={`/quads/${e.slug}/results`}
                  className="inline-block mt-3 text-sm font-bold underline"
                  style={{ color: c.primary }}
                >
                  See the results →
                </Link>
              </div>
            </div>
          ) : (
            <div
              className="rounded-3xl p-6 sm:p-8"
              style={{ backgroundColor: c.surface, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}
            >
              <h2 className="text-xl sm:text-2xl font-extrabold mb-1" style={{ color: c.ink }}>
                {requestMode ? 'Request a spot' : 'Grab a spot'}
              </h2>
              <p className="text-sm mb-4" style={{ color: 'rgba(0,0,0,0.6)' }}>
                {feeLabel} covers all four matches, the donuts and coffee, and a shot at the gift
                card.
                {waitlistCount > 0 && (
                  <>
                    {' '}
                    <span style={{ color: c.secondary }} className="font-semibold">
                      {waitlistCount} player{waitlistCount === 1 ? '' : 's'} already waitlisted.
                    </span>
                  </>
                )}
              </p>

              {requestMode && (
                <ol className="mb-5 space-y-2">
                  {[
                    {
                      n: 1,
                      t: 'Request a spot',
                      b: 'No card needed — you’re getting in line, not paying yet.',
                    },
                    {
                      n: 2,
                      t: 'We confirm the divisions',
                      b: 'Once registration closes we lock in which quads are running.',
                    },
                    {
                      n: 3,
                      t: `Pay ${feeLabel} within 24 hours`,
                      b: 'Accepted players get a payment link. Paying is what holds the spot.',
                    },
                  ].map((step) => (
                    <li key={step.n} className="flex gap-3 items-start">
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: c.secondary }}
                      >
                        {step.n}
                      </span>
                      <span className="text-sm">
                        <span className="font-bold" style={{ color: c.ink }}>
                          {step.t}
                        </span>{' '}
                        <span style={{ color: 'rgba(0,0,0,0.6)' }}>— {step.b}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              <RegisterForm
                slug={e.slug}
                feeCents={e.entry_fee_cents ?? 0}
                ageMax={e.age_max}
                genderRestriction={e.gender_restriction}
                accent={c.primary}
                divisions={divisions}
                eventDate={e.event_date}
                requestMode={requestMode}
                submitLabel={
                  requestMode ? (
                    // Never call this "free" — the event costs money, the
                    // REQUEST doesn't. Two lines so the distinction survives
                    // on a phone.
                    <span className="flex flex-col leading-tight py-0.5">
                      <span>Request my spot</span>
                      <span className="text-[11px] font-medium opacity-90">
                        No payment due until selected for the event
                      </span>
                    </span>
                  ) : e.entry_fee_cents > 0 ? (
                    `Reserve my spot — ${feeLabel}`
                  ) : (
                    'Reserve my spot'
                  )
                }
              />
              <p className="text-xs mt-3" style={{ color: 'rgba(0,0,0,0.45)' }}>
                By registering you agree to receive emails about this event. Unsubscribe any time.
              </p>
            </div>
          )}
        </section>

        {/* ---- Sponsor locations ---- */}
        <section
          className="rounded-3xl p-6 sm:p-8"
          style={{ backgroundColor: c.surface, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-extrabold" style={{ color: c.ink }}>
              Your local
            </h2>
            <SponsorWordmark sponsor={sponsor} size="sm" />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {sponsor.locations.map((loc) => (
              <a
                key={loc.street}
                href={loc.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-2xl p-4 flex items-start gap-3 transition-transform hover:-translate-y-0.5"
                style={{ backgroundColor: c.cream }}
              >
                <MapPin size={18} className="mt-0.5 flex-shrink-0" style={{ color: c.secondary }} />
                <div>
                  <div className="font-bold text-sm" style={{ color: c.primary }}>
                    {loc.label}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'rgba(0,0,0,0.7)' }}>
                    {loc.street}
                  </div>
                  <div className="text-xs" style={{ color: 'rgba(0,0,0,0.7)' }}>
                    {loc.city}
                  </div>
                  <div className="text-xs mt-1.5 font-semibold" style={{ color: c.secondary }}>
                    Get directions →
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>

        <footer className="text-center space-y-2 pb-4">
          <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(0,0,0,0.45)' }}>
            {sponsor.legal}
          </p>
          <Link
            href="/"
            className="inline-block text-[11px] font-semibold"
            style={{ color: 'rgba(0,0,0,0.35)' }}
          >
            Powered by CoachMode
          </Link>
        </footer>
      </main>
    </div>
  );
}
