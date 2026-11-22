'use client';

import { useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';
import { DEMO_STEPS } from './copy';
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

// React 18 only passes inert through as a string attribute.
const INERT = { inert: '' } as Record<string, string>;

/* ---------- a phone, drawn at 414 x H and scaled to the width asked for ---------- */
const Screens = dynamic(() => import('./Screens'), { ssr: false, loading: () => <ScreenSkeleton /> });

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
 * size: Tailwind classes that set --pw, the phone's width in px (unitless), per breakpoint,
 * e.g. "[--pw:260] lg:[--pw:330]". One phone, sized by CSS, so nothing remounts on resize.
 */
export function Phone({ id, size, ratio = 2.05, label }: { id: ScreenId; size: string; ratio?: number; label: string }) {
  const H = Math.round(414 * ratio);
  return (
    <figure className={`relative mx-auto shrink-0 ${size}`} style={{ width: 'calc(var(--pw) * 1px)', height: `calc(var(--pw) * ${H / 414}px)` }} aria-label={label} role="img">
      <div className="absolute left-0 top-0 origin-top-left rounded-[58px] p-3 shadow-[0_30px_80px_#0009,0_0_0_1px_#2a2f2c]"
        style={{ width: 414, height: H, transform: 'scale(calc(var(--pw) / 414))', background: '#0b0d0c' }}>
        <div className="relative h-full w-full overflow-hidden rounded-[46px]" style={{ background: '#f4f5ef', transform: 'translateZ(0)' }} aria-hidden="true" {...INERT}>
          <div className="absolute inset-x-0 top-0 z-30 flex h-11 items-center justify-between px-8 text-[14px] font-semibold" style={{ color: '#103c32', background: id === 'share' ? '#0b6b5a' : '#f4f5ef', ...(id === 'share' ? { color: '#fff' } : {}) }}>
            <span>{id === 'courts' || id === 'next' ? '6:02' : '5:14'}</span>
            <span className="absolute left-1/2 top-2 h-7 w-28 -translate-x-1/2 rounded-full bg-black" />
            <span className="tracking-tighter">▂▄▆ ▮</span>
          </div>
          <Screens id={id} height={H - 24} />
        </div>
      </div>
    </figure>
  );
}

/* ---------- See it in action: five moments of one real game ---------- */
const ALT: Record<ScreenId, string> = {
  create: 'The Create a game page filled in: tennis, social mixer, Friday 6pm at Lakeside Park, 2 courts, host Jordan.',
  share: 'A group chat where Jordan posts the game link and friends reply that they are in.',
  fill: 'Jordan’s game page showing 8 of 8 players in, with every player’s name.',
  courts: 'Maya’s phone in round 1, showing her court, her partner and her opponents.',
  next: 'Maya’s phone in round 2 with new partners, above the live leaderboard from round 1’s scores.',
};

export function ProductDemo() {
  const [i, setI] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const step = DEMO_STEPS[i];
  const go = (n: number, how: string) => {
    const k = (n + DEMO_STEPS.length) % DEMO_STEPS.length;
    setI(k);
    track('rirl_demo_step', { step: DEMO_STEPS[k].key, how });
    return k;
  };
  const onKey = (x: React.KeyboardEvent) => {
    const d = x.key === 'ArrowDown' || x.key === 'ArrowRight' ? 1 : x.key === 'ArrowUp' || x.key === 'ArrowLeft' ? -1 : 0;
    const k = x.key === 'Home' ? 0 : x.key === 'End' ? DEMO_STEPS.length - 1 : d ? (i + d + DEMO_STEPS.length) % DEMO_STEPS.length : -1;
    if (k < 0) return;
    x.preventDefault();
    go(k, 'key');
    tabs.current[k]?.focus();
  };

  return (
    <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
      <div>
        <div role="tablist" aria-label="Steps of a game" aria-orientation="vertical" onKeyDown={onKey} className="grid gap-1.5">
          {DEMO_STEPS.map((x, n) => {
            const on = n === i;
            return (
              <button key={x.key} ref={(el) => { tabs.current[n] = el; }} role="tab" id={`demo-tab-${x.key}`} aria-selected={on} aria-controls="demo-panel" tabIndex={on ? 0 : -1}
                onClick={() => go(n, 'tab')}
                className={`rl-focus group flex w-full items-start gap-4 rounded-2xl px-4 py-3.5 text-left transition-colors ${on ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}>
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold transition-colors"
                  style={on ? { background: '#d4ff49', color: '#103c32' } : { boxShadow: 'inset 0 0 0 1.5px #ffffff40', color: '#c9d8cc' }}>{n + 1}</span>
                <span className="min-w-0">
                  <span className={`block text-[17px] font-semibold leading-snug ${on ? 'text-white' : 'text-[#c9d8cc]'}`}>{x.title}</span>
                  <span className={`block text-[15px] leading-snug ${on ? 'text-[#c9d8cc]' : 'hidden sm:block text-[#9fb3a6]'}`}>{x.body}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-center">
        <div id="demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${step.key}`} className="rl-fade" key={step.key}>
          <Phone id={step.key as ScreenId} size="[--pw:280] sm:[--pw:310]" label={ALT[step.key as ScreenId]} />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button type="button" onClick={() => go(i - 1, 'prev')} aria-label="Previous step" className="rl-focus grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/15"><ArrowLeft className="h-5 w-5" /></button>
          <span className="min-w-[4.5rem] text-center text-[14px] font-semibold tabular-nums text-[#c9d8cc]" aria-live="polite">{i + 1} of {DEMO_STEPS.length}</span>
          <button type="button" onClick={() => go(i + 1, 'next')} aria-label="Next step" className="rl-focus grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/15"><ArrowRight className="h-5 w-5" /></button>
        </div>
      </div>
    </div>
  );
}
