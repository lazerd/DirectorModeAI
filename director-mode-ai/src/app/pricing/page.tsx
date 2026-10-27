'use client';

import Link from 'next/link';
import {
  Sparkles,
  ArrowRight,
  Check,
  Globe,
  Mail,
  MessageSquare,
  LayoutGrid,
} from 'lucide-react';
import {
  EMAIL_MONTHLY_CAP_CENTS,
  EMAIL_PRICE_CENTS,
  TEXT_PRICE_CENTS,
  AI_MARKUP,
  AI_NOTICE_STEP_USD,
  AI_MONTHLY_CAP_USD,
  RATE_CHANGE_NOTICE_DAYS,
  SITE_SERVICE_PRICE_USD,
  SITE_SERVICE_MIN_MONTHS,
} from '@/config/pricing';
import { PRODUCT_COUNT } from '@/config/nav';

/*
 * ClubMode is free (Darrin, 2026-10-21). No plans, tiers, trials or day passes.
 * A club pays only for what it sends, billed monthly on one metered charge.
 * Every number on this page comes from config/pricing so the page and the
 * invoice can't drift apart.
 */

const AI_MARKUP_PCT = Math.round((AI_MARKUP - 1) * 100);

const PLATFORM_FEATURES = [
  `All ${PRODUCT_COUNT} ClubMode tools — nothing held back`,
  'Unlimited events, round robins, leagues & JTT',
  'CourtSheet, LessonMode, StringingMode, DJ Console',
  'PlayerVault roster CRM with CSV import',
  'Unlimited staff logins',
  'Members are always free',
  'CaptainMode free for every team captain',
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Why usage pricing instead of a plan?',
    a: (
      <>
        Because a club&apos;s busy season and quiet season shouldn&apos;t cost the same. You get
        every tool for free, and the only thing that costs us money to deliver — sending emails,
        texts and AI requests — is what you pay for. A quiet month costs almost nothing.
      </>
    ),
  },
  {
    q: 'What counts as an email?',
    a: (
      <>
        Every email your club sends through ClubMode, including automatic ones like
        confirmations, reminders and score updates. One email to one person is one email. Sign-in
        and password-reset emails are not billed.
      </>
    ),
  },
  {
    q: 'Do I need a card to start?',
    a: (
      <>
        No. Set up your club, import members and build events without one. The club owner adds a
        card the first time you send. Emails you send before that are saved and go out as soon as
        the card is on file; texts need the card first.
      </>
    ),
  },
  {
    q: 'How does Ask Claude billing work? Is there a cap?',
    a: (
      <>
        Ask Claude is billed at the AI model&apos;s cost plus {AI_MARKUP_PCT}%. A live dollar meter
        sits on every answer, so you always see what a request cost and what you&apos;ve spent this
        month. You get a notice every ${AI_NOTICE_STEP_USD}, and Ask Claude stops for the month at $
        {AI_MONTHLY_CAP_USD} so a runaway month can&apos;t surprise you.
      </>
    ),
  },
  {
    q: 'Is CaptainMode free too?',
    a: (
      <>
        Yes. CaptainMode is free for every captain. Their emails and texts are metered at the same
        rates, to their club&apos;s card (or their own if they don&apos;t have a club on
        ClubMode).
      </>
    ),
  },
  {
    q: 'Can the prices change?',
    a: <>Only with {RATE_CHANGE_NOTICE_DAYS} days&apos; notice before a new rate applies.</>,
  },
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
          <Sparkles size={13} /> No plans. No tiers. No trials.
        </div>
        <h1 className="mt-5 font-display text-4xl md:text-5xl tracking-tight">
          Free.{' '}
          <span className="text-yellow-300">Pay only for what you send.</span>
        </h1>
        <p className="mt-4 text-white/60 max-w-xl mx-auto">
          All {PRODUCT_COUNT} tools to run your racquet-sports club, for your whole staff, at no
          cost. You pay a penny per email (never more than {`$${EMAIL_MONTHLY_CAP_CENTS / 100}`} a month) and a few cents per text, billed monthly once you owe $20.
        </p>
      </section>

      {/* Price table */}
      <section className="max-w-xl mx-auto px-6 pb-4">
        <div className="rounded-2xl border border-yellow-300/40 bg-yellow-300/[0.05] p-7 flex flex-col">
          <PriceRow
            icon={<LayoutGrid size={18} className="text-yellow-300" />}
            label="Platform"
            note="All features, unlimited staff, members always free"
            price="$0"
          />
          <PriceRow
            icon={<Mail size={18} className="text-blue-400" />}
            label="Email"
            note={`Every email your club sends · capped at $${EMAIL_MONTHLY_CAP_CENTS / 100}/mo`}
            price={`${EMAIL_PRICE_CENTS}¢`}
            unit="each"
          />
          <PriceRow
            icon={<MessageSquare size={18} className="text-emerald-400" />}
            label="Text"
            note="Every text your club sends"
            price={`${TEXT_PRICE_CENTS}¢`}
            unit="each"
          />
          <PriceRow
            icon={<Sparkles size={18} className="text-pink-400" />}
            label="Ask Claude"
            note={`Model cost + ${AI_MARKUP_PCT}%, live meter, $${AI_MONTHLY_CAP_USD}/mo cap`}
            price="Metered"
            last
          />

          <ul className="mt-6 space-y-2.5">
            {PLATFORM_FEATURES.map((f) => (
              <Bullet key={f} gold>{f}</Bullet>
            ))}
          </ul>

          <Link
            href="/register"
            className="mt-6 px-5 py-3 rounded-xl font-medium bg-yellow-300 text-[#001820] hover:bg-yellow-200 flex items-center justify-center gap-2"
          >
            Start free <ArrowRight size={16} />
          </Link>
          <p className="mt-2 text-center text-white/50 text-xs">
            No card to start. Add one the first time you send.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 pt-12">
        <h2 className="font-display text-2xl mb-4">Questions</h2>
        <div className="space-y-3">
          {FAQ.map((f) => (
            <div key={f.q} className="rounded-2xl border border-white/10 bg-[#002838] p-5">
              <div className="font-medium text-white">{f.q}</div>
              <p className="mt-2 text-sm text-white/60 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Custom club site — sold by conversation only. No buy button, on
          purpose: it includes someone's time, and there is no LemonSqueezy
          product behind it. */}
      <section className="max-w-3xl mx-auto px-6 pt-8 pb-20">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3 max-w-lg">
            <Globe size={18} className="text-yellow-300 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-white/60">
              <span className="text-white font-medium">Want us to build and run your club website?</span>{' '}
              ${SITE_SERVICE_PRICE_USD}/month, {SITE_SERVICE_MIN_MONTHS}-month minimum. It includes
              our time, so we talk first.
            </p>
          </div>
          <Link
            href="mailto:hello@clubmode.ai?subject=Custom%20club%20website"
            className="inline-flex items-center gap-2 rounded-xl border border-yellow-300/40 px-4 py-2 text-sm font-semibold text-yellow-300 hover:bg-yellow-300/10 whitespace-nowrap"
          >
            Talk to us <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] px-6 py-10">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 text-[13px] text-white/30 sm:flex-row">
          <p>&copy; {new Date().getFullYear()} ClubMode AI</p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/" className="hover:text-white/60 transition-colors">Home</Link>
            <Link href="/terms" className="hover:text-white/60 transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-white/60 transition-colors">Privacy</Link>
            <Link href="/login" className="hover:text-white/60 transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PriceRow({
  icon,
  label,
  note,
  price,
  unit,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  price: string;
  unit?: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-3.5 ${last ? '' : 'border-b border-white/10'}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 flex-shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="font-medium text-white">{label}</div>
          <div className="text-xs text-white/50">{note}</div>
        </div>
      </div>
      <div className="text-right whitespace-nowrap">
        <span className="font-display text-2xl">{price}</span>
        {unit && <span className="text-white/40 text-xs"> {unit}</span>}
      </div>
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
