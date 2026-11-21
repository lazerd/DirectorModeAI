'use client';

/**
 * /racquetsirl (and /play/demo): a Friday night that runs itself, on three phones.
 *
 * Host (Jordan) · the group chat · a player (Maya). The screens inside the
 * phones are the real event screens (EventCard, OpenView, LiveView, DoneView,
 * HostPanel, StatusSheet) fed by a local engine (lib/play/demo.ts) instead of
 * the API. The tour drives it; a visitor can grab any phone and it still works.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Loader2, Pause, Play, RotateCcw, Sparkles } from 'lucide-react';
import { standings } from '@/lib/mixer/guestMixer';
import { parseSentence, whenLine, type PlayDraft, type PlayEvent } from '@/lib/play/core';
import { DEMO_BRAND, DEMO_SPORTS, DEMO_TAGLINE, HOST, isDemoSport, type DemoSport, ME, apply, courtOf, demoDraft, makeEvent, nextFriday, rng, simScore, type Act } from '@/lib/play/demo';
import { DoneView, EventCard, HostPanel, LiveView, OpenView, StatusSheet, type Res } from './EventClient';
import EventPicker from './EventPicker';
import { PlaceMap } from './PlacePicker';
import { BrandContext, C, PlayHeader } from './shared';

type PhoneId = 'host' | 'chat' | 'maya';
type Msg = { id: number; from: string; text?: string; link?: { title: string; sub: string }; card?: { name: string; tag: string; line: string } };

const CHAPTERS = [
  { t: 'Say it once.', d: 'The host types one sentence. It becomes a real event: when, where, how many, which courts, what level, and a format that fills every court.' },
  { t: 'Drop one link.', d: 'No app to download and no accounts to make. The link goes where the group already talks: the group chat.' },
  { t: 'Everyone taps in.', d: 'Five seconds a player. The page fills itself, and an announcer writes a line for every name that taps in.' },
  { t: 'Know who’s coming.', d: 'Tap Status: who’s in, who hasn’t answered, and a one-tap nudge with their names in it. Nobody has to keep a list.' },
  { t: 'Courts in one tap.', d: 'At the courts the host taps Start. Every phone lights up with its court, its partner and its opponents. No clipboard, no shouting.' },
  { t: 'Scores from any phone.', d: 'Players punch in their own scores. The leaderboard moves live, and the next round builds itself with fresh partners.' },
  { t: 'Then it calls the game.', d: 'A sportscaster writes up the night from the real scores, with a line for every player that they actually want to share.' },
  { t: 'Run it back.', d: 'One tap books next Friday, and everyone who played is one tap from in. That’s the habit that keeps a group alive.' },
];

/* ---------------- tour state ---------------- */
interface Tour {
  sport: DemoSport; e: PlayEvent; hostId: string | null; mayaId: string | null;
  host: 'compose' | 'event'; compose: string; draft: PlayDraft | null; tidy: boolean; hostName: string; banner: boolean;
  maya: 'lock' | 'event';
  notif: { phone: PhoneId; title: string; body: string; k: number } | null;
  chat: Msg[]; typing: string | null;
  chapter: number; beat: string; focus: PhoneId;
  sheet: boolean; hostTab: 'courts' | 'table'; mayaTab: 'courts' | 'table';
  busyHost: string; busyMaya: string;
  tap: { phone: PhoneId; x: number; y: number; k: number } | null;
  toast: { phone: PhoneId; text: string; k: number } | null;
  next: number | null; ended: boolean;
}
const fresh = (sport: DemoSport = 'tennis'): Tour => ({
  sport, e: makeEvent(demoDraft(new Date(), sport)), hostId: null, mayaId: null,
  host: 'compose', compose: '', draft: null, tidy: false, hostName: '', banner: false,
  maya: 'lock',
  notif: null, chat: [], typing: null,
  chapter: -1, beat: '', focus: 'host',
  sheet: false, hostTab: 'courts', mayaTab: 'courts', busyHost: '', busyMaya: '',
  tap: null, toast: null, next: null, ended: false,
});

