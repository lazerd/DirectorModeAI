import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getCaptainAccess, TRIAL_DAYS } from '@/lib/captain/access';
import StartTrialButton from '@/components/captain/StartTrialButton';

export const dynamic = 'force-dynamic';

/**
 * Where the season-opener email lands.
 *
 * The reader is a captain at another club who has never heard of us, opened an
 * email about a tennis match, and clicked a line at the bottom of it. So this
 * page has one job and one button, and it says what the thing costs before
 * asking for anything.
 *
 * It is deliberately OUTSIDE /captain/(app): that layout gates on a
 * subscription and would bounce this exact visitor to the paywall, which is the
 * one thing the link must never do.
 */
export default async function StartTrial({
  searchParams,
}: {
  searchParams: { ref?: string; from?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const source = (searchParams.ref || searchParams.from || '').slice(0, 120);

  /*
   * A signed-out visitor sees the page, NOT the login form.
   *
   * This link is clicked from a cold email by a captain at another club who has
   * never heard of ClubMode. Bouncing them to /login before they have read a
   * word asks them to create an account for something they cannot yet see —
   * which is where almost all of them would stop. They sign in when they press
   * the button, and land back here.
   */
  const access = user
    ? await getCaptainAccess(user.id)
    : { active: false, onTrial: false, trialExpired: false, trialDaysLeft: 0 };

  return (
    <div className="min-h-screen bg-[#001820] px-6 py-14">
      <div className="mx-auto max-w-xl">
        <p className="text-[#D3FB52] text-xs font-semibold uppercase tracking-[0.18em]">
          CaptainMode
        </p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-display text-white leading-tight">
          Captaining a team, without the group text
        </h1>

        {access.active ? (
          <div className="mt-8 rounded-2xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.07] p-6">
            <div className="text-[#D3FB52] font-semibold text-lg">
              {access.onTrial
                ? `Your trial is running — ${access.trialDaysLeft} ${
                    access.trialDaysLeft === 1 ? 'day' : 'days'
                  } left`
                : "You're already set up"}
            </div>
            <Link
              href="/captain"
              className="inline-block mt-4 px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold"
            >
              Go to my teams
            </Link>
          </div>
        ) : access.trialExpired ? (
          <div className="mt-8 rounded-2xl border border-white/[0.08] bg-[#002838] p-6">
            <div className="text-white font-semibold text-lg">Your free trial has ended</div>
            <p className="text-white/55 mt-1 text-sm">
              Your teams, rosters and schedules are all still here.
            </p>
            <Link
              href="/captain/subscribe"
              className="inline-block mt-4 px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold"
            >
              See the plans
            </Link>
          </div>
        ) : (
          <>
            <ul className="mt-6 space-y-2.5 text-white/70 text-[15px]">
              {[
                'Ask the whole team who’s available for the season in one email.',
                'Build a lineup that’s fair, legal, and explains itself.',
                'Send it out, and let players confirm or pull out with one tap.',
                'Keep every opposing captain’s number in one place.',
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span className="text-[#D3FB52] mt-0.5">→</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 rounded-2xl border border-white/[0.08] bg-[#002838] p-6">
              <StartTrialButton source={source} signedIn={!!user} />
              {/* Said before the click, not after. A captain who finds out the
                  price on the far side of a signup does not come back. */}
              <p className="text-white/45 text-[13px] mt-3">
                {TRIAL_DAYS} days free, no card. After that it&rsquo;s $20 a month, or $10 if your
                club is on ClubMode. Cancel any time.
              </p>
            </div>
          </>
        )}

        <p className="mt-10 text-white/25 text-[12px]">
          CaptainMode is part of ClubMode ·{' '}
          <Link href="/privacy" className="hover:text-white/50 underline">
            Privacy
          </Link>{' '}
          ·{' '}
          <Link href="/terms" className="hover:text-white/50 underline">
            Terms
          </Link>
        </p>
      </div>
    </div>
  );
}
