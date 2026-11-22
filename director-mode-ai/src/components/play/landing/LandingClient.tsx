'use client';

import { useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';
import { STORY } from './copy';
import type { ScreenId } from './Screens';

/* ---------- analytics: the site's own tracker (lib/analytics), no new provider ---------- */
export function track(name: string, meta: Record<string, unknown> = {}) {
  trackEvent('feature_use', name, 'courtconnect', meta);
}

/** A link that records which CTA was used (rirl_cta / rirl_how / rirl_join ...). */
export function CtaLink({ href, event, where, className, style, children, ariaLabel }: {
  href: string; event: string; where: string; className?: string; style?: React.CSSProperties; children: ReactNode; ariaLabel?: string;
}) {
  const onClick = () => track(event, { where });
  if (href.startsWith('#')) {
    return (
      <a href={href} aria-label={ariaLabel} className={className} style={style}
        onClick={(x) => {
          onClick();
          const el = document.querySelector(href);
          if (!el) return;
          x.preventDefault();
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
          history.replaceState(null, '', href);
          (el as HTMLElement).focus({ preventScroll: true });
        }}>{children}</a>
    );
  }
  return <Link href={href} aria-label={ariaLabel} className={className} style={style} onClick={onClick}>{children}</Link>;
}

/* ---------- a phone, drawn at 414 x 849 and scaled by CSS ---------- */
const Screens = dynamic(() => import('./Screens'), { ssr: false, loading: () => <ScreenSkeleton /> });

// React 18 only passes inert through as a string attribute.
const INERT = { inert: '' } as Record<string, string>;
const PH = 849; // the phone's own height (414 wide)

function ScreenSkeleton() {
  return (
    <div className="absolute inset-0 grid content-start gap-4 px-5 pt-20" aria-hidden="true">
      <div className="h-8 w-2/3 rounded-xl bg-[#e3e8dd]" />
      <div className="h-40 rounded-3xl bg-[#103c32]/90" />
      <div className="h-24 rounded-3xl bg-[#e3e8dd]" />
      <div className="h-24 rounded-3xl bg-[#e3e8dd]" />
    </div>
  );
}

/**
 * size: Tailwind classes for --pw (width in px, unitless) and optionally --pr (how much of the
 * phone's height to show, 0-1; the rest fades into `fade`), per breakpoint. One phone, sized
 * by CSS, so nothing remounts on resize. e.g. "[--pw:280] [--pr:0.62] lg:[--pw:330] lg:[--pr:1]".
 */
export function Phone({ id, size, label, fade }: { id: ScreenId; size: string; label: string; fade?: string }) {
  return (
    <figure role="img" aria-label={label} className={`relative mx-auto shrink-0 overflow-hidden ${size}`}
      style={{ width: 'calc(var(--pw) * 1px)', height: `calc(var(--pw) * var(--pr, 1) * ${PH / 414}px)` }}>
      <div className="absolute left-0 top-0 origin-top-left rounded-[58px] p-3 shadow-[0_0_0_1px_#2a2f2c]"
        style={{ width: 414, height: PH, transform: 'scale(calc(var(--pw) / 414))', background: '#0b0d0c' }}>
        <div className="relative h-full w-full overflow-hidden rounded-[46px]" style={{ background: '#f4f5ef', transform: 'translateZ(0)' }} aria-hidden="true" {...INERT}>
          <div className="absolute inset-x-0 top-0 z-30 flex h-11 items-center justify-between px-8 text-[14px] font-semibold"
            style={id === 'share' ? { color: '#fff', background: '#0b6b5a' } : { color: '#103c32', background: '#f4f5ef' }}>
            <span>{id === 'courts' || id === 'next' ? '6:02' : '5:14'}</span>
            <span className="absolute left-1/2 top-2 h-7 w-28 -translate-x-1/2 rounded-full bg-black" />
            <span className="tracking-tighter">▂▄▆ ▮</span>
          </div>
          <Screens id={id} height={PH - 24} />
        </div>
      </div>
      {fade && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4" style={{ background: `linear-gradient(to bottom, transparent, ${fade})`, display: 'var(--fade, block)' }} />}
    </figure>
  );
}

/* ---------- Create it / Fill it / Play it: one real game, five screens ---------- */
const FLAT = STORY.flatMap((st, s) => st.screens.map((sc, k) => ({ ...sc, stage: s, k, of: st.screens.length })));
const ALT: Record<ScreenId, string> = {
  create: 'The Start a game page filled in: tennis, social mixer, Friday 6pm at Lakeside Park, 2 courts, host Jordan.',
  share: 'A group chat where Jordan posts the game link and friends reply that they are in.',
  fill: 'Jordan’s game page: 8 of 8 in, with every player’s name.',
  courts: 'Maya’s phone in round 1, showing her court, her partner and her opponents.',
  next: 'Maya’s phone in round 2: a new partner, and the live standings from round 1.',
};

export function Story() {
  const [i, setI] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const cur = FLAT[i];
  const go = (n: number, how: string) => {
    const k = (n + FLAT.length) % FLAT.length;
    setI(k);
    track('rirl_demo_step', { step: FLAT[k].id, how });
  };
  const toStage = (s: number, how: string) => go(FLAT.findIndex((x) => x.stage === s), how);
  const onKey = (x: React.KeyboardEvent) => {
    const n = STORY.length;
    const d = x.key === 'ArrowRight' || x.key === 'ArrowDown' ? 1 : x.key === 'ArrowLeft' || x.key === 'ArrowUp' ? -1 : 0;
    const s = x.key === 'Home' ? 0 : x.key === 'End' ? n - 1 : d ? (cur.stage + d + n) % n : -1;
    if (s < 0) return;
    x.preventDefault();
    toStage(s, 'key');
    tabs.current[s]?.focus();
  };
  const st = STORY[cur.stage];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-20">
      <div>
        {/* phones + tablets: a three-way switch right above the phone */}
        <div role="tablist" aria-label="Create it, fill it, play it" onKeyDown={onKey}
          className="grid grid-cols-3 gap-1 rounded-2xl bg-[#e3e9dc] p-1 lg:flex lg:flex-col lg:gap-2 lg:rounded-none lg:bg-transparent lg:p-0">
          {STORY.map((x, n) => {
            const on = n === cur.stage;
            return (
              <button key={x.key} ref={(el) => { tabs.current[n] = el; }} role="tab" id={`story-tab-${x.key}`} aria-selected={on} aria-controls="story-panel" tabIndex={on ? 0 : -1}
                onClick={() => toStage(n, 'tab')}
                className={`rl-focus rl-stage group relative min-h-[44px] rounded-xl px-2 py-2.5 text-center text-[15px] font-semibold transition-colors lg:rounded-3xl lg:px-7 lg:py-6 lg:text-left ${on ? 'is-on' : ''}`}>
                <span className="flex items-center justify-center gap-2 lg:justify-start">
                  <span className="rl-num hidden h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold lg:grid">{n + 1}</span>
                  <span className="lg:text-[14px] lg:uppercase lg:tracking-[0.12em]">{x.label}</span>
                </span>
                <span className="rl-stage-body hidden lg:block">
                  <span className="mt-3 block text-[26px] font-semibold leading-tight tracking-[-0.02em]">{x.title}</span>
                  <span className="mt-2 block text-[16px] font-normal leading-relaxed">{x.body}</span>
                </span>
              </button>
            );
          })}
        </div>
        {/* below lg: the chosen stage's words */}
        <div className="mt-6 text-center lg:hidden" aria-live="polite">
          <h3 key={st.key} className="rl-fade text-[26px] font-semibold leading-tight tracking-[-0.02em]">{st.title}</h3>
          <p className="mx-auto mt-2 max-w-md text-[16px] leading-relaxed" style={{ color: '#4d5f55' }}>{st.body}</p>
        </div>
      </div>

      <div className="flex flex-col items-center">
        <div id="story-panel" role="tabpanel" aria-labelledby={`story-tab-${st.key}`} key={cur.id} className="rl-fade">
          <Phone id={cur.id as ScreenId} fade="#f4f5ef" size="[--pw:272] [--pr:0.8] sm:[--pw:300] sm:[--pr:0.86] lg:[--pw:280] lg:[--pr:1] lg:[--fade:none]" label={ALT[cur.id as ScreenId]} />
        </div>
        <div className="mt-5 flex w-full max-w-[340px] items-center justify-between gap-3">
          <button type="button" onClick={() => go(i - 1, 'prev')} aria-label="Previous screen" className="rl-focus grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#103c320f] hover:bg-[#103c321a]"><ArrowLeft className="h-5 w-5" /></button>
          <p className="min-w-0 text-center text-[14px] leading-snug" style={{ color: '#4d5f55' }} aria-live="polite">
            <span className="block font-semibold" style={{ color: '#103c32' }}>{cur.caption}</span>
            <span className="tabular-nums">{i + 1} of {FLAT.length}</span>
          </p>
          <button type="button" onClick={() => go(i + 1, 'next')} aria-label="Next screen" className="rl-focus grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#103c32]" style={{ background: '#d4ff49' }}><ArrowRight className="h-5 w-5" /></button>
        </div>
      </div>
    </div>
  );
}
