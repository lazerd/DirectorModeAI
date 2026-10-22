import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { EMAIL_PRICE_CENTS, TEXT_PRICE_CENTS } from '@/config/pricing';

export const dynamic = 'force-dynamic';

/**
 * Where the season-opener email lands.
 *
 * The reader is a captain at another club who has never heard of us, opened an
 * email about a tennis match, and clicked a line at the bottom of it. So this
 * page has one job and one button, and it says what the thing costs before
 * asking for anything.
 *
 * It is deliberately OUTSIDE /captain/(app): that layout requires a sign-in,
 * and this visitor should read the page before being asked for anything.
 */
export default async function StartCaptainMode() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
   * A signed-out visitor sees the page, NOT the login form.
   *
   * This link is clicked from a cold email by a captain at another club who has
   * never heard of ClubMode. Bouncing them to /login before they have read a
   * word asks them to create an account for something they cannot yet see —
   * which is where almost all of them would stop. They sign in when they press
   * the button, and land in their teams.
   */
  const startHref = user ? '/captain' : `/login?redirect=${encodeURIComponent('/captain')}`;

  return (
    <div className="min-h-screen bg-[#001820] px-6 py-14">
      <div className="mx-auto max-w-xl">
        <p className="text-[#D3FB52] text-xs font-semibold uppercase tracking-[0.18em]">
          CaptainMode
        </p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-display text-white leading-tight">
          Captaining a team, without the group text
        </h1>

        {user ? (
          <div className="mt-8 rounded-2xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.07] p-6">
            <div className="text-[#D3FB52] font-semibold text-lg">You&rsquo;re all set — it&rsquo;s free</div>
            <Link
              href={startHref}
              className="inline-block mt-4 px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold"
            >
              Go to my teams
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
              <Link
                href={startHref}
                className="inline-block w-full sm:w-auto text-center px-6 py-3 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold hover:brightness-95 transition"
              >
                Start free
              </Link>
              {/* Said before the click, not after. A captain who finds out the
                  price on the far side of a signup does not come back. */}
              <p className="text-white/45 text-[13px] mt-3">
                CaptainMode is free. Your club pays only for the messages you send —{' '}
                {EMAIL_PRICE_CENTS}&cent; an email, {TEXT_PRICE_CENTS}&cent; a text — or you do, on
                your own card, if you&rsquo;re not with a club.
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
