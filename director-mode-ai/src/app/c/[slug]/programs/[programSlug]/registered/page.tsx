/**
 * "You're in."
 *
 * Reads the saved row back rather than trusting what the form posted, so the
 * dates and the status a parent sees here are the ones the database actually
 * holds. If payment is owed and the club has a checkout link, this is where
 * they go pay — the one screen where that handoff belongs.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClubProgram, getClubSite } from '@/lib/clubSite/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { readableOn, tint } from '@/lib/clubSite/theme';
import {
  daysLabel,
  formatPrice,
  formatSessionDate,
  formatTimeRange,
  programSessions,
} from '@/lib/programs/sessions';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function RegisteredPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; programSlug: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { slug, programSlug } = await params;
  const { r } = await searchParams;

  const bundle = await getClubSite(slug);
  if (!bundle) notFound();
  const { club, theme } = bundle;
  const program = await getClubProgram(club.id, programSlug);
  if (!program) notFound();

  const { data: reg } = r
    ? await getSupabaseAdmin()
        .from('club_program_registrations')
        .select('id, participant_name, status, payment_status, amount_cents')
        .eq('id', r)
        .eq('program_id', program.id)
        .maybeSingle()
    : { data: null };

  const registration = reg as
    | {
        participant_name: string;
        status: string;
        payment_status: string;
        amount_cents: number | null;
      }
    | null;

  const sessions = programSessions(program, club.timezone);
  const onPrimary = readableOn(theme.primary);
  const waitlisted = registration?.status === 'waitlist';
  const owes =
    registration?.payment_status === 'pending' && (registration.amount_cents ?? 0) > 0 && !waitlisted;

  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <div
        className="rounded-2xl border p-7"
        style={{ borderColor: tint(theme.ink, 0.14), background: theme.surface }}
      >
        <div className="text-4xl">{waitlisted ? '⏳' : '✅'}</div>
        <h1
          className="mt-3 text-2xl font-bold sm:text-3xl"
          style={{ fontFamily: theme.headingFamily }}
        >
          {waitlisted ? "You're on the waitlist" : "You're in"}
          {registration ? ` — ${registration.participant_name}` : ''}
        </h1>
        <p className="mt-2 text-base" style={{ color: tint(theme.ink, 0.7) }}>
          {waitlisted
            ? `${program.title} is full. We email you the moment a spot opens, and nothing is owed until then.`
            : `${program.title} at ${club.name}. A confirmation is on its way to your inbox.`}
        </p>

        <dl className="mt-6 space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-semibold">When</dt>
            <dd style={{ color: tint(theme.ink, 0.75) }}>
              {daysLabel(program.days_of_week)},{' '}
              {formatTimeRange(program.time_start, program.time_end)}
            </dd>
          </div>
          {sessions.count > 0 && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 font-semibold">
                {sessions.count} {sessions.count === 1 ? 'date' : 'dates'}
              </dt>
              <dd style={{ color: tint(theme.ink, 0.75) }}>
                {sessions.dates.map((d) => formatSessionDate(d, club.timezone)).join(' · ')}
              </dd>
            </div>
          )}
          {sessions.skipped.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 font-semibold">We skip</dt>
              <dd style={{ color: tint(theme.ink, 0.75) }}>
                {sessions.skipped.map((d) => formatSessionDate(d, club.timezone)).join(' · ')}
              </dd>
            </div>
          )}
          {program.location_note && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 font-semibold">Where</dt>
              <dd style={{ color: tint(theme.ink, 0.75) }}>{program.location_note}</dd>
            </div>
          )}
        </dl>

        {owes && (
          <div
            className="mt-6 rounded-xl border p-4"
            style={{ borderColor: tint(theme.secondary, 0.4), background: tint(theme.secondary, 0.08) }}
          >
            <div className="font-bold">
              {formatPrice(registration?.amount_cents ?? program.price_cents)} due
            </div>
            {program.external_payment_url ? (
              <>
                <p className="mt-1 text-sm" style={{ color: tint(theme.ink, 0.7) }}>
                  Your spot is held. Pay now to lock it in.
                </p>
                <a
                  href={program.external_payment_url}
                  className="mt-3 inline-block rounded-xl px-5 py-3 text-sm font-bold"
                  style={{ background: theme.primary, color: onPrimary }}
                >
                  Pay now →
                </a>
              </>
            ) : (
              <p className="mt-1 text-sm" style={{ color: tint(theme.ink, 0.7) }}>
                Your spot is held — {club.name} will be in touch about payment.
              </p>
            )}
          </div>
        )}

        <div className="mt-7 flex flex-wrap gap-3 text-sm font-semibold">
          <Link href={`/c/${club.slug}/programs`} style={{ color: theme.primary }}>
            Browse other programs
          </Link>
          {club.email && (
            <a href={`mailto:${club.email}`} style={{ color: theme.primary }}>
              Email the club
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
