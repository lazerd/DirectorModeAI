/**
 * Court time — hours, rates, and booking.
 *
 * A club that has set up rate cards gets a real Book a court button here, and
 * the rates shown are the ones a booking is priced against. A club that has
 * not still gets its published price list and a phone number, because
 * offering "book online" and then handing someone a phone number is worse than
 * a page that tells them to call.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getClubSite } from '@/lib/clubSite/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getRateCards } from '@/lib/courts/server';
import { bookingEnabled, bookingRules, type RateCard } from '@/lib/courts/pricing';
import { readableOn, tint } from '@/lib/clubSite/theme';
import { daysLabel, formatPrice } from '@/lib/programs/sessions';

export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) return { title: 'Not found' };
  return {
    title: `Court time — ${bundle.club.name}`,
    description: `Court hours, rates and booking at ${bundle.club.name}.`,
    alternates: { canonical: `/c/${bundle.club.slug}/courts` },
  };
}

export default async function ClubCourtsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) notFound();

  const { club, site, theme } = bundle;
  const onPrimary = readableOn(theme.primary);

  // How many courts the club actually has, from CourtSheet rather than a
  // number somebody typed into the marketing copy and then forgot.
  const { count: courtCount } = await getSupabaseAdmin()
    .from('courts')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', club.id)
    .neq('status', 'hidden');

  /** operating_hours is {"1":[{open,close}], …} keyed by Postgres DOW; {} = 24/7. */
  const { data: hoursRow } = await getSupabaseAdmin()
    .from('cc_clubs')
    .select('operating_hours')
    .eq('id', club.id)
    .maybeSingle();
  const hours = ((hoursRow as { operating_hours?: Record<string, { open: string; close: string }[]> } | null)
    ?.operating_hours) || {};
  const hasHours = Object.keys(hours).length > 0;

  /*
   * Rates come from court_rate_cards when the club has set them up, because
   * those are the numbers a booking is actually priced against. The jsonb list
   * on club_site is the fallback for a club that typed its rates in before
   * online booking existed — two sources, but never two ANSWERS: whichever one
   * drives the booking is the one shown.
   */
  const rateCards: RateCard[] = await getRateCards(club.id);
  const canBook = bookingEnabled(rateCards);
  const memberRules = bookingRules(rateCards, 'member');
  const publicRules = bookingRules(rateCards, 'public');

  const pretty = (t: string) => {
    const [h, m] = t.split(':').map((s) => parseInt(s, 10));
    const suffix = h >= 12 ? 'pm' : 'am';
    const hour = h % 12 === 0 ? 12 : h % 12;
    return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="text-3xl font-bold sm:text-4xl" style={{ fontFamily: theme.headingFamily }}>
        Court time
      </h1>
      {site.courts_blurb && (
        <p className="mt-3 max-w-2xl text-base leading-relaxed" style={{ color: tint(theme.ink, 0.7) }}>
          {site.courts_blurb}
        </p>
      )}
      {(courtCount ?? 0) > 0 && (
        <p className="mt-2 text-sm font-semibold" style={{ color: theme.primary }}>
          {courtCount} {courtCount === 1 ? 'court' : 'courts'}
        </p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {canBook ? (
          <section>
            <h2 className="text-xl font-bold" style={{ fontFamily: theme.headingFamily }}>
              Rates
            </h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr style={{ color: tint(theme.ink, 0.55) }} className="text-left">
                    <th className="py-2 pr-4 font-semibold">Rate</th>
                    <th className="py-2 pr-4 font-semibold">When</th>
                    <th className="py-2 font-semibold">Per hour</th>
                  </tr>
                </thead>
                <tbody>
                  {rateCards.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${tint(theme.ink, 0.1)}` }}>
                      <td className="py-3 pr-4">
                        <div className="font-semibold">{r.label}</div>
                        <div className="text-xs" style={{ color: tint(theme.ink, 0.55) }}>
                          {r.applies_to === 'member' ? 'Members' : 'Public'}
                        </div>
                      </td>
                      <td className="py-3 pr-4" style={{ color: tint(theme.ink, 0.7) }}>
                        {daysLabel(r.days_of_week)}
                        <div className="text-xs" style={{ color: tint(theme.ink, 0.5) }}>
                          {r.time_start.slice(0, 5)}–{r.time_end.slice(0, 5)}
                        </div>
                      </td>
                      <td className="py-3 font-medium">{formatPrice(r.price_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs" style={{ color: tint(theme.ink, 0.5) }}>
              Members book up to {memberRules.advanceDays} days ahead; the public up to{' '}
              {publicRules.advanceDays}.
            </p>
          </section>
        ) : site.court_rates.length > 0 ? (
          <section>
            <h2 className="text-xl font-bold" style={{ fontFamily: theme.headingFamily }}>
              Rates
            </h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr style={{ color: tint(theme.ink, 0.55) }} className="text-left">
                    <th className="py-2 pr-4 font-semibold">When</th>
                    <th className="py-2 pr-4 font-semibold">Members</th>
                    <th className="py-2 font-semibold">Public</th>
                  </tr>
                </thead>
                <tbody>
                  {site.court_rates.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${tint(theme.ink, 0.1)}` }}>
                      <td className="py-3 pr-4">
                        <div className="font-semibold">{r.label}</div>
                        {r.window && (
                          <div className="text-xs" style={{ color: tint(theme.ink, 0.55) }}>
                            {r.window}
                          </div>
                        )}
                        {r.note && (
                          <div className="text-xs" style={{ color: tint(theme.ink, 0.45) }}>
                            {r.note}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-medium">{formatPrice(r.member_cents)}</td>
                      <td className="py-3 font-medium">{formatPrice(r.public_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {hasHours && (
          <section>
            <h2 className="text-xl font-bold" style={{ fontFamily: theme.headingFamily }}>
              Hours
            </h2>
            <table className="mt-4 text-sm">
              <tbody>
                {DAY_NAMES.map((name, dow) => {
                  const windows = hours[String(dow)] || [];
                  return (
                    <tr key={dow}>
                      <td className="py-1.5 pr-6 font-semibold">{name}</td>
                      <td className="py-1.5" style={{ color: tint(theme.ink, 0.7) }}>
                        {windows.length
                          ? windows.map((w) => `${pretty(w.open)}–${pretty(w.close)}`).join(', ')
                          : 'Closed'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <section className="mt-12">
        <h2 className="text-xl font-bold" style={{ fontFamily: theme.headingFamily }}>
          Booking a court
        </h2>
        <div
          className="mt-4 max-w-2xl rounded-2xl border p-5"
          style={{ borderColor: tint(theme.ink, 0.12), background: theme.surface }}
        >
          {site.booking_policy_body ? (
            <div className="space-y-3 text-base leading-relaxed">
              {site.booking_policy_body.split(/\n\s*\n/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : (
            <p className="text-base" style={{ color: tint(theme.ink, 0.7) }}>
              Call the club to reserve a court.
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            {canBook && (
              <Link
                href={`/c/${club.slug}/courts/book`}
                className="rounded-xl px-5 py-3 text-sm font-bold"
                style={{ background: theme.primary, color: onPrimary }}
              >
                Book a court →
              </Link>
            )}
            {club.phone && (
              <a
                href={`tel:${club.phone.replace(/[^0-9+]/g, '')}`}
                className={
                  canBook
                    ? 'rounded-xl border px-5 py-3 text-sm font-semibold'
                    : 'rounded-xl px-5 py-3 text-sm font-bold'
                }
                style={
                  canBook
                    ? { borderColor: tint(theme.ink, 0.2) }
                    : { background: theme.primary, color: onPrimary }
                }
              >
                Call {club.phone}
              </a>
            )}
            {/*
              The open-signup board. Only worth pointing at when the club is
              actually posting drop-in times — otherwise it is an empty page
              that reads as broken.
            */}
            <Link
              href={`/courtsheet/${club.slug}`}
              className="rounded-xl border px-5 py-3 text-sm font-semibold"
              style={{ borderColor: tint(theme.ink, 0.2) }}
            >
              See open court time
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
