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
  'CourtSheet — view and edit today’s court grid',
  'Lesson booking & Coach Mode development tracking',
  'StringingMode pro-shop job tracking',
  'PlayerVault roster CRM — up to 500 players',
  '500 emails / month',
];

const PRO_FEATURES = [
  'Everything in Free, uncapped',
  '300 texts / month, then 2¢ each (you set the cap)',
  '5,000 emails / month',
  'AI command bar on CourtSheet',
  'AI lesson summaries after every lesson',
  'AI string recommendations',
  'DJ Console on every event',
  'Staff logins for your whole team',
  'Custom club branding & unlimited event photos',
  'Unlimited PlayerVault + CSV import',
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
          <Sparkles size={13} /> Founding pricing — first 25 clubs
        </div>
        <h1 className="mt-5 font-display text-4xl md:text-5xl tracking-tight">
          Free to run your club.{' '}
          <span className="text-yellow-300">$49/mo when you want to reach everyone.</span>
        </h1>
        <p className="mt-4 text-white/60 max-w-xl mx-auto">
          Every tool to run your racquet-sports club in one login. Start free, run your whole
          season, and upgrade when you want texting and AI. No card to start.
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
            <p className="mt-2 text-white/50 text-sm">Run your entire season. Forever.</p>
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
            <p className="mt-2 text-center text-white/40 text-xs">No card required.</p>
          </div>

          {/* Pro */}
          <div className="rounded-2xl border border-yellow-300/40 bg-yellow-300/[0.05] p-7 flex flex-col relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-semibold uppercase tracking-wide bg-yellow-300 text-[#001820] rounded-full px-3 py-1">
              Founding pricing
            </div>
            <div className="font-display text-xl">ClubMode Pro</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-display text-4xl">$49</span>
              <span className="text-white/40 text-sm">/ month</span>
            </div>
            <p className="mt-2 text-white/50 text-sm">
              Founding pricing — first 25 clubs. $25/month, locked for 24 months. Included
              texts and emails are covered at that rate; overage rates may change with
              30 days&apos; notice.
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
            Pro includes 300 text messages a month. Past that it&apos;s 2&cent; per text, and you pick a
            monthly ceiling you&apos;re comfortable with. We warn you as you approach it and never charge a
            penny more without your say-so. Everything else — AI actions, the live event screen, email — is
            included. No surprise bills, ever.
          </p>
          <p className="mt-3 text-white/40 text-xs max-w-2xl">
            Overage rates can change with 30 days&apos; notice — carriers change what they charge us,
            and we would rather tell you than quietly eat it or quietly pass it on.
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
            Collecting entry fees online? Players pay by card and the money goes straight to your account.
            ClubMode never takes a cut of your entry fees and never holds your funds — we make our money on
            the subscription, not on your players.
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
