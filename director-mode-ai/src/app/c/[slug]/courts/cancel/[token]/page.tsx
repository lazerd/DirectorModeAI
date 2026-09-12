import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClubSite } from '@/lib/clubSite/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { readableOn, tint } from '@/lib/clubSite/theme';
import { formatSessionDate } from '@/lib/programs/sessions';
import CancelBooking from './CancelBooking';

export const dynamic = 'force-dynamic';
// Private by URL — a cancellation link must never turn up in a search result.
export const metadata = { robots: { index: false, follow: false } };

export default async function CancelBookingPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) notFound();
  const { club, theme } = bundle;

  // Shown before the button so somebody clicking a link from an old email can
  // see WHICH booking they are about to release. Shape-checked first: the
  // column is hex from gen_random_bytes.
  const valid = /^[0-9a-f]{32}$/.test(token);
  const { data } = valid
    ? await getSupabaseAdmin()
        .from('court_bookings')
        .select('status, minutes, amount_cents, reservations(starts_at), courts(name, number)')
        .eq('cancel_token', token)
        .eq('club_id', club.id)
        .maybeSingle()
    : { data: null };

  const booking = data as
    | {
        status: string;
        minutes: number;
        amount_cents: number;
        reservations: { starts_at: string } | null;
        courts: { name: string | null; number: number | null } | null;
      }
    | null;

  const startsAt = booking?.reservations?.starts_at ?? null;
  const when = startsAt
    ? `${formatSessionDate(
        new Intl.DateTimeFormat('en-CA', { timeZone: club.timezone }).format(new Date(startsAt)),
        club.timezone,
        { weekday: true },
      )}, ${new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: club.timezone,
      }).format(new Date(startsAt))}`
    : null;
  const courtName =
    booking?.courts?.name || (booking?.courts?.number != null ? `Court ${booking.courts.number}` : null);

  return (
    <div className="mx-auto max-w-xl px-5 py-14">
      <h1 className="text-2xl font-bold sm:text-3xl" style={{ fontFamily: theme.headingFamily }}>
        Cancel your court
      </h1>

      {!booking ? (
        <div
          className="mt-6 rounded-2xl border p-6"
          style={{ borderColor: tint(theme.ink, 0.16), background: theme.surface }}
        >
          <p className="font-medium">We couldn&apos;t find that booking.</p>
          <p className="mt-2 text-sm" style={{ color: tint(theme.ink, 0.6) }}>
            The link may be from an old email, or the booking may already be gone.
            {club.phone ? ` Call ${club.phone} and we'll sort it out.` : ''}
          </p>
        </div>
      ) : (
        <>
          {when && (
            <p className="mt-2 text-base" style={{ color: tint(theme.ink, 0.7) }}>
              {courtName ? `${courtName} · ` : ''}
              {when} · {booking.minutes} minutes
            </p>
          )}
          <div className="mt-6">
            <CancelBooking
              clubSlug={club.slug}
              token={token}
              theme={{
                primary: theme.primary,
                onPrimary: readableOn(theme.primary),
                ink: theme.ink,
                muted: tint(theme.ink, 0.6),
                border: tint(theme.ink, 0.16),
                surface: theme.surface,
              }}
            />
          </div>
        </>
      )}

      <Link
        href={`/c/${club.slug}/courts`}
        className="mt-6 inline-block text-sm font-semibold"
        style={{ color: theme.primary }}
      >
        ← Court time
      </Link>
    </div>
  );
}
