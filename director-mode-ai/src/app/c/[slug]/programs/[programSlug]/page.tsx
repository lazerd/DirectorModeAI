/**
 * One class, in full.
 *
 * The centrepiece is the list of actual dates. Not "10 weeks starting Sep 15" —
 * every date, with the skipped ones struck through and named. That is the
 * single thing this page does that no club website in the business does, and it
 * exists only because skip dates are data.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getClubProgram,
  getClubSite,
  programAvailability,
  registrationWindow,
} from '@/lib/clubSite/server';
import { readableOn, tint } from '@/lib/clubSite/theme';
import {
  daysLabel,
  formatPrice,
  formatSessionDate,
  formatTimeRange,
  programSessions,
} from '@/lib/programs/sessions';
import { getClubPayments, paymentOffer } from '@/lib/courts/payments';
import RegisterForm from './RegisterForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; programSlug: string }>;
}): Promise<Metadata> {
  const { slug, programSlug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) return { title: 'Not found' };
  const program = await getClubProgram(bundle.club.id, programSlug);
  if (!program) return { title: 'Not found' };

  const sessions = programSessions(program, bundle.club.timezone);
  return {
    title: `${program.title} — ${bundle.club.name}`,
    description:
      program.subtitle ||
      `${daysLabel(program.days_of_week)}, ${formatTimeRange(program.time_start, program.time_end)} · ${sessions.count} sessions at ${bundle.club.name}.`,
    alternates: { canonical: `/c/${bundle.club.slug}/programs/${program.slug}` },
  };
}

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ slug: string; programSlug: string }>;
}) {
  const { slug, programSlug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) notFound();

  const { club, theme } = bundle;
  const program = await getClubProgram(club.id, programSlug);
  // A draft program is reachable by URL only while its site is in draft, so a
  // club can check its own work; a stranger gets a 404 either way.
  if (!program || (program.status !== 'published' && !bundle.isDraft)) notFound();

  const sessions = programSessions(program, club.timezone);
  const [availability, clubPayments] = await Promise.all([
    programAvailability(program),
    getClubPayments(club.id),
  ]);
  // Resolved exactly as the register route resolves it, so the button a parent
  // is promised here is the button they get.
  const offer = paymentOffer({
    // An unpriced class owes nothing yet — the page says "Price on request"
    // rather than offering a checkout for a number nobody has set.
    amountCents: program.price_cents ?? 0,
    clubPayments,
    surface: 'program',
    ownLink: program.external_payment_url,
  });
  const window = registrationWindow(program);
  const onPrimary = readableOn(theme.primary);

  const canRegister = window.open && (!availability.full || program.waitlist_enabled);
  const waitlisting = window.open && availability.full && program.waitlist_enabled;

  const closedNote: Record<string, string> = {
    closed: 'Registration for this class is closed.',
    email_only: club.email
      ? `Registration for this one runs by email — write to ${club.email}.`
      : 'Registration for this one runs by email.',
    not_yet: program.registration_opens_at
      ? `Registration opens ${formatSessionDate(program.registration_opens_at.slice(0, 10), club.timezone, { weekday: true })}.`
      : 'Registration has not opened yet.',
    ended: 'Registration has closed for this session.',
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <Link
        href={`/c/${club.slug}/programs`}
        className="text-sm font-semibold"
        style={{ color: theme.primary }}
      >
        ← All programs
      </Link>

      <div className="mt-5 grid gap-10 lg:grid-cols-[1fr_380px]">
        {/* ------------------------------------------------------- the class */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
              style={{ background: tint(theme.primary, 0.12), color: theme.primary }}
            >
              {program.sport}
            </span>
            {(program.age_min || program.age_max) && (
              <span className="text-xs font-medium" style={{ color: tint(theme.ink, 0.55) }}>
                {program.age_min && program.age_max
                  ? `Ages ${program.age_min}–${program.age_max}`
                  : `Ages ${program.age_min}+`}
              </span>
            )}
          </div>

          <h1
            className="mt-3 text-3xl font-bold leading-tight sm:text-4xl"
            style={{ fontFamily: theme.headingFamily }}
          >
            {program.title}
          </h1>
          {program.subtitle && (
            <p className="mt-2 text-lg" style={{ color: tint(theme.ink, 0.65) }}>
              {program.subtitle}
            </p>
          )}

          <dl
            className="mt-6 grid gap-x-8 gap-y-3 rounded-2xl border p-5 text-sm sm:grid-cols-2"
            style={{ borderColor: tint(theme.ink, 0.12), background: theme.surface }}
          >
            <div>
              <dt className="font-semibold">When</dt>
              <dd style={{ color: tint(theme.ink, 0.7) }}>
                {daysLabel(program.days_of_week)},{' '}
                {formatTimeRange(program.time_start, program.time_end)}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Sessions</dt>
              <dd style={{ color: tint(theme.ink, 0.7) }}>
                {sessions.count} {sessions.count === 1 ? 'class' : 'classes'}
              </dd>
            </div>
            {program.coach_name && (
              <div>
                <dt className="font-semibold">Coach</dt>
                <dd style={{ color: tint(theme.ink, 0.7) }}>{program.coach_name}</dd>
              </div>
            )}
            <div>
              <dt className="font-semibold">Where</dt>
              <dd style={{ color: tint(theme.ink, 0.7) }}>
                {program.location_note || club.name}
              </dd>
            </div>
            {program.level_note && (
              <div className="sm:col-span-2">
                <dt className="font-semibold">Level</dt>
                <dd style={{ color: tint(theme.ink, 0.7) }}>{program.level_note}</dd>
              </div>
            )}
          </dl>

          {program.description && (
            <div className="mt-6 max-w-2xl space-y-4 text-base leading-relaxed">
              {program.description.split(/\n\s*\n/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}

          {/* --------------------------------------------------- every date */}
          <h2
            className="mt-10 text-xl font-bold"
            style={{ fontFamily: theme.headingFamily }}
          >
            Every date
          </h2>
          <p className="mt-1 text-sm" style={{ color: tint(theme.ink, 0.6) }}>
            Struck-through dates are weeks we skip — they are not charged and not made up.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[...sessions.dates.map((d) => ({ d, skipped: false })), ...sessions.skipped.map((d) => ({ d, skipped: true }))]
              .sort((a, b) => a.d.localeCompare(b.d))
              .map(({ d, skipped }) => (
                <span
                  key={d}
                  className="rounded-lg border px-3 py-1.5 text-sm"
                  style={
                    skipped
                      ? {
                          borderColor: tint(theme.ink, 0.12),
                          color: tint(theme.ink, 0.4),
                          textDecoration: 'line-through',
                          background: 'transparent',
                        }
                      : {
                          borderColor: tint(theme.primary, 0.3),
                          background: tint(theme.primary, 0.07),
                          color: theme.ink,
                          fontWeight: 600,
                        }
                  }
                >
                  {formatSessionDate(d, club.timezone, { weekday: true })}
                </span>
              ))}
            {sessions.dates.length === 0 && sessions.skipped.length === 0 && (
              <span className="text-sm" style={{ color: tint(theme.ink, 0.55) }}>
                Dates are being finalised.
              </span>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------- sign-up rail */}
        <aside>
          <div
            className="rounded-2xl border p-5 lg:sticky lg:top-6"
            style={{ borderColor: tint(theme.ink, 0.14), background: theme.surface }}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold" style={{ color: theme.primary }}>
                {formatPrice(program.price_cents)}
              </span>
              {sessions.count > 0 && (program.price_cents ?? 0) > 0 && (
                <span className="text-sm" style={{ color: tint(theme.ink, 0.55) }}>
                  for {sessions.count} {sessions.count === 1 ? 'class' : 'classes'}
                </span>
              )}
            </div>
            {program.member_price_cents != null && (
              <div className="mt-1 text-sm" style={{ color: tint(theme.ink, 0.7) }}>
                {formatPrice(program.member_price_cents)} for members
              </div>
            )}
            {program.drop_in_price_cents != null && (
              <div className="text-sm" style={{ color: tint(theme.ink, 0.7) }}>
                {formatPrice(program.drop_in_price_cents)} to drop in
              </div>
            )}
            {program.price_note && (
              <div className="mt-2 text-xs" style={{ color: tint(theme.ink, 0.6) }}>
                {program.price_note}
              </div>
            )}

            {program.capacity != null && (
              <div
                className="mt-4 rounded-lg px-3 py-2 text-sm font-semibold"
                style={{
                  background: availability.full ? 'rgba(245,158,11,0.12)' : tint(theme.primary, 0.1),
                  color: availability.full ? '#92400e' : theme.primary,
                }}
              >
                {availability.full
                  ? `Full — ${availability.waitlisted} on the waitlist`
                  : `${availability.spotsLeft} of ${program.capacity} spots left`}
              </div>
            )}

            <div className="mt-5">
              {canRegister ? (
                <RegisterForm
                  clubSlug={club.slug}
                  programSlug={program.slug}
                  waitlisting={!!waitlisting}
                  priceLabel={(program.price_cents ?? 0) > 0 ? formatPrice(program.price_cents) : ''}
                  hasPaymentLink={offer.kind === 'link'}
                  accent={theme.primary}
                  onAccent={onPrimary}
                  ink={theme.ink}
                  surface={theme.cream}
                  border={tint(theme.ink, 0.18)}
                />
              ) : (
                <div>
                  <p className="text-sm font-medium">
                    {closedNote[window.reason] ||
                      (availability.full ? 'This class is full.' : 'Registration is closed.')}
                  </p>
                  {club.phone && (
                    <a
                      href={`tel:${club.phone.replace(/[^0-9+]/g, '')}`}
                      className="mt-3 block rounded-xl px-4 py-3 text-center text-sm font-bold"
                      style={{ background: theme.primary, color: onPrimary }}
                    >
                      Call {club.phone}
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
