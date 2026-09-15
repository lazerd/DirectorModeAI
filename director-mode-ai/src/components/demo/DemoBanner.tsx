'use client';

/**
 * The slim bar that says "this is the demo", on every page while inside one.
 *
 * Bottom, not top: the member ☰ opener and every club header live at the top,
 * and a bar that pushes them down changes the very screens being shown off.
 * It reserves its own height on <body> and publishes it as --demo-bar-h so
 * floating buttons (Ask ClubMode) sit above it instead of under it.
 *
 * Asks /api/demo/state only when the cm_demo cookie is present, so for
 * everyone who is not in a demo it costs one cookie read and nothing else.
 * Hidden when printing: round sheets and QR signs must print clean.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { withArticle } from '@/lib/demo/nextPath';

type DemoState = {
  demo: true;
  token: string;
  role: 'member' | 'director';
  firstName: string | null;
  label: string | null;
  /** Per link: "tennis director", "board member". */
  directorLabel: string;
  hasOther: boolean;
};

const hasDemoCookie = () =>
  typeof document !== 'undefined' && document.cookie.split(';').some((c) => c.trim().startsWith('cm_demo='));

export default function DemoBanner() {
  const pathname = usePathname();
  const [state, setState] = useState<DemoState | null>(null);
  const [leaving, setLeaving] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasDemoCookie()) {
      setState(null);
      return;
    }
    let live = true;
    fetch('/api/demo/state', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (live) setState(j?.demo ? (j as DemoState) : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);

  // Reserve the bar's real height (it wraps to two lines on a phone).
  useEffect(() => {
    const el = bar.current;
    const root = document.documentElement;
    if (!state || !el) {
      root.style.removeProperty('--demo-bar-h');
      document.body.style.paddingBottom = '';
      return;
    }
    const apply = () => {
      const h = el.offsetHeight;
      root.style.setProperty('--demo-bar-h', `${h}px`);
      document.body.style.paddingBottom = `${h}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--demo-bar-h');
      document.body.style.paddingBottom = '';
    };
  }, [state]);

  async function leave() {
    setLeaving(true);
    try {
      const res = await fetch('/api/demo/leave', { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as { to?: string };
      // A hard load: the session just changed under every cached component.
      window.location.href = j.to || '/';
    } catch {
      setLeaving(false);
    }
  }

  if (!state) return null;

  const tour = `/demo/${state.token}`;
  const other = state.role === 'member' ? 'director' : 'member';
  const who =
    state.role === 'member' ? `${state.firstName || 'a member'} (member)` : withArticle(state.directorLabel);

  return (
    <div
      ref={bar}
      data-demo-banner
      className="fixed inset-x-0 bottom-0 z-[9998] border-t-2 border-sky-300 bg-[#0c2d48] text-white shadow-[0_-4px_16px_rgba(0,0,0,0.25)] print:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)', fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
        <p className="text-[15px] leading-snug sm:text-base">
          You&apos;re exploring the {state.label ? `${state.label} ` : ''}demo as <strong>{who}</strong>
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          <a href={tour} className="rounded-lg px-3 py-2 underline-offset-2 hover:underline">
            Back to the tour
          </a>
          {state.hasOther && (
            <a
              href={`${tour}/enter?as=${other}`}
              className="rounded-lg border border-white/40 px-3 py-2 hover:bg-white/10"
            >
              Switch to {other === 'director' ? state.directorLabel : 'member'}
            </a>
          )}
          <button
            type="button"
            onClick={leave}
            disabled={leaving}
            className="rounded-lg bg-sky-300 px-3 py-2 text-[#0c2d48] hover:bg-sky-200 disabled:opacity-60"
          >
            {leaving ? 'Leaving…' : 'Leave demo'}
          </button>
        </div>
      </div>
    </div>
  );
}
