'use client';

/**
 * The phone screens the demos show: the host's Create a game page (a display-only
 * mirror of HostClient) and the real event screens (EventCard, OpenView, LiveView,
 * DoneView, HostPanel, StatusSheet) fed by the local demo engine.
 * Used by the full tour (DemoTour, /play/demo) and the landing page demo.
 */
import { Check, ChevronDown, Clock, MapPin, Mic } from 'lucide-react';
import { type PlayEvent } from '@/lib/play/core';
import { DEMO_SPORTS, type DemoSport, demoDraft } from '@/lib/play/demo';
import { DoneView, EventCard, HostPanel, LiveView, OpenView, StatusSheet, type Res } from './EventClient';
import { FormatChooser } from './EventPicker';
import { PlaceMap } from './PlacePicker';
import { C, PlayHeader } from './shared';
import { PRICING_LINE } from '@/lib/play/pricing';

export type Field = 'where' | 'level' | 'name';
export interface Form { sport: DemoSport; tile: 'game' | 'mixer'; when: string; where: string; courts: number; more: boolean; level: string; cap: number | null; name: string; typing: Field | null }
export const blankForm = (): Form => ({ sport: 'tennis', tile: 'game', when: '', where: '', courts: 1, more: false, level: '', cap: null, name: '', typing: null });

export function EventScreen({ e, act, busy, tab, setTab, sheet, setSheet, banner }: {
  e: PlayEvent; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined>; busy: string;
  tab: 'courts' | 'table'; setTab: (t: 'courts' | 'table') => void; sheet: boolean; setSheet: (v: boolean) => void; banner?: boolean;
}) {
  const meR = e.rsvps.find((r) => r.id === e.me);
  return (
    <div className="min-h-full pb-16" style={{ background: C.paper, color: C.ink }}>
      <PlayHeader right={e.isHost ? <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: C.lime }}>You&apos;re hosting</span> : null} />
      <main className="mx-auto w-full max-w-xl px-4">
        {banner && e.isHost && e.status === 'open' && (
          <div className="mb-3 rounded-2xl p-4 text-[14px]" style={{ background: C.lime }}><b>Your link is ready.</b> Send it to your group chat. Everything else happens on this page.</div>
        )}
        <EventCard e={e} onStatus={() => setSheet(true)} compact={e.status !== 'open'} />
        <div data-demo="tape-anchor" />
        {/* Same order as the real page (EventClient): the host's panel sits up top, live controls under the clock. */}
        {e.status === 'open' && e.isHost && <HostPanel e={e} busy={busy} act={act} hostKey={null} />}
        {e.status === 'open' && <OpenView e={e} meName={meR?.name} busy={busy} act={act} code="demo" />}
        {e.status === 'live' && <LiveView e={e} tab={tab} setTab={setTab} busy={busy} act={act} canScore={e.isHost || !!e.me} code="demo" hostSlot={e.isHost ? <HostPanel e={e} busy={busy} act={act} hostKey={null} /> : null} />}
        {e.status === 'done' && <DoneView e={e} busy={busy} act={act} code="demo" myName={meR?.name} />}
        {e.status === 'open' && <PlaceMap e={e} className="mt-4" />}
        {e.isHost && e.status === 'done' && <HostPanel e={e} busy={busy} act={act} hostKey={null} />}
        {sheet && <StatusSheet e={e} busy={busy} act={act} hostKey={e.isHost ? 'demo-host-link' : null} onClose={() => setSheet(false)} />}
      </main>
    </div>
  );
}