const CANCEL = Symbol('cancel');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function DemoTour() {
  const S = useRef<Tour>(fresh());
  const [, force] = useReducer((x: number) => x + 1, 0);
  const set = useCallback((p: Partial<Tour> | ((t: Tour) => Partial<Tour>)) => {
    S.current = { ...S.current, ...(typeof p === 'function' ? p(S.current) : p) };
    force();
  }, []);
  const [paused, setPaused] = useState(false);
  const [driving, setDriving] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [picked, setPicked] = useState<PhoneId | null>(null); // mobile: a phone the visitor chose
  const sportRef = useRef<DemoSport>('tennis');
  const ctl = useRef({ run: 0, ff: -1, paused: false, speed: 1 });
  ctl.current.paused = paused; ctl.current.speed = speed;
  const phones = useRef<Record<PhoneId, { screen: HTMLDivElement | null; scroller: HTMLDivElement | null }>>({ host: { screen: null, scroller: null }, chat: { screen: null, scroller: null }, maya: { screen: null, scroller: null } });
  const scale = useRef<Record<PhoneId, number>>({ host: 0.7, chat: 0.7, maya: 0.7 });
  const msgId = useRef(0);

  /* ---------- the engine, as each phone sees it ---------- */
  const view = (who: 'host' | 'maya', t = S.current): PlayEvent => ({ ...t.e, isHost: who === 'host', me: who === 'host' ? t.hostId : t.mayaId });
  const run = (b: Act) => { const r = apply(S.current.e, b); set({ e: r.e }); return r; };
  const actFor = (who: 'host' | 'maya') => async (b: Record<string, unknown>, label?: string): Promise<Res | undefined> => {
    const busyKey = who === 'host' ? 'busyHost' : 'busyMaya';
    set({ [busyKey]: label ?? String(b.action) } as Partial<Tour>);
    await sleep(b.action === 'recap' ? 1400 : 220);
    set({ [busyKey]: '' } as Partial<Tour>);
    if (b.action === 'runback') { if (ctl.current.paused) say('host', 'Next Friday is booked. In the tour, watch the crew pile back in.'); return { event: view(who) }; }
    if (b.action === 'watch') return { event: view(who) };
    if (b.action === 'recap_me') b = { ...b, me: view(who).me };
    const r = run(b as Act);
    if (b.action === 'join' && who === 'maya' && r.id) set({ mayaId: r.id });
    return { event: view(who) };
  };

  /* ---------- tour primitives ---------- */
  const say = (phone: PhoneId, text: string) => set({ toast: { phone, text, k: Date.now() } });
  const post = (m: Omit<Msg, 'id'>) => set((t) => ({ chat: [...t.chat, { ...m, id: ++msgId.current }], typing: null }));

  const startTour = useCallback((from = 0) => {
    const id = ++ctl.current.run;
    ctl.current.ff = from;
    S.current = fresh(sportRef.current);
    const K = DEMO_SPORTS[sportRef.current], E = K.emoji; msgId.current = 0; force();
    setDriving(false); setPaused(false); setPicked(null);
    const live = () => { if (ctl.current.run !== id) throw CANCEL; };
    const ff = () => S.current.chapter < ctl.current.ff;
    const wait = async (ms: number) => {
      live();
      if (ff()) return;
      let left = ms;
      while (left > 0) { await sleep(80); live(); if (!ctl.current.paused) left -= 80 * ctl.current.speed; }
    };
    const P = (p: PhoneId) => phones.current[p];
    const find = (p: PhoneId, q: string): HTMLElement | null => {
      const root = P(p).screen; if (!root) return null;
      if (q.startsWith('any:')) {
        const want = q.slice(4).toLowerCase();
        return ([...root.querySelectorAll('div, span, h2, b')] as HTMLElement[]).reverse().find((x) => (x.textContent ?? '').toLowerCase().startsWith(want)) ?? null;
      }
      if (q.startsWith('text:')) {
        const want = q.slice(5).toLowerCase();
        return ([...root.querySelectorAll('button, a')] as HTMLElement[]).find((x) => (x.textContent ?? '').toLowerCase().includes(want)) ?? null;
      }
      return root.querySelector(q) as HTMLElement | null;
    };
    const scrollTo = async (p: PhoneId, q: string | 'top' | 'bottom', where: 'center' | 'start' = 'center') => {
      if (ff()) return;
      await sleep(30);
      const sc = P(p).scroller; if (!sc) return;
      if (q === 'top' || q === 'bottom') { sc.scrollTo({ top: q === 'top' ? 0 : sc.scrollHeight, behavior: 'smooth' }); await wait(500); return; }
      const el = find(p, q); if (!el) return;
      const s = scale.current[p], a = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
      const d = where === 'start' ? (a.top - b.top) / s - 70 : (a.top - b.top) / s - (b.height / s) / 2 + (a.height / s) / 2;
      sc.scrollTo({ top: sc.scrollTop + d, behavior: 'smooth' });
      await wait(650);
    };
    const tap = async (p: PhoneId, q: string) => {
      if (ff()) return;
      let el = find(p, q); if (!el) return;
      const sc = P(p).scroller, s = scale.current[p];
      if (sc) { const a = el.getBoundingClientRect(), b = sc.getBoundingClientRect(); if (a.top < b.top + 40 || a.bottom > b.bottom - 40) { await scrollTo(p, q); el = find(p, q) ?? el; } }
      const scr = P(p).screen!.getBoundingClientRect(), r = el.getBoundingClientRect();
      set({ tap: { phone: p, x: (r.left - scr.left + r.width / 2) / s, y: (r.top - scr.top + r.height / 2) / s, k: Date.now() } });
      await wait(520);
    };
    const type = async (setText: (v: string) => void, text: string, cps = 34) => {
      if (ff()) { setText(text); return; }
      for (let i = 1; i <= text.length; i++) { setText(text.slice(0, i)); await wait(1000 / cps); }
    };
    const chapter = (i: number) => { set({ chapter: i, toast: null }); if (i >= ctl.current.ff) ctl.current.ff = -1; setPicked(null); };
    const beat = (b: string, focus?: PhoneId) => set(focus ? { beat: b, focus } : { beat: b });
    const typing = async (who: string, ms = 900) => { set({ typing: who }); await wait(ms); };
    const joinAs = (name: string) => run({ action: 'join', name }).id!;
    const hype = () => run({ action: 'hype' });
    const r = rng(20261120);
    const scoreRound = async (opts: { maya?: boolean; gap: number }) => {
      const t = S.current, rd = t.e.state.mixer!.rounds.at(-1)!;
      const mine = courtOf(t.e, t.mayaId);
      const order = [...rd.matches].sort((a, b) => (a.court === mine?.court ? -1 : b.court === mine?.court ? 1 : a.court - b.court));
      const nm = (id: string) => first(t.e.state.mixer!.players.find((p) => p.id === id)?.name ?? '');
      for (const x of order) {
        let [a, b] = simScore(S.current.e, x.teamA, x.teamB, r);
        const isMine = x.court === mine?.court;
        if (isMine && t.mayaId) { const mayaA = x.teamA.includes(t.mayaId); const w = K.win, l = K.mayaLose(r); [a, b] = mayaA ? [w, l] : [l, w]; } // the tour follows Maya's good night
        if (isMine && opts.maya && !ff()) {
          beat('Maya enters her court’s score herself: a few taps, Save.', 'maya');
          set({ mayaTab: 'courts' });
          const card = ([...(P('maya').screen?.querySelectorAll('button') ?? [])] as HTMLElement[]).find((y) => y.textContent === 'Enter score' && y.parentElement?.textContent?.includes('You'))?.parentElement;
          const btn = card ? ([...card.querySelectorAll('button')] as HTMLElement[]).find((y) => y.textContent === 'Enter score') : null;
          if (card && btn) {
            await scrollTo('maya', '[style*="outline"]');
            await tapEl('maya', btn); btn.click(); await wait(350);
            for (const [side, n] of [[0, a], [1, b]] as const) for (let i = 0; i < n; i++) {
              const plus = () => ([...card.querySelectorAll('button[aria-label="plus"]')] as HTMLElement[])[side];
              if (!plus()) break;
              await tapEl('maya', plus(), 0.45); plus()?.click(); await wait(110);
            }
            const save = ([...card.querySelectorAll('button')] as HTMLElement[]).find((y) => y.textContent === 'Save score');
            if (save) { await tapEl('maya', save); save.click(); }
            await wait(600);
          }
          const now = S.current.e.state.mixer!.rounds.at(-1)!.matches.find((y) => y.court === x.court);
          if (now?.scoreA == null) run({ action: 'score', round: rd.number, court: x.court, a, b });
          beat(`Court ${x.court} is in. Jordan’s phone got it the same second.`, 'host');
          await scrollTo('host', `any:Court ${x.court}`, 'start');
          await wait(1400);
        } else {
          run({ action: 'score', round: rd.number, court: x.court, a, b });
          if (!isMine) beat(`Court ${x.court}: ${x.teamA.map(nm).join(' & ')} ${a}, ${x.teamB.map(nm).join(' & ')} ${b}. Entered from ${nm(x.teamA[0])}’s phone.`);
          await wait(opts.gap);
        }
      }
    };
    const tapEl = async (p: PhoneId, el: HTMLElement, hold = 1) => {
      const s = scale.current[p], scr = P(p).screen!.getBoundingClientRect(), rr = el.getBoundingClientRect();
      set({ tap: { phone: p, x: (rr.left - scr.left + rr.width / 2) / s, y: (rr.top - scr.top + rr.height / 2) / s, k: Date.now() + Math.random() } });
      await wait(420 * hold);
    };
    const roundAlert = (n: number) => {
      const t = S.current, x = courtOf(t.e, t.mayaId);
      if (!x || !t.mayaId) return;
      const mine = x.teamA.includes(t.mayaId) ? x.teamA : x.teamB, them = mine === x.teamA ? x.teamB : x.teamA;
      const nm = (id: string) => first(t.e.state.mixer!.players.find((p) => p.id === id)?.name ?? '');
      set({ notif: { phone: 'maya', title: `${DEMO_BRAND} · Round ${n}`, body: `You’re on Court ${x.court} with ${mine.filter((i) => i !== t.mayaId).map(nm).join('')}. vs ${them.map(nm).join(' & ')}. Go!`, k: Date.now() } });
    };
    const clock = (minsLeft: number) => set((t) => ({ e: { ...t.e, state: { ...t.e.state, roundStartedAt: new Date(Date.now() - (t.e.round_minutes - minsLeft) * 60e3).toISOString() } } }));

    (async () => {
      /* 1 · Say it once */
      chapter(0);
      beat('Jordan has a Friday group and three courts. Watch what one sentence does.', 'host');
      await wait(1600);
      await type((v) => set({ compose: v }), K.sentence);
      await wait(500);
      await tap('host', '[aria-label="Make it"]');
      const parsed = parseSentence(K.sentence);
      set({ draft: { ...parsed, starts_at: nextFriday().toISOString() }, tidy: true });
      beat(`It reads the sentence: ${K.read}.`);
      await wait(2200);
      set({ draft: demoDraft(new Date(), sportRef.current), tidy: false });
      beat('Then it tidies the title and picks the format: Optimize Courts, so every court is full and nobody sits.');
      await scrollTo('host', '[data-demo="picker"]', 'start');
      await wait(2600);
      await scrollTo('host', '[aria-label="Your name"]');
      await type((v) => set({ hostName: v }), 'Jordan', 12);
      await tap('host', 'text:Make my link');
      const hid = joinAs(HOST);
      set({ hostId: hid, host: 'event', banner: true });
      await sleep(40);
      P('host').scroller?.scrollTo({ top: 0 });
      beat('Done. One link. That’s the whole setup.');
      await wait(2200);

      /* 2 · Drop one link */
      chapter(1);
      await tap('host', 'text:WhatsApp');
      const when = whenLine(S.current.e) ?? 'Friday 6pm';
      post({ from: 'Jordan', text: `Friday night ${K.label === 'Tennis' ? '' : K.label.toLowerCase() + ' '}mixer, who's in? ${E}\nTap to join 👇`, link: { title: S.current.e.title, sub: `${when} · ${K.place} · ${K.level} · 12 spots` } });
      beat('Jordan drops it in the group chat.', 'chat');
      await wait(1600);
      await typing('Priya'); post({ from: 'Priya', text: 'IN 🙋‍♀️' }); joinAs('Priya S');
      await wait(700);
      await typing('Marcus'); post({ from: 'Marcus', text: 'do I need to download something' });
      await wait(900);
      post({ from: 'Jordan', text: 'nope. tap it, type your name, done' });
      await wait(700);
      await typing('Marcus', 700); joinAs('Marcus W'); post({ from: 'Marcus', text: 'ok that was stupid easy. in' });
      hype();
      await wait(1500);

      /* 3 · Everyone taps in */
      chapter(2);
      set({ notif: { phone: 'maya', title: K.crew, body: `Jordan: Friday night mixer, who’s in? ${E} Tap to join…`, k: Date.now() } });
      beat('Maya sees it on her lock screen.', 'maya');
      await wait(2000);
      await tap('maya', '[data-demo="lock-notif"]');
      set({ maya: 'event', notif: null });
      await wait(1400);
      beat('She lands on the game. No app store, no sign-up, no password.');
      await scrollTo('maya', '[aria-label="Your name"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      await type((v) => { const inp = find('maya', '[aria-label="Your name"]') as HTMLInputElement | null; if (inp) { setter?.call(inp, v); inp.dispatchEvent(new Event('input', { bubbles: true })); } }, ME, 14);
      await tap('maya', 'text:I’m in');
      set({ mayaId: joinAs(ME) }); hype();
      await sleep(40); P('maya').scroller?.scrollTo({ top: 0, behavior: 'smooth' });
      beat('Five seconds. She’s in, and the announcer already has a line about her.');
      await wait(2200);
      await scrollTo('maya', '[data-demo="tape"]', 'start');
      await wait(1600);
      beat('Meanwhile the rest of the crew taps in from their own phones.', 'host');
      await scrollTo('host', '[data-demo="tape"]', 'start');
      const rest: [string, string | null][] = [['Dev K', 'in'], ['Elena R', null], ['Chris T', 'just here for the exercise'], ['Sofia M', null], ['Tom B', 'I’ll bring balls'], ['Aisha J', '🙌']];
      for (const [name, says] of rest) {
        joinAs(name); hype();
        if (says) post({ from: first(name), text: says });
        await wait(900);
      }
      beat('Every name that taps in gets a line. The invite is the entertainment.');
      await wait(2400);

      /* 4 · Know who's coming */
      chapter(3);
      P('host').scroller?.scrollTo({ top: 0, behavior: 'smooth' });
      beat('10 of 12. Who’s missing? Jordan taps Status.', 'host');
      await wait(1500);
      await tap('host', '[aria-label="Game status"]');
      set({ sheet: true });
      await wait(900);
      beat('Who’s in, and who hasn’t tapped yet (from the names in the notes): Ben and Lauren.');
      await wait(3000);
      await tap('host', '[role="dialog"] a[href*="wa.me"]');
      post({ from: 'Jordan', text: `${E} ${S.current.e.title} · ${when}\nStill need a tap from Ben, Lauren 👀\nTap "I'm in" on the link above ☝️` });
      set({ sheet: false });
      beat('One tap sends the nudge, with their names in it.', 'chat');
      await wait(1500);
      await typing('Ben'); post({ from: 'Ben', text: 'sorry!! in' }); joinAs('Ben H'); hype();
      await wait(700);
      await typing('Lauren', 700); post({ from: 'Lauren', text: 'in in in' }); joinAs('Lauren G'); hype();
      beat('12 of 12. Full, with a waitlist if anyone else wants in.', 'host');
      P('host').scroller?.scrollTo({ top: 0, behavior: 'smooth' });
      await wait(2600);

      /* 5 · Courts in one tap */
      chapter(4);
      beat('Friday, 6:02pm, at the courts. Jordan taps Start.', 'host');
      await wait(1200);
      await tap('host', "text:We're here. Start");
      run({ action: 'start' }); set({ banner: false });
      await sleep(40); P('host').scroller?.scrollTo({ top: 0 }); P('maya').scroller?.scrollTo({ top: 0 });
      roundAlert(1);
      beat('Every phone buzzes with its court. Fresh partners, nobody sitting.', 'maya');
      await wait(3200);
      set({ notif: null });
      beat('Jordan sees all three courts at once.', 'host');
      await scrollTo('host', 'any:Court 1', 'start');
      post({ from: 'Dev', text: 'court 1 let’s gooo' });
      await wait(2400);

      /* 6 · Scores from any phone */
      chapter(5);
      clock(6);
      await scoreRound({ maya: true, gap: 1500 });
      set({ hostTab: 'table' });
      await scrollTo('host', '[role="tablist"], table', 'start');
      beat('The leaderboard moves as each court comes in.', 'host');
      await wait(2400);
      set({ hostTab: 'courts' });
      P('host').scroller?.scrollTo({ top: 0, behavior: 'smooth' });
      await wait(500);
      await tap('host', 'text:Next round');
      run({ action: 'next' }); roundAlert(2);
      beat('Next round builds itself: new partners, new opponents, nobody repeats.', 'maya');
      await wait(2600);
      set({ notif: null });
      clock(3);
      await scoreRound({ gap: 900 });
      await tap('host', 'text:Next round');
      run({ action: 'next' }); roundAlert(3);
      { const me = standings(S.current.e.state.mixer!).find((x) => x.id === S.current.mayaId); beat(`Round 3. Last one. Maya is ${me?.wins ?? 0}–${me?.losses ?? 0}.`, 'maya'); }
      await wait(2000); set({ notif: null });
      clock(1);
      await scoreRound({ gap: 700 });
      set({ mayaTab: 'table' });
      { const rank = standings(S.current.e.state.mixer!).findIndex((x) => x.id === S.current.mayaId) + 1; beat(rank === 1 ? 'Maya checks the table. Top of it.' : `Maya checks the table: number ${rank}, live.`, 'maya'); }
      await scrollTo('maya', 'table', 'start');
      await wait(2600);

      /* 7 · Then it calls the game */
      chapter(6);
      beat('Jordan ends the night.', 'host');
      P('host').scroller?.scrollTo({ top: 0, behavior: 'smooth' });
      await tap('host', 'text:End + recap');
      run({ action: 'end' });
      await sleep(40); P('host').scroller?.scrollTo({ top: 0 }); P('maya').scroller?.scrollTo({ top: 0 });
      await wait(700);
      await tap('host', 'text:Club');
      set({ busyHost: 'recap' });
      beat('The sportscaster writes it up from the real scores…');
      await wait(1600);
      run({ action: 'recap', spice: 'club' }); set({ busyHost: '' });
      beat('…with a headline, the story of the night, and a line for every single player.');
      await wait(2600);
      await scrollTo('host', '.font-serif', 'start');
      await wait(2400);
      const mine = S.current.e.state.recap?.lines.find((l) => l.id === S.current.mayaId);
      beat('On Maya’s phone: her line, ready to share.', 'maya');
      await scrollTo('maya', 'text:Share my card', 'center');
      await wait(2400);
      await tap('maya', 'text:Share my card');
      if (mine) post({ from: 'Maya', card: { name: ME, tag: mine.tag, line: mine.line } });
      beat('And that’s how the next group hears about it.', 'chat');
      await wait(1400);
      await typing('Chris'); post({ from: 'Chris', text: 'framing this 😂' });
      await wait(600);
      await typing('Priya', 600); post({ from: 'Priya', text: 'rematch. next friday.' });
      await wait(1800);

      /* 8 · Run it back */
      chapter(7);
      beat('Jordan books next Friday in one tap.', 'host');
      await tap('host', 'text:Run it back');
      say('host', 'Next Friday is up. Same crew, one tap each.');
      await wait(1200);
      const nf = nextFriday(new Date(), 1).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      post({ from: 'Jordan', text: `Same time next week? ${E}`, link: { title: S.current.e.title, sub: `${nf}, 6 PM · ${K.place} · 12 spots` } });
      set({ next: 1 });
      beat('The crew piles back in before anyone’s left the parking lot.', 'chat');
      for (const [nm, says] of [['Priya', 'in'], ['Maya', 'obviously'], ['Dev', 'in'], ['Marcus', 'in'], ['Chris', null], ['Elena', 'in!'], ['Aisha', null], ['Tom', 'bringing balls again'], ['Sofia', null]] as [string, string | null][]) {
        set((t) => ({ next: (t.next ?? 0) + 1 }));
        if (says) post({ from: nm, text: says });
        await wait(650);
      }
      beat('Next Friday: 10 of 12 in, and nobody had to organize anything.');
      await wait(2400);
      set({ ended: true });
    })().catch((x) => { if (x !== CANCEL) console.error('[demo]', x); });
  }, [set]);

  const [sport, setSport] = useState<DemoSport>('tennis');
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('sport');
    if (isDemoSport(q)) { sportRef.current = q; setSport(q); }
    const id = setTimeout(() => startTour(0), 600); return () => { clearTimeout(id); ctl.current.run++; };
  }, [startTour]);
  const pickSport = (x: DemoSport) => {
    if (x === sportRef.current) return;
    sportRef.current = x; setSport(x);
    const u = new URL(location.href); if (x === 'tennis') u.searchParams.delete('sport'); else u.searchParams.set('sport', x);
    history.replaceState(null, '', u.toString());
    startTour(0);
  };

  /*
   * ---------- layout: all three phones, always (Darrin 11/21/26) ----------
   * The point is seeing the host, the group chat and a player react at the same
   * moment, so the three phones are always on screen together.
   * wide (>= 1024px): narrator column on the left, three equal phones.
   * narrower: narrator on top, three phones in a row; the phone where the action
   *           is (or the one the visitor tapped) is bigger, the other two stay
   *           visible beside it and shrink, with a smooth resize as focus moves.
   * ph: the phone's unscaled height; a short window gets a shorter phone rather
   *     than one that runs off the bottom.
   */
  const stage = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  const [dims, setDims] = useState<{ W: number; H: number }>({ W: 1440, H: 900 });
  useLayoutEffect(() => {
    const fit = () => setDims({ W: window.innerWidth, H: window.innerHeight });
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit);
  }, []);
  const t = S.current;
  const shown: PhoneId = picked ?? t.focus;
  const { scales, ph } = (() => {
    const { W, H } = dims;
    const isWide = W >= 1024;
    if (isWide) {
      const stageW = Math.min(W, 1500) - 32 - 340 - 24;
      const avail = H - 74 - 44 - 20; // header, phone labels, breathing room
      const sEq = Math.max(0.3, Math.min(0.86, (stageW - 48) / (3 * 414), avail / 640));
      return { scales: { host: sEq, chat: sEq, maya: sEq } as Record<PhoneId, number>, ph: Math.round(Math.min(868, Math.max(560, avail / sEq))) };
    }
    // Phones and tablets (mobile first, Darrin 11/21/26): three EQUAL phones side by side,
    // all running at once, even if they're small. The one with the action gets the lime ring.
    const gap = 6;
    const sEq = (W - 12 - 2 * gap) / (3 * 414);
    const avail = H - 54 - 150 - 24; // header, narrator, labels
    const h = Math.round(Math.min(1100, Math.max(640, avail / sEq))); // small phones can be a bit taller to use the screen
    const s1 = Math.min(sEq, avail / h);
    return { scales: { host: s1, chat: s1, maya: s1 } as Record<PhoneId, number>, ph: h };
  })();
  useLayoutEffect(() => { setWide(dims.W >= 1024); scale.current = scales; });
  const grab = (x: React.PointerEvent) => { if (x.isTrusted && !t.ended && !paused) { setPaused(true); setDriving(true); } };
  const stopLinks = (p: PhoneId) => (x: React.MouseEvent) => {
    const a = (x.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('/play') && !href.startsWith('/play/demo')) return; // "Host your own" is real
    x.preventDefault(); x.stopPropagation();
    say(p, /wa\.me/.test(href) ? 'In a real game this opens WhatsApp with the message ready to send.' : /^sms:/.test(href) ? 'In a real game this opens Messages with the text ready.' : /calendar/.test(href) ? 'In a real game this adds it to your calendar.' : 'In a real game this opens the link.');
  };
  const progress = t.chapter < 0 ? 0 : t.ended ? 100 : ((t.chapter + 0.5) / CHAPTERS.length) * 100;

  const phone = (id: PhoneId, label: string, sub: string, body: React.ReactNode, overlay?: React.ReactNode) => {
    const sc = scales[id];
    const small = false; // all three phones are full, live phones at every size
    return (
    <div key={id} className="flex flex-col items-center">
      {wide ? (
        <div className="mb-2 text-center">
          <div className="text-[13px] font-semibold" style={{ color: t.focus === id ? C.lime : '#e9efe6' }}>{label}</div>
          <div className="text-[11px]" style={{ color: '#9fb3a6' }}>{sub}</div>
        </div>
      ) : (
        <div className="mb-1 max-w-full truncate px-1 text-[11px] font-semibold" style={{ color: t.focus === id ? C.lime : '#cfdccb' }}>{label.split(' · ')[0]}</div>
      )}
      <div style={{ width: 414 * sc, height: ph * sc, transition: 'width 450ms ease, height 450ms ease' }} className="relative"
        onPointerDownCapture={small ? undefined : grab} onClickCapture={small ? (x) => { x.preventDefault(); x.stopPropagation(); setPicked(id); } : stopLinks(id)}>
        {small && <button type="button" aria-label={`Show ${label}`} onClick={() => setPicked(id)} className="absolute inset-0 z-[60] rounded-[18px]" />}
        <div className="absolute left-0 top-0 origin-top-left rounded-[58px] p-3"
          style={{ width: 414, height: ph, transform: `scale(${sc})`, transition: 'transform 450ms ease, box-shadow 500ms', background: '#0b0d0c', boxShadow: t.focus === id ? `0 0 0 ${wide ? 3 : 9}px ${C.lime}, 0 30px 80px #000a` : '0 0 0 1px #2a2f2c, 0 30px 80px #0008' }}>
          <div ref={(el) => { phones.current[id].screen = el; }} className="relative h-full w-full overflow-hidden rounded-[46px]" style={{ transform: 'translateZ(0)', background: C.paper }}>
            <div className="absolute inset-x-0 top-0 z-30 flex h-11 items-center justify-between px-8 text-[14px] font-semibold"
              style={id === 'chat' ? { color: '#fff', background: '#0b6b5a' } : id === 'maya' && t.maya === 'lock' ? { color: '#fff' } : { color: C.ink, background: C.paper }}>
              <span>{t.chapter >= 4 ? '6:02' : '5:14'}</span><span className="absolute left-1/2 top-2 h-7 w-28 -translate-x-1/2 rounded-full bg-black" /><span className="tracking-tighter">▂▄▆ ▮</span>
            </div>
            <div ref={(el) => { phones.current[id].scroller = el; }} className="demo-scroll absolute inset-0 overflow-y-auto overscroll-contain pt-11">{body}</div>
            {overlay}
            {t.notif?.phone === id && t.maya !== 'lock' && (
              <div key={t.notif.k} className="demo-drop absolute inset-x-3 top-12 z-40 rounded-2xl p-3 shadow-xl" style={{ background: '#ffffffee', backdropFilter: 'blur(8px)' }}>
                <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: C.muted }}><Logo s={18} />{t.notif.title}<span className="ml-auto font-normal">now</span></div>
                <div className="mt-1 text-[15px] font-semibold leading-snug" style={{ color: C.ink }}>{t.notif.body}</div>
              </div>
            )}
            {t.toast?.phone === id && <div key={t.toast.k} className="demo-toast absolute inset-x-4 bottom-6 z-40 rounded-2xl px-4 py-3 text-center text-[14px] font-semibold text-white shadow-xl" style={{ background: C.ink }}>{t.toast.text}</div>}
            {t.tap?.phone === id && <span key={t.tap.k} className="demo-tap pointer-events-none absolute z-50" style={{ left: t.tap.x, top: t.tap.y }} />}
          </div>
        </div>
      </div>
    </div>
    );
  };

  const hostBody = t.host === 'compose'
    ? <Compose t={t} />
    : <EventScreen e={view('host')} act={actFor('host')} busy={t.busyHost} tab={t.hostTab} setTab={(x) => set({ hostTab: x })} sheet={t.sheet} setSheet={(v) => set({ sheet: v })} banner={t.banner} />;
  const mayaBody = t.maya === 'lock'
    ? <Lock t={t} />
    : <EventScreen e={view('maya')} act={actFor('maya')} busy={t.busyMaya} tab={t.mayaTab} setTab={(x) => set({ mayaTab: x })} sheet={false} setSheet={() => {}} />;
  const all = {
    host: phone('host', 'Jordan · the host', 'one phone runs the night', hostBody),
    chat: phone('chat', 'The group chat', 'where the link lives', <Chat t={t} onScroll={phones.current.chat} />),
    maya: phone('maya', 'Maya · a player', 'never downloaded a thing', mayaBody),
  };

  return (
    <BrandContext.Provider value={DEMO_BRAND}>
      <style>{CSS}</style>
      <div className="min-h-screen" style={{ background: '#07231c', color: '#e9efe6' }}>
        <div className="h-1 w-full bg-white/10"><div className="h-full transition-all duration-700" style={{ width: `${progress}%`, background: C.lime }} /></div>
        <header className={`mx-auto flex max-w-[1500px] items-center justify-between gap-3 ${wide ? 'px-5 py-3' : 'px-3 py-2'}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo s={wide ? 30 : 26} />
            <div className="min-w-0 leading-tight"><div className={`${wide ? 'text-[18px]' : 'text-[16px]'} font-semibold tracking-tight`}>{DEMO_BRAND}</div>
              <div className="truncate text-[11px]" style={{ color: '#9fb3a6' }}>{DEMO_TAGLINE}</div></div>
          </div>
          {wide && <SportPills sport={sport} onPick={pickSport} />}
          <Link href="/play/new" style={{ background: C.lime, color: C.ink }} className={`shrink-0 whitespace-nowrap rounded-full font-semibold ${wide ? 'px-4 py-2 text-[14px]' : 'px-3 py-1.5 text-[13px]'}`}>{wide ? 'Host your own' : 'Try it'} <ArrowRight className="inline h-4 w-4" /></Link>
        </header>

        <div className={`mx-auto max-w-[1500px] ${wide ? 'grid grid-cols-[340px_1fr] gap-6 px-4 pb-10' : 'px-2 pb-3'}`}>
          <Narrator t={t} wide={wide} paused={paused} driving={driving} speed={speed} pills={!wide && <SportPills sport={sport} onPick={pickSport} small />}
            onToggle={() => { setPaused((v) => !v); setDriving(false); }} onRestart={() => startTour(0)} onSpeed={() => setSpeed((v) => (v === 1 ? 2 : 1))} onJump={(i) => startTour(i)} />
          <div ref={stage} className="relative">
            <div className={`flex items-start justify-center ${wide ? 'gap-6' : 'gap-1.5'}`}>{[all.host, all.chat, all.maya]}</div>

            {t.ended && <EndCard onReplay={() => startTour(0)} />}
          </div>
        </div>
        <footer className="pb-4 pt-1 text-center text-[11px]">
          <Link href="/platform" style={{ color: '#9fb3a6' }} className="underline-offset-2 hover:underline">See all the tools ClubMode has to offer &rarr;</Link>
        </footer>
      </div>
    </BrandContext.Provider>
  );
}

const first = (n: string) => n.split(' ')[0];

/* ---------------- screens ---------------- */
function EventScreen({ e, act, busy, tab, setTab, sheet, setSheet, banner }: {
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
        <EventCard e={e} onStatus={() => setSheet(true)} />
        <div data-demo="tape-anchor" />
        {e.status === 'open' && <OpenView e={e} meName={meR?.name} busy={busy} act={act} code="demo" />}
        {e.status === 'live' && <LiveView e={e} tab={tab} setTab={setTab} busy={busy} act={act} canScore={e.isHost || !!e.me} code="demo" />}
        {e.status === 'done' && <DoneView e={e} busy={busy} act={act} code="demo" myName={meR?.name} />}
        {e.status === 'open' && <PlaceMap e={e} className="mt-6" />}
        {e.isHost && <HostPanel e={e} busy={busy} act={act} hostKey={null} />}
        {sheet && <StatusSheet e={e} busy={busy} act={act} hostKey={e.isHost ? 'demo-host-link' : null} onClose={() => setSheet(false)} />}
      </main>
    </div>
  );
}

function Compose({ t }: { t: Tour }) {
  const d = t.draft;
  return (
    <div className="min-h-full pb-16" style={{ background: C.paper, color: C.ink }}>
      <PlayHeader right={<span className="text-xs" style={{ color: C.muted }}>Tennis · Pickleball · Padel</span>} />
      <main className="px-5">
        {!d && (
          <section className="pt-6 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[2px]" style={{ color: C.muted }}>Racquet Sports. Together. In Real Life.</div>
            <h1 className="mt-4 text-[44px] font-medium leading-[1.02] tracking-[-2.5px]">Racquets IRL</h1>
            <p className="mx-auto mt-4 max-w-sm text-[15px] leading-relaxed" style={{ color: C.muted }}>Free to use. No login needed.</p>
          </section>
        )}
        <div className="mt-7 flex items-end gap-2 rounded-2xl border bg-white p-2 pl-4 shadow-sm" style={{ borderColor: C.line }}>
          <div className="min-h-[52px] flex-1 py-2 text-[16px]">{t.compose || <span style={{ color: '#8a978d' }}>e.g. Doubles Friday 6pm at Heather Farm, need 3 more</span>}{!d && <span className="demo-caret" />}</div>
          <span aria-label="Make it" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: C.ink }}>{t.tidy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}</span>
        </div>
        {d && (
          <section className="demo-pop mt-5 rounded-3xl p-5 text-white shadow-lg" style={{ background: C.ink }}>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[1.5px]" style={{ color: '#bccdbb' }}>
              <span>{d.sport} · rotating partners</span>{t.tidy && <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> tidying up…</span>}
            </div>
            <div key={d.title} className="demo-pop mt-2 text-[28px] font-medium leading-tight tracking-tight">{d.title}</div>
            <div className="mt-3 grid gap-1.5 text-[15px]">
              <div>🕕 {whenLine(d)}</div><div>📍 {d.location}</div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
              {[['Players', d.spots], ['Courts', d.courts], ['Sport', DEMO_SPORTS[t.sport].label], ['Level', d.level]].map(([k, v]) => (
                <div key={k as string} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: '#ffffff14' }}><span style={{ color: '#bccdbb' }}>{k}</span><b>{v}</b></div>
              ))}
            </div>
          </section>
        )}
        {d && <div data-demo="picker" className="pointer-events-none"><EventPicker value={d.format} spots={d.spots} courts={d.courts} onChange={() => {}} /></div>}
        {d && (
          <section className="mt-4 grid gap-3">
            <div aria-label="Your name" className="w-full rounded-xl border bg-white px-3 py-2.5 text-[16px]" style={{ borderColor: C.line }}>{t.hostName || <span style={{ color: '#8a978d' }}>Your first name</span>}</div>
            <button className="flex h-14 items-center justify-center rounded-2xl text-[17px] font-semibold" style={{ background: C.lime, color: C.ink }}>Make my link</button>
            <p className="text-center text-[12px]" style={{ color: C.muted }}>Your first event is free. Joining is always free.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function Lock({ t }: { t: Tour }) {
  const d = new Date();
  return (
    <div className="relative -mt-11 h-[844px] text-white" style={{ background: 'radial-gradient(120% 80% at 20% 10%, #2f6b56 0%, #0f3a2f 45%, #06150f 100%)' }}>
      <div className="pt-24 text-center">
        <div className="text-[17px] font-medium opacity-90">{d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <div className="text-[88px] font-semibold leading-none tracking-tight">5:14</div>
      </div>
      {t.notif?.phone === 'maya' && (
        <div key={t.notif.k} data-demo="lock-notif" className="demo-drop absolute inset-x-4 top-[300px] rounded-3xl p-4" style={{ background: '#ffffff2e', backdropFilter: 'blur(14px)' }}>
          <div className="flex items-center gap-2 text-[13px] font-semibold opacity-90"><span className="grid h-6 w-6 place-items-center rounded-md text-[13px]" style={{ background: '#25d366' }}>✆</span>{t.notif.title}<span className="ml-auto font-normal opacity-80">now</span></div>
          <div className="mt-1.5 text-[16px] leading-snug">{t.notif.body}</div>
        </div>
      )}
    </div>
  );
}

function Chat({ t, onScroll }: { t: Tour; onScroll: { scroller: HTMLDivElement | null } }) {
  useEffect(() => { onScroll.scroller?.scrollTo({ top: 99999, behavior: 'smooth' }); }, [t.chat.length, t.typing, t.next, onScroll]);
  const COLORS: Record<string, string> = { Priya: '#c2185b', Marcus: '#1565c0', Dev: '#6a1b9a', Chris: '#ef6c00', Tom: '#2e7d32', Aisha: '#00838f', Ben: '#5d4037', Lauren: '#ad1457', Maya: '#283593', Elena: '#00695c', Sofia: '#9e2a2b' };
  const lastLink = [...t.chat].reverse().find((m) => m.link)?.id;
  return (
    <div className="min-h-[800px]" style={{ background: '#efe7dd' }}>
      <div className="sticky top-0 z-20 flex items-center gap-3 px-4 pb-3 pt-2 text-white" style={{ background: '#0b6b5a' }}>
        <span className="text-[22px]">‹</span>
        <div className="grid h-10 w-10 place-items-center rounded-full text-[20px]" style={{ background: '#ffffff30' }}>{DEMO_SPORTS[t.sport].emoji}</div>
        <div className="leading-tight"><div className="text-[16px] font-semibold">{DEMO_SPORTS[t.sport].crew}</div><div className="text-[12px] opacity-80">{t.typing ? `${t.typing} is typing…` : 'Jordan, Priya, Marcus, Maya, Dev +7'}</div></div>
      </div>
      <div className="grid gap-1.5 px-3 py-4 text-[15px]">
        <div className="mx-auto mb-2 rounded-lg px-3 py-1 text-[12px]" style={{ background: '#fff8c4', color: '#5b5b4a' }}>Today</div>
        {t.chat.map((m) => {
          const mine = m.from === 'Jordan';
          return (
            <div key={m.id} className={`demo-msg flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[82%] rounded-2xl px-3 py-2 shadow-sm" style={{ background: mine ? '#d9fdd3' : '#fff', color: '#111b21', borderTopRightRadius: mine ? 4 : 16, borderTopLeftRadius: mine ? 16 : 4 }}>
                {!mine && <div className="text-[13px] font-semibold" style={{ color: COLORS[m.from] ?? '#333' }}>{m.from}</div>}
                {m.link && (
                  <div className="mb-1.5 overflow-hidden rounded-xl" style={{ background: '#f0f2f0' }}>
                    <div className="flex items-center gap-2 px-3 py-3" style={{ background: C.ink }}>
                      <Logo s={22} /><span className="text-[14px] font-semibold text-white">{DEMO_BRAND}</span>
                      {m.id === lastLink && t.next != null && <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: C.lime, color: C.ink }}>{t.next} of 12 in</span>}
                    </div>
                    <div className="px-3 py-2"><div className="text-[14px] font-semibold">{m.link.title}</div><div className="text-[12px]" style={{ color: '#667781' }}>{m.link.sub}</div></div>
                  </div>
                )}
                {m.card && (
                  <div className="mb-1 overflow-hidden rounded-xl p-3 text-white" style={{ background: C.ink }}>
                    <div className="text-[11px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.lime }}>🎙️ {m.card.name} · {m.card.tag}</div>
                    <div className="mt-1 text-[15px] font-medium leading-snug">{m.card.line}</div>
                    <div className="mt-2 text-[11px]" style={{ color: '#9fb3a6' }}>{DEMO_BRAND} · {t.e.title}</div>
                  </div>
                )}
                {m.text && <div className="whitespace-pre-line leading-snug">{m.text}</div>}
                <div className="mt-0.5 text-right text-[10px]" style={{ color: '#667781' }}>{mine ? <>5:{(10 + m.id).toString().padStart(2, '0')} <Check className="inline h-3 w-3 text-[#53bdeb]" /></> : `5:${(10 + m.id).toString().padStart(2, '0')}`}</div>
              </div>
            </div>
          );
        })}
        {t.typing && <div className="demo-msg flex"><div className="rounded-2xl bg-white px-4 py-3 shadow-sm"><span className="demo-dots"><i /><i /><i /></span></div></div>}
      </div>
    </div>
  );
}

