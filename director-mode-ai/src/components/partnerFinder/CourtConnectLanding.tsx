import Link from 'next/link';
import { ArrowRight, BellRing, Mail, UserPlus, Users } from 'lucide-react';
import { EMAIL_MONTHLY_CAP_CENTS, EMAIL_PRICE_CENTS, FREE_EMAILS_PER_CLUB } from '@/config/pricing';

/**
 * /courtconnect for anyone signed out: the CourtConnect pitch. Signed-in
 * players and directors never see it; the route sends them to their board.
 * This is also what a shared /courtconnect link previews as.
 *
 * Keep it honest: no testimonials, logos, usage numbers or performance claims.
 */

const START_HREF = '/register?next=/courtconnect';
const SIGN_IN_HREF = '/login?redirect=/courtconnect';

const STEPS = [
  {
    icon: Users,
    title: 'Post your game',
    body: 'Day, time, court, level, and how many players you need. Takes a minute.',
  },
  {
    icon: Mail,
    title: 'Members at your level get the invite',
    body: 'CourtConnect emails the players at your club who fit the game. Nobody gets spammed with games they would never play.',
  },
  {
    icon: BellRing,
    title: 'They tap "I’m in"',
    body: 'First to answer gets the spot. When the game fills, everyone knows, and late answers go on a waitlist.',
  },
];

const DETAILS = [
  'A waitlist that moves up on its own when someone drops',
  'Remind the people who haven’t answered, in one tap',
  'Invite outside friends with their own link',
  'Answer for your household from one account',
  'The organizer can edit the game or take someone off it',
  'Members never pay and never need an app',
];

export default function CourtConnectLanding() {
  const cap = EMAIL_MONTHLY_CAP_CENTS / 100;
  return (
    <div className="min-h-screen bg-[#001820] text-white antialiased">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link href="/" className="text-lg font-bold tracking-tight">
          ClubMode <span className="text-[#D3FB52]">AI</span>
        </Link>
        <Link href={SIGN_IN_HREF} className="text-sm font-semibold text-white/70 hover:text-white">
          Sign in
        </Link>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-5 pb-16 pt-10 md:pt-20">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#D3FB52]">CourtConnect by ClubMode</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-bold leading-[1.02] tracking-tight md:text-7xl">
            Need a fourth?
            <span className="block text-white/50">Find one in minutes.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/70">
            Post a game and the members at your level get the invite. They tap &ldquo;I&rsquo;m in,&rdquo; and you have
            your game. No group texts, no reply-all, no chasing.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href={START_HREF}
              className="inline-flex items-center gap-2 rounded-xl bg-[#D3FB52] px-6 py-3 text-base font-semibold text-[#002838] hover:brightness-95"
            >
              Start CourtConnect at your club <ArrowRight className="h-5 w-5" />
            </Link>
            <Link href={SIGN_IN_HREF} className="text-base font-semibold text-white/70 hover:text-white">
              My club already uses it
            </Link>
          </div>
        </section>

        <section className="border-t border-white/10 bg-[#002838]">
          <div className="mx-auto grid max-w-5xl gap-8 px-5 py-14 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="min-w-0">
                <Icon className="h-7 w-7 text-[#D3FB52]" />
                <h2 className="mt-4 text-xl font-semibold">{title}</h2>
                <p className="mt-2 text-white/65">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-10 px-5 py-14 md:grid-cols-2">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold">Built by a working Director of Tennis</h2>
            <p className="mt-3 text-white/65">
              CourtConnect runs the partner finding at Sleepy Hollow Swim &amp; Tennis Club, where it started. It does
              the parts that eat a director&rsquo;s day:
            </p>
            <ul className="mt-5 space-y-3">
              {DETAILS.map((d) => (
                <li key={d} className="flex gap-3 text-white/80">
                  <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-[#D3FB52]" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0 rounded-2xl border border-[#D3FB52]/40 bg-[#D3FB52]/[0.06] p-7">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#D3FB52]">Pricing</p>
            <p className="mt-3 text-4xl font-bold">
              {FREE_EMAILS_PER_CLUB.toLocaleString()} emails free
            </p>
            <p className="mt-3 text-white/70">
              Every club starts with {FREE_EMAILS_PER_CLUB.toLocaleString()} free emails, no card. After that it&rsquo;s{' '}
              {EMAIL_PRICE_CENTS}&cent; an email, and never more than <strong className="text-white">${cap} a month</strong>{' '}
              for the whole club, however many members use it.
            </p>
            <p className="mt-3 text-white/70">
              The director can cover it, or one member can sponsor the club. Members always play free.
            </p>
            <Link
              href={START_HREF}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#D3FB52] px-5 py-3 font-semibold text-[#002838] hover:brightness-95"
            >
              Get started free <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-white/45">
          <span>CourtConnect is part of ClubMode, free tools for racquet clubs.</span>
          <Link href="/" className="hover:text-white">
            See all ClubMode tools
          </Link>
        </div>
      </footer>
    </div>
  );
}
