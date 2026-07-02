'use client';

import Link from 'next/link';
import {
  Sparkles,
  ArrowRight,
  MessageSquare,
  ShieldCheck,
  Check,
} from 'lucide-react';

const FREE_FEATURES = [
  'Unlimited events, round robins, leagues & JTT',
  'Live event screen — court assignments, scores & standings on any phone',
  'Lesson booking & Coach Mode development tracking',
  'CourtSheet — view today’s court grid',
  'PlayerVault roster CRM (up to 25 players)',
  'StringingMode pro-shop job tracking',
  '25 emails / month',
  '1 free DJ Console event',
];

const PRO_FEATURES = [
  'Everything in Free, uncapped',
  'CourtSheet editing + AI command bar',
  'AI lesson summaries after every lesson',
  'DJ Console on every event',
  'AI string recommendations',
  '200 texts / month, then 5¢ each (you set the cap)',
  '1,000 emails / month',
  'Unlimited PlayerVault + CSV import',
  'Unlimited event photos & custom club branding',
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/[0.06] sticky top-0 z-30 bg-[#001820]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-yellow-300/20 flex items-center justify-center">
              <Sparkles size={16} className="text-yellow-300" />
            </div>
            <span className="font-display text-base">ClubMode</span>
          </Link>
          <Link href="/login" className="text-sm text-white/70 hover:text-white">Sign in</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-16 pb-8 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-yellow-300/90 bg-yellow-300/10 border border-yellow-300/20 rounded-full px-3 py-1">
          <Sparkles size={13} /> Founder pricing — locked for life
        </div>
        <h1 className="mt-5 font-display text-4xl md:text-5xl tracking-tight">
          Free to run your club.{' '}
          <span className="text-yellow-300">$29/mo to run it like a pro.</span>
        </h1>
        <p className="mt-4 text-white/60 max-w-xl mx-auto">
          Every tool to run your racquet-sports club in one login. Start free, invite your
          members, and upgrade when you want the premium, AI-powered features. No card to start.
        </p>
      </section>

      {/* Plans */}
      <section className="max-w-4xl mx-auto px-6 pb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Free */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 flex flex-col">
            <div className="font-display text-xl">Free</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-display text-4xl">$0</span>
              <span className="text-white/40 text-sm">/ month</span>
            </div>
            <p className="mt-2 text-white/50 text-sm">Run real events and give every member a login — forever.</p>
            <ul className="mt-5 space-y-2.5 flex-1">
              {FREE_FEATURES.map((f) => (
                <Bullet key={f}>{f}</Bullet>
              ))}
            </ul>
            <Link
              href="/register"
              className="mt-6 px-5 py-3 rounded-xl font-medium bg-white/10 hover:bg-white/15 text-white flex items-center justify-center gap-2"
            >
              Start free <ArrowRight size={16} />
            </Link>
          </div>

          {/* Pro */}
          <div className="rounded-2xl border border-yellow-300/40 bg-yellow-300/[0.05] p-7 flex flex-col relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-semibold uppercase tracking-wide bg-yellow-300 text-[#001820] rounded-full px-3 py-1">
              Founder pricing
            </div>
            <div className="font-display text-xl">ClubMode Pro</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-display text-4xl">$29</span>
              <span className="text-white/40 text-sm">/ month</span>
            </div>
            <p className="mt-2 text-white/50 text-sm">
              or $290/year (2 months free). Locked for life for founding clubs.
            </p>
            <ul className="mt-5 space-y-2.5 flex-1">
              {PRO_FEATURES.map((f) => (
                <Bullet key={f} gold>{f}</Bullet>
              ))}
            </ul>
            <Link
              href="/register"
              className="mt-6 px-5 py-3 rounded-xl font-medium bg-yellow-300 text-[#001820] hover:bg-yellow-200 flex items-center justify-center gap-2"
            >
              Start 14-day Pro trial <ArrowRight size={16} />
            </Link>
            <p className="mt-2 text-center text-white/40 text-xs">No card required. Cancel anytime.</p>
          </div>
        </div>
      </section>

      {/* Texting meter / spend cap */}
      <section className="max-w-4xl mx-auto px-6 py-8">
        <div className="rounded-2xl border border-white/10 bg-[#002838] p-7">
          <div className="flex items-center gap-2 text-yellow-300">
            <MessageSquare size={18} />
            <span className="font-display text-xl">The only meter is texting — and you set the cap</span>
          </div>
          <p className="mt-3 text-white/60 text-sm max-w-2xl">
            Pro includes 200 text messages a month. Past that it&apos;s 5&cent; per text, and you pick a
            monthly ceiling you&apos;re comfortable with. We warn you as you approach it and never charge a
            penny more without your say-so. Everything else — AI actions, the live event screen, email — is
            included. No surprise bills, ever.
          </p>
          <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Bullet>A live meter of texts used this month</Bullet>
            <Bullet>A heads-up at 80% of your cap</Bullet>
            <Bullet>Raise or lower your ceiling any time</Bullet>
            <Bullet>Unlimited AI actions included in Pro</Bullet>
          </ul>
        </div>
      </section>

      {/* Entry fees footnote */}
      <section className="max-w-3xl mx-auto px-6 pb-20 text-center">
        <div className="inline-flex items-start gap-2 text-white/50 text-sm">
          <ShieldCheck size={16} className="mt-0.5 flex-shrink-0 text-emerald-400" />
          <p>
            Collecting entry fees online? Players pay by card and the money goes straight to your account —
            ClubMode keeps a 3% platform fee (plus standard card processing), paid out of player fees, never
            from your subscription. We never hold your funds.
          </p>
        </div>
      </section>
    </div>
  );
}

function Bullet({ children, gold }: { children: React.ReactNode; gold?: boolean }) {
  return (
    <li className="flex items-start gap-2 text-sm text-white/80">
      <Check size={16} className={`mt-0.5 flex-shrink-0 ${gold ? 'text-yellow-300' : 'text-emerald-400'}`} />
      <span>{children}</span>
    </li>
  );
}
