'use client';

/**
 * The public curriculum — the one-stop shop.
 *
 * Every level, every string, every test, with the full detail behind each:
 * what it measures, how the coach runs it, and exactly what it takes to pass.
 * No login, no player data — this is the program itself, shareable with any
 * family, printable from the browser, linkable from the fence QR code.
 */

import { useState } from 'react';
import {
  LEVELS,
  HOUSE_RULES,
  SUMMIT_REWARDS,
  type Level,
  type Stripe,
  type StripeTest,
} from '@/lib/pathway/curriculum';

export default function PathwayCurriculumPage() {
  return (
    <div className="min-h-screen" style={{ background: '#FAF7F2', color: '#1C2321' }}>
      <div className="max-w-2xl mx-auto px-5 pb-16">
        <header className="pt-10 pb-8">
          <p
            className="text-[11px] font-semibold tracking-[0.22em] uppercase text-gray-500"
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            The Sleepy Hollow Junior Pathway
          </p>
          <h1
            className="mt-2 leading-none"
            style={{ fontFamily: '"Barlow Condensed", sans-serif', fontWeight: 900, fontSize: 'clamp(2.6rem, 11vw, 4rem)' }}
          >
            EARN YOUR <span style={{ color: '#b8860b' }}>STRINGS.</span>
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-600 max-w-xl">
            Five ball colors. Five strings per color. Three real tests per string — and every one of
            them is spelled out below: what it measures, how it&apos;s run on Test Day, and exactly what
            it takes to pass. Nothing is hidden. Tap any test.
          </p>
        </header>

        {/* house rules up front — parents ask these first */}
        <div className="mb-10 rounded-2xl bg-white border border-gray-200 p-5">
          <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-gray-400 mb-3">
            How Test Day works
          </p>
          <ul className="space-y-2">
            {HOUSE_RULES.map((r, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-gray-600">
                <span className="text-gray-300 font-bold">{i + 1}.</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-10">
          {LEVELS.filter((l) => !l.invitational).map((lvl) => (
            <LevelSection key={lvl.key} level={lvl} />
          ))}
        </div>

        {/* HP + summit */}
        <div className="mt-10 rounded-2xl p-6 text-white" style={{ background: '#1C2321' }}>
          <p className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: '#a78bfa' }}>
            High Performance — invitation only
          </p>
          <p className="text-sm text-gray-300 mt-2 mb-4">
            Yellow 5 is how a player earns the invite. Clear it and you get:
          </p>
          <ul className="space-y-2">
            {SUMMIT_REWARDS.map((r, i) => (
              <li key={i} className="flex gap-2.5 text-[15px]">
                <span className="text-yellow-400">★</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <footer className="mt-12 pt-6 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-400">
            Sleepy Hollow Junior Tennis · The Junior Pathway, powered by <strong>ClubMode</strong>
          </p>
        </footer>
      </div>
    </div>
  );
}

function LevelSection({ level }: { level: Level }) {
  return (
    <section>
      <div
        className="rounded-2xl px-5 py-4 text-white mb-3"
        style={{ background: `linear-gradient(120deg, ${level.colorDark}, ${level.color})` }}
      >
        <h2 className="text-2xl" style={{ fontFamily: '"Barlow Condensed", sans-serif', fontWeight: 800 }}>
          {level.name.toUpperCase()}
        </h2>
        <p className="text-[13px] opacity-90">
          {level.tagline} · {level.court} · {level.ball}
        </p>
      </div>
      <div className="space-y-2.5">
        {level.stripes.map((st) => (
          <StripeCard key={st.key} stripe={st} level={level} />
        ))}
      </div>
    </section>
  );
}

function StripeCard({ stripe, level }: { stripe: Stripe; level: Level }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
          style={{ background: level.color }}
        >
          {stripe.number}
        </span>
        <span className="flex-1">
          <span className="font-bold text-[15px]" style={{ color: level.colorDark }}>
            {stripe.title}
          </span>
          {stripe.promotes && (
            <span className="ml-2 text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full text-white" style={{ background: level.colorDark }}>
              ★ Promotion
            </span>
          )}
        </span>
        <span className="text-gray-300 text-sm">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {stripe.tests.map((t, i) => (
            <TestCard key={i} test={t} index={i} level={level} />
          ))}
        </div>
      )}
    </div>
  );
}

function TestCard({ test, index, level }: { test: StripeTest; index: number; level: Level }) {
  const [open, setOpen] = useState(false);
  const row = (tag: string, body: string) => (
    <div className="flex gap-2 items-start">
      <span
        className="mt-[2px] flex-shrink-0 text-[9px] font-extrabold tracking-widest uppercase w-11"
        style={{ color: level.colorDark }}
      >
        {tag}
      </span>
      <span className="text-[12.5px] leading-snug text-gray-600">{body}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-gray-200" style={{ background: open ? '#fff' : '#fafaf8' }}>
      <button className="w-full flex gap-2.5 items-start px-3 py-2.5 text-left" onClick={() => setOpen((o) => !o)}>
        <span
          className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold"
          style={{ borderColor: level.color, color: level.colorDark }}
        >
          {index + 1}
        </span>
        <span className="flex-1 text-[13.5px] leading-snug text-gray-800">
          {test.label}
          <span className="ml-1.5 text-[11px] font-semibold" style={{ color: level.colorDark }}>
            {open ? 'less ▴' : 'details ▾'}
          </span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 ml-7 space-y-1.5">
          {row('What', test.what)}
          {row('How', test.how)}
          {row('Pass', test.pass)}
        </div>
      )}
    </div>
  );
}
