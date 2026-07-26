import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getCaptainAccess, MAX_TEAMS_PER_CAPTAIN } from '@/lib/captain/access';
import { getPlanContext } from '@/lib/billing';
import SubscribeButton from '@/components/captain/SubscribeButton';

export const dynamic = 'force-dynamic';

/**
 * Subscription state + rate explanation. Checkout itself goes through the
 * existing Stripe routes; this page is where a captain learns which rate
 * applies and why.
 */
export default async function SubscribePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/captain/subscribe');

  const access = await getCaptainAccess(user.id);

  // Is this captain attached to a club that has Pro? That decides the price.
  const db = await createServiceClient();
  const { data: membership } = await db
    .from('cc_club_members')
    .select('club_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  const clubId = access.clubId || (membership as { club_id: string } | null)?.club_id || null;
  let clubName: string | null = null;
  let clubIsPro = false;

  if (clubId) {
    const { data: club } = await db
      .from('cc_clubs')
      .select('name, owner_id')
      .eq('id', clubId)
      .maybeSingle();
    const c = club as { name: string; owner_id: string } | null;
    if (c) {
      clubName = c.name;
      const plan = await getPlanContext(c.owner_id);
      clubIsPro = plan.effectiveTier === 'pro';
    }
  }

  const price = clubIsPro ? 10 : 20;

  return (
    <div className="p-6 md:p-10 max-w-2xl">
      <h1 className="text-3xl font-display text-white">CaptainMode</h1>
      <p className="text-white/50 mt-1">
        Availability polls, one-click lineups, and instant subs — for league captains.
      </p>

      {access.active ? (
        <div className="mt-8 rounded-2xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.07] p-6">
          <div className="text-[#D3FB52] font-semibold text-lg">Your subscription is active</div>
          <p className="text-white/60 mt-1 text-sm">
            {access.rateType === 'club_linked'
              ? 'Club plan — $10/month'
              : 'Standalone — $20/month'}
            {access.currentPeriodEnd
              ? ` · renews ${new Intl.DateTimeFormat('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                }).format(new Date(access.currentPeriodEnd))}`
              : ''}
          </p>
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
            {clubIsPro ? (
              <>
                <span className="text-[#D3FB52]">{clubName}</span> is on ClubMode Pro, so you get
                the club rate.
              </>
            ) : clubName ? (
              <>
                <span className="text-white/80">{clubName}</span> isn&rsquo;t on ClubMode Pro. If
                they upgrade, your rate drops to $10/month.
              </>
            ) : (
              <>Standalone rate. Captains at ClubMode Pro clubs pay $10/month.</>
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

          <SubscribeButton
            priceKey={clubIsPro ? 'captain_club' : 'captain_solo'}
            clubId={clubId}
            price={price}
          />
        </div>
      )}
    </div>
  );
}
