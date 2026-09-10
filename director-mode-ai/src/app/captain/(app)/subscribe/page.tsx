import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  getCaptainAccess,
  resolveCaptainRate,
  MAX_TEAMS_PER_CAPTAIN,
  TRIAL_DAYS,
} from '@/lib/captain/access';
import { captainCheckoutConfigured } from '@/lib/lemonsqueezy';
import { CAPTAIN_CLUB_PRICE_USD, CAPTAIN_SOLO_PRICE_USD } from '@/config/pricing';
import SubscribeButton from '@/components/captain/SubscribeButton';

export const dynamic = 'force-dynamic';

/**
 * Subscription state + rate explanation. Checkout itself goes through
 * /api/billing/checkout; this page is where a captain learns which rate
 * applies and why. The rate comes from resolveCaptainRate — the same function
 * checkout uses — so the page can never quote a different price than the till.
 */
export default async function SubscribePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/captain/subscribe');

  const access = await getCaptainAccess(user.id);

  // Is this captain attached to a club on ClubMode? That decides the price.
  const db = await createServiceClient();
  const { data: membership } = await db
    .from('cc_club_members')
    .select('club_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  const clubId = access.clubId || (membership as { club_id: string } | null)?.club_id || null;
  let clubName: string | null = null;

  if (clubId) {
    const { data: club } = await db
      .from('cc_clubs')
      .select('name')
      .eq('id', clubId)
      .maybeSingle();
    clubName = (club as { name: string } | null)?.name ?? null;
  }

  const clubLinked = (await resolveCaptainRate(clubId)) === 'club_linked';
  const price = clubLinked ? CAPTAIN_CLUB_PRICE_USD : CAPTAIN_SOLO_PRICE_USD;
  const canBuy = captainCheckoutConfigured();

  return (
    <div className="p-6 md:p-10 max-w-2xl">
      <h1 className="text-3xl font-display text-white">CaptainMode</h1>
      <p className="text-white/50 mt-1">
        Availability polls, one-click lineups, and instant subs — for league captains.
      </p>

      {access.active ? (
        <div className="mt-8 rounded-2xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.07] p-6">
          <div className="text-[#D3FB52] font-semibold text-lg">
            {access.paidPlansComingSoon
              ? 'Paid plans are coming soon — you keep access in the meantime'
              : access.onTrial
                ? `Your trial is running — ${access.trialDaysLeft} ${
                    access.trialDaysLeft === 1 ? 'day' : 'days'
                  } left`
                : 'Your subscription is active'}
          </div>
          {!access.paidPlansComingSoon && !access.onTrial && (
            <p className="text-white/60 mt-1 text-sm">
              {access.rateType === 'club_linked'
                ? `Club plan — $${CAPTAIN_CLUB_PRICE_USD}/month`
                : `Standalone — $${CAPTAIN_SOLO_PRICE_USD}/month`}
              {access.currentPeriodEnd
                ? ` · renews ${new Intl.DateTimeFormat('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  }).format(new Date(access.currentPeriodEnd))}`
                : ''}
            </p>
          )}
          <Link
            href="/captain"
            className="inline-block mt-4 px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold"
          >
            Go to my teams
          </Link>
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-white/[0.08] bg-[#002838] p-6">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-display text-white">${price}</span>
            <span className="text-white/50">/month</span>
          </div>

          <p className="text-white/60 mt-2 text-sm">
            {clubLinked ? (
              <>
                <span className="text-[#D3FB52]">{clubName || 'Your club'}</span> is on ClubMode,
                so you get the club rate.
              </>
            ) : clubName ? (
              <>
                <span className="text-white/80">{clubName}</span> isn&rsquo;t on ClubMode Pro. If
                they upgrade, your rate drops to ${CAPTAIN_CLUB_PRICE_USD}/month.
              </>
            ) : (
              <>
                Standalone rate. Captains at clubs on ClubMode pay ${CAPTAIN_CLUB_PRICE_USD}/month.
              </>
            )}
          </p>

          <ul className="mt-5 space-y-2 text-sm text-white/70">
            {[
              'One-tap availability polls — no logins for your players',
              'One-click lineups from availability, ratings, and partner preferences',
              'Automatic lineup email 7 days out and reminders the day before',
              'Instant sub requests — first to claim gets the spot',
              'Playoff eligibility and play-time tracking',
              `Up to ${MAX_TEAMS_PER_CAPTAIN} teams, co-captains free`,
            ].map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-[#D3FB52]">✓</span>
                {f}
              </li>
            ))}
          </ul>

          {canBuy ? (
            <SubscribeButton
              priceKey={clubLinked ? 'captain_club' : 'captain_solo'}
              clubId={clubId}
              price={price}
            />
          ) : (
            <div className="mt-6">
              <p className="text-sm text-white/70">
                Paid plans are coming soon. Start the free {TRIAL_DAYS}-day trial now — no card —
                and you keep access in the meantime.
              </p>
              <Link
                href="/captain/start"
                className="inline-block mt-4 px-5 py-3 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold"
              >
                Start free trial
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