export function Compose({ f }: { f: Form }) {
  // Mirrors HostClient (/play/new). Display only: the tour (and the landing demo) fill it in.
  const caret = (k: Field) => (f.typing === k ? <span className="demo-caret" /> : null);
  const box = 'flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-[16px]';
  const ph = { color: '#8a978d' };
  const title = demoDraft(new Date(), f.sport).title;
  const TILES = [['game', 'A game', 'Doubles or singles, 1 court'], ['mixer', 'Social mixer', 'Rotating partners, any headcount'], ['kotc', 'King of the Court', 'Winners move up a court'], ['tournament', 'Tournament', 'Round robin or brackets']] as const;
  return (
    <div className="min-h-full pb-16" style={{ background: C.paper, color: C.ink }}>
      <PlayHeader right={<span className="text-xs" style={{ color: C.muted }}>Free · No login</span>} />
      <main className="px-5">
        <h1 className="pt-6 text-center text-[36px] font-medium leading-[1.04] tracking-[-1.5px]">Create a game</h1>
        <div className="mx-auto mt-4 flex w-fit items-center gap-3 rounded-full px-3 py-2">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: C.ink, color: C.lime }}><Mic className="h-5 w-5" /></span>
          <span className="text-[15px] font-semibold">Know what you want? Just say it.</span>
        </div>
        <div className="mt-1 text-center text-[14px] underline underline-offset-4" style={{ color: C.muted }}>Or just type it in.</div>

        <DemoStep n={1} title="Sport">
          <div className="grid grid-cols-3 gap-1 rounded-xl p-1" style={{ background: '#e7ece2' }}>
            {(['tennis', 'pickleball', 'padel'] as DemoSport[]).map((x) => (
              <span key={x} data-demo={`sport-${x}`} className="rounded-lg py-2 text-center text-[14px] font-semibold" style={f.sport === x ? { background: C.ink, color: '#fff' } : undefined}>{DEMO_SPORTS[x].label}</span>
            ))}
          </div>
        </DemoStep>

        <DemoStep n={2} title="Format">
          <div className="grid grid-cols-2 gap-2">
            {TILES.map(([id, label, sub]) => {
              const on = f.tile === id;
              return (
                <div key={id} data-demo={`tile-${id}`} className="rounded-2xl border px-3.5 py-3"
                  style={{ borderColor: on ? C.ink : C.line, background: on ? '#f4ffd9' : '#fff', boxShadow: on ? `inset 0 0 0 1px ${C.ink}` : undefined }}>
                  <span className="flex items-center justify-between gap-1 text-[15px] font-semibold">{label}{on && <Check className="h-4 w-4" />}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug" style={{ color: C.muted }}>{sub}</span>
                </div>
              );
            })}
          </div>
          {f.tile === 'game' && (
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl p-1" style={{ background: '#e7ece2' }}>
              <span className="rounded-lg py-2 text-center text-[14px] font-semibold" style={{ background: C.ink, color: '#fff' }}>Doubles (4)</span>
              <span className="py-2 text-center text-[14px] font-semibold">Singles (2)</span>
            </div>
          )}
          {f.tile === 'mixer' && (
            <div data-demo="chooser" className="demo-pop pointer-events-none"><FormatChooser value="maximize-courts" spots={f.cap} courts={f.courts} onChange={() => {}} /></div>
          )}
        </DemoStep>

        <DemoStep n={3} title="When & where">
          <div className="grid gap-2">
            <div data-demo="when" className={box} style={{ borderColor: C.line }}><Clock className="h-4 w-4 shrink-0" style={{ color: C.muted }} />{f.when || <span style={ph}>Pick a day &amp; time</span>}</div>
            <div data-demo="where" className={box} style={{ borderColor: C.line }}><MapPin className="h-4 w-4 shrink-0" style={{ color: C.muted }} />{f.where || (f.typing === 'where' ? null : <span style={ph}>Where? (courts, park, club)</span>)}{caret('where')}</div>
            {f.tile !== 'game' && <DemoStepper label="Courts" value={f.courts} />}
          </div>
        </DemoStep>

        <div className="mt-4">
          <div data-demo="more" className="flex w-fit items-center gap-1 text-[13px] font-semibold" style={{ color: C.muted }}>
            More options <span className="font-normal">(name, level, player cap, weekly)</span> <ChevronDown className={`h-4 w-4 transition-transform ${f.more ? 'rotate-180' : ''}`} />
          </div>
          {f.more && (
            <div className="demo-pop mt-2 grid gap-2 text-[14px]">
              <div className={box} style={{ borderColor: C.line }}><span className="shrink-0 text-[14px]" style={{ color: C.muted }}>Name</span>{title}</div>
              <div aria-label="Level" className={box} style={{ borderColor: C.line }}><span className="shrink-0 text-[14px]" style={{ color: C.muted }}>Level</span>{f.level || (f.typing === 'level' ? null : <span style={ph}>Any level</span>)}{caret('level')}</div>
              <DemoStepper label="Player cap" value={f.cap ?? 'None'} />
              <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: C.line }}><span className="h-4 w-4 rounded border" style={{ borderColor: C.muted }} />Every week</div>
            </div>
          )}
        </div>

        <DemoStep n={4} title="You">
          <div className="grid gap-3">
            <div aria-label="Your name" className="w-full rounded-xl border bg-white px-3 py-2.5 text-[16px]" style={{ borderColor: C.line }}>{f.name || (f.typing === 'name' ? null : <span style={ph}>Your first name</span>)}{caret('name')}</div>
            <div className="flex items-center gap-2 text-[14px]"><span className="grid h-5 w-5 place-items-center rounded text-white" style={{ background: C.ink }}><Check className="h-3.5 w-3.5" /></span>I&apos;m playing too{f.cap != null ? ` (counts as 1 of the ${f.cap})` : ''}</div>
          </div>
        </DemoStep>

        <section className="mt-5 grid gap-2">
          <button className="flex h-14 items-center justify-center rounded-2xl text-[17px] font-semibold" style={{ background: C.lime, color: C.ink }}>Create my game</button>
          <p className="text-center text-[13px] leading-snug" style={{ color: C.muted }}>{PRICING_LINE}</p>
        </section>
      </main>
    </div>
  );
}

function DemoStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
        <span className="grid h-6 w-6 place-items-center rounded-full text-[12px] font-bold" style={{ background: C.ink, color: C.lime }}>{n}</span>{title}
      </h2>
      {children}
    </section>
  );
}

function DemoStepper({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border bg-white px-3 py-2" style={{ borderColor: C.line }}>
      <span className="text-[14px]" style={{ color: C.muted }}>{label}</span>
      <span className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: '#eef1e8' }}>−</span>
        <b key={String(value)} className="demo-pop min-w-6 text-center text-[16px]">{value}</b>
        <span aria-label={`More ${label}`} className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: '#eef1e8' }}>+</span>
      </span>
    </div>
  );
}
