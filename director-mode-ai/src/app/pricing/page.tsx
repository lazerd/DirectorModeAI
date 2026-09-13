'use client';

import Link from 'next/link';
import {
  Sparkles,
  ArrowRight,
  MessageSquare,
  Check,
  Globe,
} from 'lucide-react';
import {
  PRO_PRICE_USD, FOUNDING_PRICE_USD, FOUNDING_LOCK_MONTHS, RATE_CHANGE_NOTICE_DAYS,
  CAPTAIN_CLUB_PRICE_USD, CAPTAIN_SOLO_PRICE_USD, CAPTAIN_MAX_TEAMS,
  SITE_SERVICE_PRICE_USD, SITE_SERVICE_LIST_USD, SITE_SERVICE_MIN_MONTHS,
} from '@/config/pricing';
import { PRODUCT_COUNT } from '@/config/nav';

/*
 * One founding card, not a Free/Pro pair. Payments can't be taken yet
 * (FOUNDING_MODE), so the old layout advertised a "14-day Pro trial" that no
 * code grants, email caps the app never enforces, a text-spend cap that was
 * never built, and card entry fees through Square that only work for one club.
 * Every line below is something a new club gets today.
 */
const FOUNDING_FEATURES = [
  `All ${PRODUCT_COUNT} ClubMode tools — nothing held back`,
  'Unlimited events, round robins, leagues & JTT',
  'Live event screen — court assignments, scores & standings on any phone',
  'CourtSheet, including the AI command bar',
  'LessonMode booking and CoachMode AI lesson recaps',
  'StringingMode job tracking and AI string recommendations',
  'DJ Console on every event',
  'PlayerVault roster CRM with CSV import',
  'Staff logins for your whole team',
  'Email included',
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
          <Sparkles size={13} /> Founding clubs — free during beta
        </div>
        <h1 className="mt-5 font-display text-4xl md:text-5xl tracking-tight">
          Every ClubMode tool.{' '}
          <span className="text-yellow-300">Free while you help us build it.</span>
        </h1>
        <p className="mt-4 text-white/60 max-w-xl mx-auto">
          All {PRODUCT_COUNT} tools to run your racquet-sports club, in one login, for your whole
          staff. No card to start.
        </p>
      </section>

      {/* The one plan */}
      <section className="max-w-xl mx-auto px-6 pb-4">
        <div className="rounded-2xl border border-yellow-300/40 bg-yellow-300/[0.05] p-7 flex flex-col relative">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-semibold uppercase tracking-wide bg-yellow-300 text-[#001820] rounded-full px-3 py-1">
            Founding club
          </div>
          <div className="font-display text-xl">Founding Club — free during beta.</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-display text-4xl">$0</span>
            <span className="text-white/40 text-sm">/ month during beta</span>
          </div>
          <p className="mt-3 text-white/60 text-sm leading-relaxed">
            Every ClubMode tool, unlocked for your whole staff. No card, no trial clock. When paid
            plans launch, founding clubs get{' '}
            <strong className="text-white">
              ${FOUNDING_PRICE_USD}/month locked for {FOUNDING_LOCK_MONTHS} months
            </strong>{' '}
            (list ${PRO_PRICE_USD}) — and {RATE_CHANGE_NOTICE_DAYS} days&apos; notice before anything
            is ever charged. Nothing converts automatically.
          </p>
          <ul className="mt-5 space-y-2.5 flex-1">
            {FOUNDING_FEATURES.map((f) => (
              <Bullet key={f} gold>{f}</Bullet>
            ))}
          </ul>
          <Link
            href="/register"
            className="mt-6 px-5 py-3 rounded-xl font-medium bg-yellow-300 text-[#001820] hover:bg-yellow-200 flex items-center justify-center gap-2"
          >
            Start free <ArrowRight size={16} />
          </Link>
          <p className="mt-2 text-center text-white/40 text-xs">No card required.</p>
        </div>
      </section>

      {/* Texting — honest about where it is. Email is included, full stop. */}
      <section className="max-w-4xl mx-auto px-6 pt-8">
        <div className="rounded-2xl border border-white/10 bg-[#002838] p-7">
          <div className="flex items-center gap-2 text-yellow-300">
            <MessageSquare size={18} />
            <span className="font-display text-xl">Texting is rolling out.</span>
          </div>
          <p className="mt-3 text-white/60 text-sm max-w-2xl">
            Carrier registration is in progress; email, events, CourtSheet and AI work today.
            Email is included — it never meters.
          </p>
        </div>
      </section>

      {/* Custom club site — the one SERVICE tier.
          
          No buy button, on purpose. Everything else on this page is software
          that costs nothing to hand to one more club; this includes someone's
          time, so it is agreed in a conversation. There is no LemonSqueezy
          variant behind it, and a price with no product behind it is exactly
          how the page and the invoice end up disagreeing.
          
          The two prices are shown separately rather than as one $75, so a club
          can see the founding discount they would lose — and so the add-on
          reads as cancellable. A club that realises it can click its own skip
          dates should drop to Pro and stay, not leave. */}
      <section className="max-w-4xl mx-auto px-6 pt-8">
        <div className="rounded-2xl border border-yellow-300/25 bg-yellow-300/[0.04] p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-yellow-300">
                <Globe size={18} />
                <h2 className="font-display text-xl">Your own club website, kept up to date</h2>
              </div>
              <p className="mt-2 text-white/60 text-sm max-w-xl">
                We build your club its own public site — your colours, your logo, your programs,
                your court pricing — and keep it current. You can still change anything yourself,
                any day. Most clubs stop asking us by the second season.
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-3xl whitespace-nowrap">
                ${SITE_SERVICE_PRICE_USD}
                <span className="text-sm font-normal text-white/40"> / month</span>
              </p>
              <p className="mt-0.5 text-xs text-white/35">list ${SITE_SERVICE_LIST_USD}</p>
            </div>
          </div>

          {/* The split, so the discount is visible rather than absorbed. */}
          <div className="mt-5 rounded-xl border border-white/10 bg-[#001820] p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-white/70">ClubMode Pro</span>
              <span className="text-white/70">
                ${FOUNDING_PRICE_USD}/mo{' '}
                <span className="text-white/35">founding — list ${PRO_PRICE_USD}</span>
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="text-white/70">Custom site + updates</span>
              <span className="text-white/70">
                ${SITE_SERVICE_PRICE_USD - FOUNDING_PRICE_USD}/mo
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-white/10 pt-2.5 font-semibold">
              <span>Together</span>
              <span>${SITE_SERVICE_PRICE_USD}/mo</span>
            </div>
          </div>

          <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
            <Bullet gold>Everything in ClubMode Pro</Bullet>
            <Bullet gold>Your branding on every page members see</Bullet>
            <Bullet gold>We set up your classes, prices and skip dates</Bullet>
            <Bullet gold>Send changes any time — we batch them weekly</Bullet>
            <Bullet gold>Online class registration and court booking</Bullet>
            <Bullet gold>No setup fee &middot; {SITE_SERVICE_MIN_MONTHS}-month minimum</Bullet>
          </ul>

          <p className="mt-5 text-white/45 text-xs">
            Sold by conversation, not by card — it includes our time, so we talk first.
          </p>
          <Link
            href="mailto:hello@clubmode.ai?subject=Custom%20club%20website"
            className="mt-2 inline-flex items-center gap-2 rounded-xl border border-yellow-300/40 px-5 py-2.5 text-sm font-semibold text-yellow-300 hover:bg-yellow-300/10"
          >
            Talk to us about a site <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* CaptainMode — a separate subscription, bought by the captain, not the
          club. Prices and the team limit come from config/pricing, the same
          constants the subscribe page and the teams route enforce. */}
      <section className="max-w-4xl mx-auto px-6 pt-8 pb-20">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">CaptainMode — for your team captains</h2>
              <p className="mt-1 text-white/55 text-sm max-w-xl">
                A separate tool for the volunteer running a league team: availability polls,
                lineups, confirmations and last-minute subs. Captains pay for it themselves —
                no club approval, no line on your budget.
              </p>
            </div>
            <Link
              href="/captainmode"
              className="text-sm text-yellow-300 hover:text-yellow-200 whitespace-nowrap"
            >
              See CaptainMode →
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-yellow-300/30 bg-yellow-300/[0.05] p-5">
              <p className="text-xs uppercase tracking-widest text-yellow-300 font-semibold">
                Your club is on ClubMode
              </p>
              <p className="mt-2 font-display text-3xl">
                ${CAPTAIN_CLUB_PRICE_USD}
                <span className="text-sm font-normal text-white/40"> / month</span>
              </p>
              <p className="mt-2 text-sm text-white/55">
                Per captain, up to {CAPTAIN_MAX_TEAMS} teams. Co-captains free.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 p-5">
              <p className="text-xs uppercase tracking-widest text-white/40 font-semibold">
                Your club isn&apos;t
              </p>
              <p className="mt-2 font-display text-3xl">
                ${CAPTAIN_SOLO_PRICE_USD}
                <span className="text-sm font-normal text-white/40"> / month</span>
              </p>
              <p className="mt-2 text-sm text-white/55">Identical product. Nothing held back.</p>
            </div>
          </div>
        </div>
      </section>

      {/* This page had no footer at all — so no Terms and no Privacy link on the
          one page a payment processor and a club's finance lead both read. */}
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

function Bullet({ children, gold }: { children: React.ReactNode; gold?: boolean }) {
  return (
    <li className="flex items-start gap-2 text-sm text-white/80">
      <Check size={16} className={`mt-0.5 flex-shrink-0 ${gold ? 'text-yellow-300' : 'text-emerald-400'}`} />
      <span>{children}</span>
    </li>
  );
}