/* ---------------- narrator + end card ---------------- */
function SportPills({ sport, onPick, small }: { sport: DemoSport; onPick: (s: DemoSport) => void; small?: boolean }) {
  return (
    <div role="tablist" aria-label="Sport" className={`flex shrink-0 gap-1 rounded-full bg-white/10 p-1 font-semibold ${small ? 'text-[12px]' : 'text-[13px]'}`}>
      {(['tennis', 'pickleball', 'padel'] as DemoSport[]).map((x) => (
        <button key={x} role="tab" aria-selected={sport === x} onClick={() => onPick(x)}
          className={`rounded-full ${small ? 'px-2.5 py-1' : 'px-3.5 py-1.5'}`} style={sport === x ? { background: C.lime, color: C.ink } : { color: '#cfe0d2' }}>
          {DEMO_SPORTS[x].label}
        </button>
      ))}
    </div>
  );
}

function Narrator({ t, wide, paused, driving, speed, pills, onToggle, onRestart, onSpeed, onJump }: {
  t: Tour; wide: boolean; paused: boolean; driving: boolean; speed: number; pills?: React.ReactNode; onToggle: () => void; onRestart: () => void; onSpeed: () => void; onJump: (i: number) => void;
}) {
  const ch = CHAPTERS[Math.max(0, t.chapter)];
  const controls = (
    <div className="flex items-center gap-2">
      <button onClick={onToggle} className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold" style={{ background: C.lime, color: C.ink }}>
        {paused ? <><Play className="h-4 w-4" />{driving ? 'Resume tour' : 'Play'}</> : <><Pause className="h-4 w-4" />Pause</>}
      </button>
      <button onClick={onSpeed} className="rounded-full bg-white/10 px-3 py-2 text-[13px] font-semibold">{speed}×</button>
      <button onClick={onRestart} aria-label="Restart" className="grid h-9 w-9 place-items-center rounded-full bg-white/10"><RotateCcw className="h-4 w-4" /></button>
    </div>
  );
  if (!wide) return (
    <div className="mb-2 rounded-2xl bg-white/5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        {pills}
        <div className="flex items-center gap-1.5">
          <button onClick={onToggle} aria-label={paused ? 'Play' : 'Pause'} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: C.lime, color: C.ink }}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</button>
          <button onClick={onSpeed} className="h-8 rounded-full bg-white/10 px-2 text-[12px] font-semibold">{speed}×</button>
          <button onClick={onRestart} aria-label="Restart" className="grid h-8 w-8 place-items-center rounded-full bg-white/10"><RotateCcw className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[11px] font-semibold tracking-[1px]" style={{ color: C.lime }}>{Math.max(1, t.chapter + 1)}/{CHAPTERS.length}</span>
        <span className="text-[17px] font-semibold leading-tight tracking-tight">{ch.t}</span>
      </div>
      <p key={t.beat} className="demo-fade mt-0.5 line-clamp-2 min-h-[36px] text-[13px] leading-snug" style={{ color: '#cfe0d2' }}>
        {driving ? 'You’re driving. Everything on the phone works. Tap ▶ to resume.' : t.beat || ch.d}
      </p>
    </div>
  );
  return (
    <aside className="sticky top-4 self-start">
      <div className="rounded-3xl bg-white/5 p-6">
        <div className="text-[11px] font-semibold uppercase tracking-[2px]" style={{ color: C.lime }}>Step {Math.max(1, t.chapter + 1)} of {CHAPTERS.length}</div>
        <h2 key={ch.t} className="demo-fade mt-2 text-[38px] font-semibold leading-[1.02] tracking-[-1.5px]">{ch.t}</h2>
        <p className="mt-3 text-[15px] leading-relaxed" style={{ color: '#b8cbbd' }}>{ch.d}</p>
        <div className="mt-5 flex min-h-[70px] gap-3 rounded-2xl p-4" style={{ background: '#ffffff0d' }}>
          <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ background: paused ? '#9fb3a6' : C.lime }} />
          <p key={t.beat} className="demo-fade text-[15px] font-medium leading-snug">{t.beat || 'Starting…'}</p>
        </div>
        {driving && <p className="mt-3 rounded-2xl p-3 text-[13px] font-semibold" style={{ background: C.lime, color: C.ink }}>You’re driving. Every button on the phones works. Hit Resume when you’re ready.</p>}
        <div className="mt-5">{controls}</div>
      </div>
      <ol className="mt-4 grid gap-1">
        {CHAPTERS.map((c, i) => (
          <li key={c.t}>
            <button onClick={() => onJump(i)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition-colors hover:bg-white/5"
              style={{ color: i === t.chapter ? '#fff' : i < t.chapter ? '#9fb3a6' : '#6f8a7b' }}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={i === t.chapter ? { background: C.lime, color: C.ink } : i < t.chapter ? { background: '#ffffff22' } : { border: '1px solid #ffffff22' }}>{i < t.chapter ? '✓' : i + 1}</span>
              <span className={i === t.chapter ? 'font-semibold' : ''}>{c.t}</span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function EndCard({ onReplay }: { onReplay: () => void }) {
  const [q, setQ] = useState('');
  return (
    <div className="demo-fade absolute inset-0 z-50 grid place-items-center rounded-3xl p-4" style={{ background: '#07231cee', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-lg text-center">
        <Logo s={48} />
        <div className="mt-3 text-[13px] font-semibold uppercase tracking-[2px]" style={{ color: C.lime }}>{DEMO_BRAND} · {DEMO_TAGLINE}</div>
        <h2 className="mt-4 text-[44px] font-semibold leading-[1.02] tracking-[-2px]">A whole night.<br />Zero clipboards.</h2>
        <p className="mx-auto mt-3 max-w-md text-[16px]" style={{ color: '#b8cbbd' }}>One sentence, one link, every phone on the right court, and a recap people actually share. Your first one is on us.</p>
        <form className="mt-6 flex gap-2 rounded-2xl bg-white p-2" onSubmit={(x) => { x.preventDefault(); location.href = `/play/new?q=${encodeURIComponent(q.trim() || 'Doubles this Saturday 9am, 4 players')}`; }}>
          <input value={q} onChange={(x) => setQ(x.target.value)} placeholder="Describe your game: Doubles Sat 9am at…" aria-label="Describe your game"
            className="min-w-0 flex-1 bg-transparent px-3 text-[16px] outline-none" style={{ color: C.ink }} />
          <button className="rounded-xl px-5 py-3 text-[15px] font-semibold" style={{ background: C.lime, color: C.ink }}>Make it</button>
        </form>
        <button onClick={onReplay} className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold underline underline-offset-4"><RotateCcw className="h-4 w-4" />Watch it again</button>
      </div>
    </div>
  );
}

function Logo({ s = 28 }: { s?: number }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ width: s, height: s }} className="inline-block shrink-0">
      <rect width="32" height="32" rx="11" fill={C.lime} />
      <path d="M18 7 10 17h7l-3 8 9-12h-7l2-6Z" stroke={C.ink} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

const CSS = `
.demo-scroll{scrollbar-width:none}.demo-scroll::-webkit-scrollbar{display:none}
.demo-tap{width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:999px;background:#103c3233;border:3px solid #103c32;animation:demoTap .55s ease-out forwards}
@keyframes demoTap{0%{transform:scale(1.6);opacity:0}35%{transform:scale(.85);opacity:1}100%{transform:scale(1.25);opacity:0}}
.demo-drop{animation:demoDrop .45s cubic-bezier(.2,.9,.3,1.2)}
@keyframes demoDrop{from{transform:translateY(-30px) scale(.96);opacity:0}to{transform:none;opacity:1}}
.demo-toast{animation:demoUp .35s ease-out}
@keyframes demoUp{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}
.demo-msg{animation:demoUp .3s ease-out}
.demo-pop{animation:demoPop .45s cubic-bezier(.2,.9,.3,1.25)}
@keyframes demoPop{from{transform:scale(.94);opacity:0}to{transform:none;opacity:1}}
.demo-fade{animation:demoFade .5s ease-out}
@keyframes demoFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.demo-caret{display:inline-block;width:2px;height:1.1em;margin-left:1px;vertical-align:-3px;background:#103c32;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.demo-dots i{display:inline-block;width:7px;height:7px;margin:0 2px;border-radius:9px;background:#8696a0;animation:demoDot 1.2s infinite}
.demo-dots i:nth-child(2){animation-delay:.15s}.demo-dots i:nth-child(3){animation-delay:.3s}
@keyframes demoDot{0%,60%,100%{transform:none;opacity:.5}30%{transform:translateY(-4px);opacity:1}}
`;
