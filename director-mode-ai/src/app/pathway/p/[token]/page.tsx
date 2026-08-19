'use client';

/**
 * The family magic-link page: one kid's climb up the Junior Pathway.
 *
 * Design: a vertical ascent, Red Ball at the bottom of the mountain, High
 * Performance at the summit. The kid's current position pulses. The next
 * stripe's three tests are the hero — that is what a kid checks on the car
 * ride to practice. Scoreboard type (Barlow Condensed, already loaded
 * app-wide), warm court-paper ground, ball colors as the only accents.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  LEVELS,
  LEVEL_BY_KEY,
  STRIPE_BY_KEY,
  HOUSE_RULES,
  SUMMIT_REWARDS,
  stripesInLevel,
  type Level,
  type LevelKey,
} from '@/lib/pathway/curriculum';

type Award = { stripe_key: string; awarded_on: string };
type PlayerState = { name: string; level: LevelKey; enrolled: boolean };

const fmt = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
  });

export default function PathwayFamilyPage() {
  const { token } = useParams<{ token: string }>();
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [awards, setAwards] = useState<Award[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/pathway/p/${token}`, { cache: 'no-store' });
        if (!res.ok) throw new Error();
        const j = await res.json();
        setPlayer(j.player);
        setAwards(j.awards || []);
        setState('ok');
      } catch {
        setState('error');
      }
    })();
  }, [token]);

  const awardKeys = useMemo(() => awards.map((a) => a.stripe_key), [awards]);
  const awardDate = useMemo(
    () => Object.fromEntries(awards.map((a) => [a.stripe_key, a.awarded_on])),
    [awards],
  );

  const recent = useMemo(() => {
    const cut = Date.now() - 10 * 24 * 3600 * 1000;
    return awards.filter((a) => new Date(a.awarded_on + 'T12:00:00').getTime() >= cut);
  }, [awards]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF7F2' }}>
        <div className="w-10 h-10 rounded-full border-4 border-yellow-400 border-t-transparent animate-spin" />
      </div>
    );
  }
  if (state === 'error' || !player) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: '#FAF7F2' }}>
        <div className="max-w-sm text-center">
          <p className="text-4xl mb-3">🎾</p>
          <h1 className="text-xl font-bold text-gray-900 mb-1">Link not recognized</h1>
          <p className="text-sm text-gray-600">
            This Pathway link isn&apos;t active. Ask the tennis desk for a fresh one.
          </p>
        </div>
      </div>
    );
  }

  const level = LEVEL_BY_KEY[player.level];
  const earnedHere = stripesInLevel(player.level, awardKeys);
  const nextStripe = level.stripes.find((st) => !awardKeys.includes(st.key)) ?? null;
  const totalStripes = awardKeys.filter((k) => STRIPE_BY_KEY[k]).length;
  const firstName = player.name.split(' ')[0];
  const climb = [...LEVELS].sort((a, b) => b.order - a.order); // summit first

  return (
    <div className="min-h-screen" style={{ background: '#FAF7F2', color: '#1C2321' }}>
      <div className="max-w-lg mx-auto px-5 pb-16">
        {/* ── header ─────────────────────────────────────────────── */}
        <header className="pt-10 pb-6">
          <p
            className="text-[11px] font-semibold tracking-[0.22em] uppercase text-gray-500"
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            The Sleepy Hollow Junior Pathway
          </p>
          <h1
            className="mt-2 leading-none"
            style={{ fontFamily: '"Barlow Condensed", sans-serif', fontWeight: 900, fontSize: 'clamp(3rem, 14vw, 4.5rem)' }}
          >
            {firstName.toUpperCase()}
          </h1>
          <div className="mt-2 flex items-center gap-2.5">
            <span
              className="inline-block w-4 h-4 rounded-full ring-2 ring-white shadow"
              style={{ background: level.color }}
            />
            <span className="font-semibold" style={{ color: level.colorDark }}>
              {level.name}
            </span>
            {!level.invitational && (
              <span className="text-sm text-gray-500">
                · {earnedHere} of 5 stripes
              </span>
            )}
            {totalStripes > 0 && (
              <span className="text-sm text-gray-400">· {totalStripes} earned all-time</span>
            )}
          </div>
        </header>

        {/* ── fresh stripe celebration ───────────────────────────── */}
        {recent.length > 0 && STRIPE_BY_KEY[recent[recent.length - 1].stripe_key] && (
          <div
            className="mb-6 rounded-2xl px-5 py-4 text-white shadow-lg"
            style={{ background: `linear-gradient(120deg, ${level.colorDark}, ${level.color})` }}
          >
            <p className="text-[11px] font-bold tracking-[0.2em] uppercase opacity-80">New stripe</p>
            <p className="text-xl font-extrabold" style={{ fontFamily: '"Barlow Condensed", sans-serif' }}>
              {STRIPE_BY_KEY[recent[recent.length - 1].stripe_key].title} ✓
            </p>
            <p className="text-sm opacity-90">
              Earned {fmt(recent[recent.length - 1].awarded_on)}. Tell everyone.
            </p>
          </div>
        )}

        {/* ── the next test: the hero card ───────────────────────── */}
        {level.invitational ? (
          <div className="rounded-2xl bg-white shadow-sm border border-gray-200 p-6 mb-10">
            <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-violet-700">Summit</p>
            <h2 className="text-2xl mt-1" style={{ fontFamily: '"Barlow Condensed", sans-serif', fontWeight: 800 }}>
              High Performance
            </h2>
            <p className="text-sm text-gray-600 mt-2">
              {firstName} has reached the invitation tier — the top of the Pathway. From here it&apos;s
              tournaments, UTR, and match play.
            </p>
          </div>
        ) : nextStripe ? (
          <div className="rounded-2xl bg-white shadow-sm border border-gray-200 overflow-hidden mb-10">
            <div className="px-6 pt-5 pb-4" style={{ borderBottom: `3px solid ${level.color}` }}>
              <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-gray-400">
                Next up — stripe {nextStripe.number} of 5
              </p>
              <h2
                className="text-3xl mt-0.5"
                style={{ fontFamily: '"Barlow Condensed", sans-serif', fontWeight: 800, color: level.colorDark }}
              >
                {nextStripe.title}
              </h2>
              {nextStripe.promotes && (
                <p className="text-xs font-semibold mt-1" style={{ color: level.colorDark }}>
                  ★ Pass this one and {firstName} is promoted to{' '}
                  {LEVELS.find((l) => l.order === level.order + 1)?.name}.
                </p>
              )}
            </div>
            <ul className="px-6 py-4 space-y-3">
              {nextStripe.tests.map((t, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span
                    className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] font-bold"
                    style={{ borderColor: level.color, color: level.colorDark }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-[15px] leading-snug text-gray-800">{t}</span>
                </li>
              ))}
            </ul>
            <p className="px-6 pb-5 text-xs text-gray-500">
              Tested on <strong>Test Day</strong> — the last class of the month, parents welcome for
              the final 15 minutes.
            </p>
          </div>
        ) : null}

        {/* ── the climb ──────────────────────────────────────────── */}
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-gray-400 mb-4">
          The climb
        </p>
        <div className="relative">
          {/* the rail */}
          <div className="absolute left-[13px] top-3 bottom-3 w-[2px] bg-gray-200" />
          <div className="space-y-2">
            {climb.map((lvl) => (
              <ClimbLevel
                key={lvl.key}
                level={lvl}
                playerLevel={level}
                awardKeys={awardKeys}
                awardDate={awardDate}
                firstName={firstName}
              />
            ))}
          </div>
        </div>

        {/* ── summit rewards ─────────────────────────────────────── */}
        <div className="mt-10 rounded-2xl p-6 text-white" style={{ background: '#1C2321' }}>
          <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-yellow-400">
            Top of the ladder
          </p>
          <p className="text-sm text-gray-300 mt-1 mb-3">Clear Yellow 5 and you get:</p>
          <ul className="space-y-2">
            {SUMMIT_REWARDS.map((r, i) => (
              <li key={i} className="flex gap-2.5 text-[15px]">
                <span className="text-yellow-400">★</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ── house rules ────────────────────────────────────────── */}
        <div className="mt-8">
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

        <footer className="mt-12 pt-6 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-400">
            Sleepy Hollow Junior Tennis · powered by <strong>ClubMode</strong>
          </p>
        </footer>
      </div>
    </div>
  );
}

