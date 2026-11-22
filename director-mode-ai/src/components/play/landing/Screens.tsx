'use client';

/**
 * What the landing page's phones show: the real app screens (DemoScreens, which wrap
 * EventClient's EventCard / OpenView / LiveView / HostPanel) for one small game,
 * Friday Night Doubles, at the moment each step describes. Built in the browser
 * after mount (times and ids are local), from lib/play/demoStages.
 *
 * Loaded with next/dynamic, so the event screens never weigh on the first paint.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Check } from 'lucide-react';
import { whenLine } from '@/lib/play/core';
import { DEMO_SPORTS, type DemoSport } from '@/lib/play/demo';
import { stagesFor, STAGE_PLAYERS, STAGE_TITLE, viewAs } from '@/lib/play/demoStages';
import { Compose, EventScreen, blankForm } from '../DemoScreens';
import { BrandContext } from '../shared';

export type ScreenId = 'create' | 'share' | 'fill' | 'courts' | 'next';

const noop = async () => undefined;

/** Where each screen should be scrolled to: the part of the page the step is about. */
const ANCHOR: Partial<Record<ScreenId, string>> = {
  create: '[data-demo="tile-mixer"]',
};

export default function Screens({ id, sport = 'tennis', height }: { id: ScreenId; sport?: DemoSport; height: number }) {
  const s = useMemo(() => stagesFor(sport), [sport]);
  const scroller = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const place = () => {
      const sc = scroller.current; if (!sc) return;
      const q = ANCHOR[id];
      sc.scrollTop = 0;
      if (!q) return;
      let el: HTMLElement | null = null;
      if (q.startsWith('any:')) {
        const want = q.slice(4).toLowerCase();
        el = ([...sc.querySelectorAll('div, span, h2, b')] as HTMLElement[]).reverse().find((x) => (x.textContent ?? '').toLowerCase().startsWith(want)) ?? null;
      } else el = sc.querySelector(q);
      if (!el) return;
      const a = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
      const scale = b.height / sc.offsetHeight || 1; // the phone is CSS-scaled; work in its own pixels
      sc.scrollTop = Math.max(0, (a.top - b.top) / scale - (id === 'create' ? 150 : 90));
    };
    place();
    // Fonts and the map settle a beat later; place it again once they have.
    const t = setTimeout(place, 450);
    return () => clearTimeout(t);
  }, [id, s]);

  const K = DEMO_SPORTS[sport];
  const body = (() => {
    switch (id) {
      case 'create':
        return <Compose f={{ ...blankForm(), sport, tile: 'mixer', courts: 2, when: whenLine(s.created) ?? 'Friday 6pm', where: K.place, name: 'Jordan' }} />;
      case 'share':
        return <Chat sport={sport} when={whenLine(s.created) ?? 'Friday 6pm'} place={K.place} />;
      case 'fill':
        return <EventScreen e={viewAs(s.full, s.hostId, true)} act={noop} busy="" tab="courts" setTab={() => {}} sheet={false} setSheet={() => {}} />;
      case 'courts':
        return <EventScreen e={viewAs(s.live, s.mayaId, false)} act={noop} busy="" tab="courts" setTab={() => {}} sheet={false} setSheet={() => {}} />;
      case 'next':
        return <EventScreen e={viewAs(s.next, s.mayaId, false)} act={noop} busy="" tab="table" setTab={() => {}} sheet={false} setSheet={() => {}} />;
    }
  })();

  return (
    <BrandContext.Provider value="Racquets IRL">
      <div ref={scroller} className="rl-noscroll absolute inset-0 overflow-hidden pt-11" style={{ height }}>{body}</div>
    </BrandContext.Provider>
  );
}

/** The group chat, as Jordan's crew sees it. An example conversation, not a product screen. */
function Chat({ sport, when, place }: { sport: DemoSport; when: string; place: string }) {
  const K = DEMO_SPORTS[sport];
  const msgs: { from: string; text?: string; link?: boolean; color?: string }[] = [
    { from: 'Jordan', text: `Doubles Friday, who’s in? ${K.emoji}`, link: true },
    { from: 'Priya', text: 'IN 🙋‍♀️', color: '#c2185b' },
    { from: 'Marcus', text: 'do I need to download something', color: '#1565c0' },
    { from: 'Jordan', text: 'nope. tap it, type your name, done' },
    { from: 'Marcus', text: 'ok that was easy. in', color: '#1565c0' },
    { from: 'Maya', text: 'in!! 🎾', color: '#283593' },
  ];
  return (
    <div className="min-h-[900px] -mt-11" style={{ background: '#efe7dd' }}>
      <div className="flex items-center gap-3 px-4 pb-3 pt-14 text-white" style={{ background: '#0b6b5a' }}>
        <span className="text-[22px]">‹</span>
        <div className="grid h-10 w-10 place-items-center rounded-full text-[20px]" style={{ background: '#ffffff30' }}>{K.emoji}</div>
        <div className="leading-tight"><div className="text-[16px] font-semibold">{K.crew}</div><div className="text-[12px] opacity-80">Jordan, Priya, Marcus, Maya +4</div></div>
      </div>
      <div className="grid gap-1.5 px-3 py-4 text-[15px]">
        <div className="mx-auto mb-2 rounded-lg px-3 py-1 text-[12px]" style={{ background: '#fff8c4', color: '#5b5b4a' }}>Today</div>
        {msgs.map((m, i) => {
          const mine = m.from === 'Jordan';
          return (
            <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[82%] rounded-2xl px-3 py-2 shadow-sm" style={{ background: mine ? '#d9fdd3' : '#fff', color: '#111b21', borderTopRightRadius: mine ? 4 : 16, borderTopLeftRadius: mine ? 16 : 4 }}>
                {!mine && <div className="text-[13px] font-semibold" style={{ color: m.color }}>{m.from}</div>}
                {m.link && (
                  <div className="mb-1.5 overflow-hidden rounded-xl" style={{ background: '#f0f2f0' }}>
                    <div className="flex items-center gap-2 px-3 py-3" style={{ background: '#103c32' }}>
                      <span className="grid h-6 w-6 place-items-center rounded-md text-[13px] font-black" style={{ background: '#d4ff49', color: '#103c32' }}>↯</span>
                      <span className="text-[14px] font-semibold text-white">Racquets IRL</span>
                    </div>
                    <div className="px-3 py-2"><div className="text-[14px] font-semibold">{STAGE_TITLE}</div><div className="text-[12px]" style={{ color: '#667781' }}>{when} · {place} · {STAGE_PLAYERS} spots</div></div>
                  </div>
                )}
                {m.text && <div className="leading-snug">{m.text}</div>}
                <div className="mt-0.5 text-right text-[10px]" style={{ color: '#667781' }}>5:{(12 + i).toString().padStart(2, '0')}{mine && <Check className="ml-0.5 inline h-3 w-3 text-[#53bdeb]" />}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