function ClimbLevel({
  level,
  playerLevel,
  awardKeys,
  awardDate,
  firstName,
}: {
  level: Level;
  playerLevel: Level;
  awardKeys: string[];
  awardDate: Record<string, string>;
  firstName: string;
}) {
  const isCurrent = level.key === playerLevel.key;
  const isPast = level.order < playerLevel.order;
  const isFuture = level.order > playerLevel.order;
  const [open, setOpen] = useState(isCurrent);
  const earned = stripesInLevel(level.key, awardKeys);

  return (
    <div className="relative pl-10">
      {/* node on the rail */}
      <span
        className="absolute left-0 top-3 w-7 h-7 rounded-full flex items-center justify-center ring-4"
        style={{
          background: isFuture ? '#fff' : level.color,
          borderWidth: isFuture ? 2 : 0,
          borderStyle: 'solid',
          borderColor: '#d1d5db',
          boxShadow: isCurrent ? `0 0 0 6px ${level.color}33` : undefined,
          // @ts-expect-error CSS var for ring color via tailwind ring
          '--tw-ring-color': '#FAF7F2',
        }}
      >
        {isPast && <span className="text-white text-sm font-bold">✓</span>}
        {isCurrent && (
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
        )}
      </span>

      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left rounded-xl px-4 py-3 transition-colors"
        style={{
          background: isCurrent ? '#fff' : 'transparent',
          border: isCurrent ? '1px solid #e5e7eb' : '1px solid transparent',
          boxShadow: isCurrent ? '0 1px 4px rgba(0,0,0,.05)' : undefined,
          opacity: isFuture ? 0.75 : 1,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <span
              className="text-xl"
              style={{
                fontFamily: '"Barlow Condensed", sans-serif',
                fontWeight: 800,
                color: isFuture ? '#6b7280' : level.colorDark,
              }}
            >
              {level.name.toUpperCase()}
            </span>
            {isCurrent && (
              <span
                className="ml-2 text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full text-white"
                style={{ background: level.colorDark }}
              >
                {firstName} is here
              </span>
            )}
          </div>
          {/* stripe pips */}
          {!level.invitational && (
            <div className="flex gap-1.5 flex-shrink-0">
              {level.stripes.map((st) => {
                const has = awardKeys.includes(st.key);
                return (
                  <span
                    key={st.key}
                    className="w-3.5 h-3.5 rounded-full"
                    style={{
                      background: has ? level.color : 'transparent',
                      border: `2px solid ${has ? level.color : '#d1d5db'}`,
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {level.invitational
            ? level.tagline
            : `${level.court} · ${level.ball}${earned ? ` · ${earned}/5 stripes` : ''}`}
        </p>
      </button>

      {/* expanded stripe list */}
      {open && !level.invitational && (
        <div className="mt-1 mb-3 ml-1 space-y-1">
          {level.stripes.map((st) => {
            const has = awardKeys.includes(st.key);
            return (
              <div
                key={st.key}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2"
                style={{ background: has ? `${level.color}14` : 'transparent' }}
              >
                <span
                  className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                  style={{
                    background: has ? level.color : '#fff',
                    border: `2px solid ${has ? level.color : '#d1d5db'}`,
                    color: has ? '#fff' : '#9ca3af',
                  }}
                >
                  {has ? '✓' : st.number}
                </span>
                <span
                  className="text-sm flex-1"
                  style={{ color: has ? '#1C2321' : '#6b7280', fontWeight: has ? 600 : 400 }}
                >
                  {st.title}
                  {st.promotes && <span style={{ color: level.colorDark }}> ★</span>}
                </span>
                {has && awardDate[st.key] && (
                  <span className="text-[11px] text-gray-400">{fmt(awardDate[st.key])}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
