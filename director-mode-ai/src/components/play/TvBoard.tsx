'use client';

/**
 * The TV / projector board: /p/<code>/tv. Read-only and public (no host key),
 * readable across a court. Unlike the phone page it never stops polling, keeps
 * the last good data on a network blip, and can call out rounds and "Time"
 * over the speakers (browser speech, free) with a WebAudio chime.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { standings, teamScore, winnerOf, courtLabel, type GuestMatch, type GuestMixer } from '@/lib/mixer/guestMixer';
import { awards, checkedIn, drawAwards, formatLabel, whenLine, type PlayEvent } from '@/lib/play/core';
import { TIME_UP_TEXT, clockLeft, clockText, crossedZero, drawBoardRows, drawCallout, pollMs, roundAnnouncement } from '@/lib/play/tv';
import { courtName, drawProgress, entryOf, fillOrder, isBracket, matchEntries, roundLabel, scoreWinnerFirst, sideName, type Draw } from '@/lib/play/draw';
import { BracketBoard } from './DrawViews';
import { speakText, cancelSpeech, isSpeechSupported } from '@/lib/browserSpeech';
import { C, api } from './shared';

const SOUND_KEY = 'cc_tv_sound_v1';
const CHIME_KEY = 'cc_tv_chime_v1';
const PINK = '#ff9fc4';
const SOFT = '#bccdbb';

const teamName = (e: PlayEvent, t: 'A' | 'B') => e.state.teamNames?.[t] || (t === 'A' ? 'Team A' : 'Team B');

/* ---------- WebAudio chime: no files, no APIs ---------- */
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}
/** 'round' = bright rising three-note chime; 'time' = two long horn-ish tones. Returns its length in ms. */
function chime(kind: 'round' | 'time'): number {
  const a = audio();
  if (!a) return 0;
  const notes = kind === 'round' ? [[659.25, 0, 0.35], [783.99, 0.16, 0.35], [1046.5, 0.32, 0.7]] : [[880, 0, 0.55], [587.33, 0.6, 0.9]];
  const t0 = a.currentTime + 0.02;
  for (const [f, at, len] of notes) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = kind === 'round' ? 'sine' : 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    o.connect(g).connect(a.destination);
    o.start(t0 + at); o.stop(t0 + at + len + 0.05);
  }
  return Math.round(Math.max(...notes.map(([, at, len]) => at + len)) * 1000);
}

const readFlag = (k: string, dflt: boolean) => { try { const v = localStorage.getItem(k); return v == null ? dflt : v === '1'; } catch { return dflt; } };
const saveFlag = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

export default function TvBoard({ code, initial }: { code: string; initial: PlayEvent }) {
  const [e, setE] = useState<PlayEvent>(initial);
  const [okAt, setOkAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(false);
  const [chimeOn, setChimeOn] = useState(true);
  const [armed, setArmed] = useState(false); // browsers only play sound after a click on the page
  const [qr, setQr] = useState('');
  const [origin, setOrigin] = useState('');
  const [canSpeak, setCanSpeak] = useState(false); // set after mount so server and client render the same

  useEffect(() => { setSound(readFlag(SOUND_KEY, false)); setChimeOn(readFlag(CHIME_KEY, true)); setOrigin(location.origin); setCanSpeak(isSpeechSupported()); }, []);

  // Poll forever: 5s live, 15s otherwise. Errors keep the last good board.
  const refresh = useCallback(async () => {
    try { setE(await api<PlayEvent>(`/api/p/${code}`)); setOkAt(Date.now()); } catch { /* keep last */ }
  }, [code]);
  useEffect(() => {
    const id = setInterval(refresh, pollMs(e.status));
    return () => clearInterval(id);
  }, [e.status, refresh]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, []);

  // Keep the screen awake (where the browser allows it).
  useEffect(() => {
    type Lock = { release(): Promise<void> };
    let lock: Lock | null = null;
    const get = async () => { try { lock = await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<Lock> } }).wakeLock?.request('screen') ?? null; } catch { /* not allowed */ } };
    const vis = () => { if (!document.hidden) void get(); };
    void get();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); void lock?.release().catch(() => {}); };
  }, []);

  // Any click on the page unlocks audio for the night.
  useEffect(() => {
    const arm = () => { setArmed(true); audio(); };
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return () => { window.removeEventListener('pointerdown', arm); window.removeEventListener('keydown', arm); };
  }, []);

  const m = e.state.mixer;
  const d = e.format === 'tournament' ? e.state.draw ?? null : null;
  const round = m?.rounds[m.rounds.length - 1];
  const paused = !!e.state.pausedAt;
  const left = e.status === 'live' && round ? clockLeft(e.state.roundStartedAt, e.round_minutes, e.state.pausedAt, now) : null;

  const live = useRef({ sound, chimeOn, armed });
  live.current = { sound, chimeOn, armed };
  const say = useCallback((text: string, kind: 'round' | 'time') => {
    const s = live.current;
    if (!s.sound || !s.armed) return;
    const wait = s.chimeOn ? chime(kind) : 0;
    setTimeout(() => speakText(text, { rate: 0.95 }), wait ? wait + 150 : 0);
  }, []);

  // New round (or a reshuffle) → call it out. Not on first load.
  const sig = round ? `${round.number}|${round.matches.map((x) => `${x.court}:${x.teamA.join(',')}v${x.teamB.join(',')}`).join(';')}` : '';
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (lastSig.current === null) { lastSig.current = sig; return; }
    if (sig && sig !== lastSig.current && m && round && e.status === 'live') say(roundAnnouncement(m, round), 'round');
    lastSig.current = sig;
  }, [sig, m, round, e.status, say]);

  // Tournament: matches going on court get called out. Not on first load.
  const onCourtSig = d ? d.matches.filter((x) => x.status === 'on_court').map((x) => `${x.key}@${x.court}`).sort().join(';') : '';
  const lastOnCourt = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!d) return;
    const cur = new Set(d.matches.filter((x) => x.status === 'on_court').map((x) => x.key));
    if (lastOnCourt.current && e.status === 'live') { const text = drawCallout(d, lastOnCourt.current); if (text) say(text, 'round'); }
    lastOnCourt.current = cur;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCourtSig, e.status, say]);

  // The clock hits zero while we're watching → "Time."
  const prevLeft = useRef<number | null>(null);
  useEffect(() => {
    if (crossedZero(prevLeft.current, left, paused)) say(TIME_UP_TEXT, 'time');
    prevLeft.current = left;
  }, [left, paused, say]);

  const toggleSound = () => {
    const v = !sound; setSound(v); saveFlag(SOUND_KEY, v); setArmed(true);
    if (!v) cancelSpeech();
    else if (chimeOn) chime('round');
  };
  const toggleChime = () => { const v = !chimeOn; setChimeOn(v); saveFlag(CHIME_KEY, v); if (v) chime('round'); };
  const repeat = () => {
    setArmed(true); live.current.armed = true;
    if (m && round) say(roundAnnouncement(m, round), 'round');
  };
  const fullscreen = () => {
    try { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); } catch { /* */ }
  };

  const hereUrl = origin ? `${origin}/p/${code}?here=1` : '';
  useEffect(() => {
    if (e.status !== 'open' || !hereUrl) return;
    QRCode.toDataURL(hereUrl, { margin: 1, width: 900, color: { dark: C.ink, light: '#ffffff' } }).then(setQr).catch(() => {});
  }, [e.status, hereUrl]);

  const stale = now - okAt > 30000;
  const name = useCallback((id: string) => m?.players.find((p) => p.id === id)?.name ?? '?', [m]);
  const st = useMemo(() => (m ? standings(m) : []), [m]);

  return (
    <main className="flex min-h-screen flex-col" style={{ background: C.ink, color: '#fff' }}>
      <header className="flex items-center justify-between gap-4 px-[2vw] py-[1.2vh]">
        <div className="flex min-w-0 items-center gap-3">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="h-[clamp(28px,3vw,48px)] w-[clamp(28px,3vw,48px)] shrink-0">
            <rect width="32" height="32" rx="11" fill={C.lime} />
            <path d="M18 7 10 17h7l-3 8 9-12h-7l2-6Z" stroke={C.ink} strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0">
            <div className="truncate font-semibold leading-tight" style={{ fontSize: 'clamp(18px,2vw,40px)' }}>{e.title}</div>
            <div className="truncate" style={{ color: SOFT, fontSize: 'clamp(12px,1vw,20px)' }}>{formatLabel(e)}{e.location ? ` · ${e.location}` : ''}{stale ? ' · reconnecting…' : ''}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[clamp(12px,0.9vw,18px)] font-semibold">
          {canSpeak && (
            <button onClick={toggleSound} className="rounded-xl px-3 py-2" style={sound ? { background: C.lime, color: C.ink } : { background: '#ffffff1a', color: '#fff' }}>
              {sound ? 'Sound on' : 'Sound off'}
            </button>
          )}
          {sound && <button onClick={toggleChime} className="rounded-xl px-3 py-2" style={{ background: '#ffffff1a' }}>{chimeOn ? 'Chime on' : 'Chime off'}</button>}
          {sound && e.status === 'live' && round && <button onClick={repeat} className="rounded-xl px-3 py-2" style={{ background: '#ffffff1a' }}>Say the round</button>}
          <button onClick={fullscreen} className="rounded-xl px-3 py-2" style={{ background: '#ffffff1a' }}>Full screen</button>
        </div>
      </header>
      {sound && !armed && (
        <div className="mx-[2vw] rounded-xl px-4 py-2 text-center font-semibold" style={{ background: C.lime, color: C.ink, fontSize: 'clamp(14px,1.2vw,24px)' }}>
          Click anywhere on this screen to let the board talk (browsers need one click).
        </div>
      )}

      {e.status === 'open' && <Waiting e={e} qr={qr} hereUrl={hereUrl} />}
      {e.status === 'live' && m && (
        <Live e={e} m={m} name={name} st={st} left={left} paused={paused} />
      )}
      {e.status === 'live' && d && <DrawLive d={d} now={now} />}
      {e.status === 'live' && !m && !d && <Center text="Starting soon" />}
      {e.status === 'done' && d && <DrawDone d={d} />}
      {e.status === 'done' && !d && <Done e={e} m={m} st={st} />}
    </main>
  );
}

function Center({ text }: { text: string }) {
  return <div className="grid flex-1 place-items-center font-semibold" style={{ fontSize: 'clamp(32px,5vw,96px)' }}>{text}</div>;
}

/* ---------- before the start: check-in QR ---------- */
function Waiting({ e, qr, hereUrl }: { e: PlayEvent; qr: string; hereUrl: string }) {
  const here = checkedIn(e);
  const when = whenLine(e);
  return (
    <section className="grid flex-1 items-center gap-[3vw] px-[4vw] pb-[3vh] md:grid-cols-[1.1fr_1fr]">
      <div>
        <div className="font-semibold uppercase tracking-[3px]" style={{ color: C.lime, fontSize: 'clamp(14px,1.3vw,26px)' }}>{when ?? 'Today'}</div>
        <h1 className="mt-2 font-semibold leading-[1.02] tracking-tight" style={{ fontSize: 'clamp(40px,6vw,128px)' }}>{e.title}</h1>
        {e.location && <div className="mt-3" style={{ color: SOFT, fontSize: 'clamp(18px,1.8vw,36px)' }}>{e.location}</div>}
        <div className="mt-[4vh] flex items-baseline gap-4">
          <span className="font-bold tabular-nums leading-none" style={{ color: C.lime, fontSize: 'clamp(64px,9vw,200px)' }}>{here.length}</span>
          <span className="font-semibold" style={{ fontSize: 'clamp(20px,2.2vw,44px)' }}>checked in</span>
        </div>
        {here.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" style={{ fontSize: 'clamp(14px,1.2vw,24px)' }}>
            {here.map((r) => <span key={r.id} className="rounded-full px-3 py-1" style={{ background: '#ffffff1a' }}>{r.name}</span>)}
          </div>
        )}
      </div>
      <div className="flex flex-col items-center">
        <div className="rounded-[2vw] bg-white p-[1.5vw]">
          {qr ? <img src={qr} alt="Scan to check in" className="block h-[min(58vh,40vw)] w-[min(58vh,40vw)]" /> : <div className="h-[min(58vh,40vw)] w-[min(58vh,40vw)]" />}
        </div>
        <div className="mt-[2vh] text-center font-semibold" style={{ fontSize: 'clamp(22px,2.4vw,52px)' }}>Scan to check in</div>
        <div className="text-center" style={{ color: SOFT, fontSize: 'clamp(12px,1vw,20px)' }}>{hereUrl.replace(/^https?:\/\//, '')}</div>
      </div>
    </section>
  );
}

/* ---------- live: round, clock, courts, leaderboard ---------- */
function Live({ e, m, name, st, left, paused }: { e: PlayEvent; m: GuestMixer; name: (id: string) => string; st: ReturnType<typeof standings>; left: number | null; paused: boolean }) {
  const round = m.rounds[m.rounds.length - 1];
  const team = new Map(m.players.map((p) => [p.id, p.team]));
  const battle = e.format === 'team-battle';
  const timeUp = left != null && left <= 0;
  return (
    <section className="grid flex-1 gap-[1.5vw] px-[2vw] pb-[2vh] lg:grid-cols-[1fr_minmax(260px,24vw)]">
      <div className="flex min-w-0 flex-col gap-[1.5vh]">
        <div className="flex items-stretch gap-[1.5vw]">
          <div className="rounded-[1.5vw] px-[2vw] py-[1.5vh]" style={{ background: '#ffffff12' }}>
            <div className="font-semibold uppercase tracking-[2px]" style={{ color: SOFT, fontSize: 'clamp(12px,1vw,22px)' }}>Round</div>
            <div className="font-bold leading-none tabular-nums" style={{ fontSize: 'clamp(56px,8vw,180px)' }}>{round?.number ?? '–'}</div>
          </div>
          <div className="flex flex-1 flex-col justify-center rounded-[1.5vw] px-[2vw] py-[1.5vh]" style={{ background: timeUp ? '#b4432f' : paused ? '#ffffff12' : C.lime, color: timeUp ? '#fff' : paused ? '#fff' : C.ink }}>
            <div className="font-semibold uppercase tracking-[2px]" style={{ fontSize: 'clamp(12px,1vw,22px)', opacity: 0.8 }}>
              {paused ? 'Paused' : timeUp ? 'Finish your point · enter scores' : `${e.round_minutes} minute rounds`}
            </div>
            <div className="font-bold leading-none tabular-nums" style={{ fontSize: 'clamp(64px,10vw,220px)' }}>
              {round ? (clockText(left) || '–') : 'Next round soon'}
              {paused && <span className="ml-[1.5vw] align-middle font-bold" style={{ fontSize: 'clamp(24px,3vw,72px)', color: '#ffb199' }}>PAUSED</span>}
            </div>
          </div>
        </div>
        {round && (
          <div className="grid gap-[1vw]" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(clamp(260px, ${round.matches.length > 6 ? 20 : 26}vw, 640px), 1fr))` }}>
            {round.matches.map((x) => <Court key={x.court} x={x} label={courtLabel(m, x.court)} name={name} team={battle ? (id) => team.get(id) : undefined} />)}
          </div>
        )}
        {round && round.sittingOut.length > 0 && (
          <div className="rounded-[1vw] px-[1.5vw] py-[1.2vh]" style={{ background: '#ffffff12', fontSize: 'clamp(16px,1.6vw,34px)' }}>
            <span className="font-semibold uppercase tracking-[2px]" style={{ color: SOFT, fontSize: '0.7em' }}>Sitting out&nbsp;&nbsp;</span>
            {round.sittingOut.map(name).join(' · ')}
          </div>
        )}
      </div>
      <aside className="flex flex-col gap-[1.5vh]">
        {battle && <TeamScore e={e} m={m} />}
        <Board st={st} max={battle ? 8 : 12} />
      </aside>
    </section>
  );
}

function Court({ x, label, name, team }: { x: GuestMatch; label: string; name: (id: string) => string; team?: (id: string) => 'A' | 'B' | undefined }) {
  const scored = x.scoreA != null && x.scoreB != null;
  const w = winnerOf(x);
  const dot = (ids: string[]) => {
    const t = team?.(ids[0]);
    return t ? <span className="mr-2 inline-block h-[0.6em] w-[0.6em] rounded-full align-middle" style={{ background: t === 'B' ? PINK : C.lime, outline: `2px solid ${C.ink}22` }} /> : null;
  };
  const side = (ids: string[], s: number | null | undefined, won: boolean) => (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 leading-tight" style={{ fontWeight: won ? 700 : 500 }}>{dot(ids)}{ids.map(name).join(' & ')}</div>
      {scored && <div className="shrink-0 font-bold tabular-nums" style={{ fontSize: '1.4em', opacity: won ? 1 : 0.5 }}>{s}{won && x.scoreA === x.scoreB ? '*' : ''}</div>}
    </div>
  );
  return (
    <div className="rounded-[1.2vw] p-[1.2vw]" style={{ background: C.card, color: C.ink, fontSize: 'clamp(16px,1.5vw,34px)' }}>
      <div className="mb-[0.6vh] flex items-center justify-between">
        <span className="font-bold" style={{ fontSize: '1.15em' }}>Court {label}</span>
        <span className="rounded-full px-3 py-0.5 font-semibold" style={{ fontSize: '0.6em', background: scored ? C.lime : '#eef1e8' }}>{scored ? 'Final' : 'Playing'}</span>
      </div>
      {side(x.teamA, x.scoreA, w === 'A')}
      <div className="my-[0.4vh] font-semibold uppercase" style={{ color: C.muted, fontSize: '0.55em', letterSpacing: 2 }}>vs</div>
      {side(x.teamB, x.scoreB, w === 'B')}
    </div>
  );
}

function TeamScore({ e, m, final }: { e: PlayEvent; m: GuestMixer; final?: boolean }) {
  const sc = teamScore(m);
  return (
    <div className="rounded-[1.2vw] p-[1.2vw]" style={{ background: '#ffffff12' }}>
      <div className="font-semibold uppercase tracking-[2px]" style={{ color: SOFT, fontSize: 'clamp(11px,0.9vw,20px)' }}>{final ? 'Final · courts won' : 'Team score · courts won'}</div>
      <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div><div className="truncate font-semibold" style={{ color: C.lime, fontSize: 'clamp(14px,1.3vw,28px)' }}>{teamName(e, 'A')}</div><div className="font-bold leading-none tabular-nums" style={{ fontSize: 'clamp(40px,5vw,110px)' }}>{sc.A}</div></div>
        <div style={{ color: '#9fb3a6', fontSize: 'clamp(14px,1.3vw,28px)' }}>vs</div>
        <div className="text-right"><div className="truncate font-semibold" style={{ color: PINK, fontSize: 'clamp(14px,1.3vw,28px)' }}>{teamName(e, 'B')}</div><div className="font-bold leading-none tabular-nums" style={{ fontSize: 'clamp(40px,5vw,110px)' }}>{sc.B}</div></div>
      </div>
      <div style={{ color: SOFT, fontSize: 'clamp(11px,0.9vw,20px)' }}>games {sc.gamesA}–{sc.gamesB}</div>
    </div>
  );
}

function Board({ st, max, title = 'Leaderboard' }: { st: ReturnType<typeof standings>; max: number; title?: string }) {
  return (
    <div className="flex-1 rounded-[1.2vw] p-[1.2vw]" style={{ background: '#ffffff12', fontSize: 'clamp(14px,1.25vw,28px)' }}>
      {title && <div className="mb-[0.8vh] font-semibold uppercase tracking-[2px]" style={{ color: SOFT, fontSize: '0.7em' }}>{title}</div>}
      {st.length === 0 ? <div style={{ color: SOFT }}>Scores show up as courts finish.</div> : (
        <table className="w-full">
          <tbody>
            {st.slice(0, max).map((s) => (
              <tr key={s.id} className="border-t" style={{ borderColor: '#ffffff14' }}>
                <td className="w-[3.2em] whitespace-nowrap py-[0.35vh] pr-2 font-bold tabular-nums" style={{ color: s.rank === '1' || s.rank === 'T-1' ? C.lime : SOFT }}>{s.rank}</td>
                <td className="truncate py-[0.35vh] font-semibold" style={{ maxWidth: 0, width: '100%' }}>{s.name}</td>
                <td className="whitespace-nowrap py-[0.35vh] pl-3 text-right tabular-nums">{s.wins}–{s.losses}</td>
                <td className="whitespace-nowrap py-[0.35vh] pl-3 text-right tabular-nums" style={{ color: SOFT, fontSize: '0.8em' }}>{s.gamesFor - s.gamesAgainst >= 0 ? '+' : ''}{s.gamesFor - s.gamesAgainst}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {st.length > max && <div className="mt-1" style={{ color: SOFT, fontSize: '0.75em' }}>+{st.length - max} more on the event page</div>}
    </div>
  );
}

/* ---------- after the end: champion + final standings ---------- */
function Done({ e, m, st }: { e: PlayEvent; m?: GuestMixer; st: ReturnType<typeof standings> }) {
  const champ = m ? awards(m)[0] : undefined;
  const battle = e.format === 'team-battle' && m;
  const sc = battle ? teamScore(m) : null;
  const lead = sc ? (sc.A === sc.B ? null : sc.A > sc.B ? 'A' : 'B') : null;
  const half = Math.ceil(Math.min(st.length, 24) / 2);
  return (
    <section className="grid flex-1 gap-[2vw] px-[3vw] pb-[3vh] lg:grid-cols-[1fr_1.2fr]">
      <div className="flex flex-col justify-center gap-[2vh]">
        {battle && sc && (
          <div className="rounded-[1.5vw] p-[2vw] text-center" style={{ background: lead === 'B' ? PINK : C.lime, color: C.ink }}>
            <div className="font-semibold uppercase tracking-[3px]" style={{ fontSize: 'clamp(14px,1.3vw,26px)' }}>{lead ? 'Team champion' : 'All square'}</div>
            <div className="font-bold leading-tight" style={{ fontSize: 'clamp(36px,5vw,110px)' }}>{lead ? teamName(e, lead) : 'Run it back'}</div>
            <div style={{ fontSize: 'clamp(16px,1.6vw,34px)' }}>{sc.A}–{sc.B} courts · games {sc.gamesA}–{sc.gamesB}</div>
          </div>
        )}
        {champ ? (
          <div className="rounded-[1.5vw] p-[2vw] text-center" style={{ background: battle ? '#ffffff12' : C.lime, color: battle ? '#fff' : C.ink }}>
            <div className="font-semibold uppercase tracking-[3px]" style={{ fontSize: 'clamp(14px,1.3vw,26px)' }}>{battle ? 'Top player' : 'Champion'}</div>
            <div className="font-bold leading-tight tracking-tight" style={{ fontSize: battle ? 'clamp(32px,4vw,90px)' : 'clamp(48px,7vw,160px)' }}>🏆 {champ.who}</div>
            <div style={{ fontSize: 'clamp(16px,1.6vw,34px)' }}>{champ.why}</div>
          </div>
        ) : <Center text="That's a wrap" />}
      </div>
      <div className="flex flex-col justify-center">
        <div className="mb-[1vh] font-semibold uppercase tracking-[2px]" style={{ color: SOFT, fontSize: 'clamp(12px,1vw,22px)' }}>Final standings</div>
        <div className="grid gap-[1vw] md:grid-cols-2">
          <Board st={st.slice(0, half)} max={half} title="" />
          {st.length > half && <Board st={st.slice(half, 24)} max={24} title="" />}
        </div>
      </div>
    </section>
  );
}

/* ---------- a finished bracket: champion, awards, final places, the draw ---------- */
function BracketDone({ d, rows }: { d: Draw; rows: ReturnType<typeof drawBoardRows> }) {
  const aw = drawAwards(d);
  const champ = aw[0]?.title === 'Champion' ? aw[0] : null;
  const half = Math.ceil(Math.min(rows.length, 24) / 2);
  return (
    <section className="grid flex-1 gap-[2vw] px-[3vw] pb-[3vh] lg:grid-cols-[1fr_1.2fr]">
      <div className="flex flex-col justify-center gap-[2vh]">
        {champ ? (
          <div className="rounded-[1.5vw] p-[2vw] text-center" style={{ background: C.lime, color: C.ink }}>
            <div className="font-semibold uppercase tracking-[3px]" style={{ fontSize: 'clamp(14px,1.3vw,26px)' }}>Champion</div>
            <div className="font-bold leading-tight tracking-tight" style={{ fontSize: 'clamp(44px,6vw,150px)' }}>🏆 {champ.who}</div>
            <div style={{ fontSize: 'clamp(16px,1.6vw,34px)' }}>{champ.why}</div>
          </div>
        ) : <Center text="That's a wrap" />}
        <div className="grid gap-[1vw] sm:grid-cols-2">
          {aw.filter((a) => a !== champ).map((a) => (
            <div key={a.title} className="rounded-[1vw] p-[1vw]" style={{ background: '#ffffff12', fontSize: 'clamp(14px,1.2vw,26px)' }}>
              <div style={{ color: SOFT, fontSize: '0.7em' }} className="font-semibold uppercase tracking-[2px]">{a.emoji} {a.title}</div>
              <div className="font-bold">{a.who}</div>
              <div style={{ color: SOFT, fontSize: '0.8em' }}>{a.why}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col justify-center">
        <div className="mb-[1vh] font-semibold uppercase tracking-[2px]" style={{ color: SOFT, fontSize: 'clamp(12px,1vw,22px)' }}>Final places</div>
        <div className="grid gap-[1vw] md:grid-cols-2">
          <Board st={rows.slice(0, half)} max={half} title="" />
          {rows.length > half && <Board st={rows.slice(half, 24)} max={24} title="" />}
        </div>
      </div>
      <div className="lg:col-span-2"><BracketBoard d={d} flat /></div>
    </section>
  );
}

/* ---------- tournament: court board + standings ---------- */
function DrawLive({ d, now }: { d: Draw; now: number }) {
  const onCourt = d.matches.filter((x) => x.status === 'on_court');
  const courts = Array.from({ length: Math.max(d.courts, ...onCourt.map((x) => x.court ?? 0)) }, (_, i) => i + 1);
  const busy = new Set(onCourt.flatMap(matchEntries));
  const queue = d.matches.filter((x) => x.status === 'ready').sort(fillOrder).slice(0, 6);
  const pr = drawProgress(d);
  const nm = (id: string | null) => entryOf(d, id)?.name ?? 'TBD';
  const rows = drawBoardRows(d);
  const bracket = isBracket(d.format);
  const recent = bracket ? d.matches.filter((x) => x.status === 'done' && !x.bye).sort((a, b) => Date.parse(b.finishedAt ?? '0') - Date.parse(a.finishedAt ?? '0')).slice(0, 8) : [];
  return (
    <section className="grid flex-1 gap-[1.5vw] px-[2vw] pb-[2vh] lg:grid-cols-[1fr_minmax(260px,26vw)]">
      <div className="flex min-w-0 flex-col gap-[1.5vh]">
        <div className="rounded-[1.5vw] px-[2vw] py-[1.5vh]" style={{ background: '#ffffff12' }}>
          <div className="font-semibold uppercase tracking-[2px]" style={{ color: SOFT, fontSize: 'clamp(12px,1vw,22px)' }}>Matches played</div>
          <div className="font-bold leading-none tabular-nums" style={{ fontSize: 'clamp(48px,6vw,140px)' }}>{pr.done}<span style={{ color: SOFT, fontSize: '0.5em' }}> / {pr.total}</span></div>
        </div>
        <div className="grid gap-[1vw]" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(clamp(260px, ${courts.length > 6 ? 20 : 26}vw, 640px), 1fr))` }}>
          {courts.map((c) => {
            const x = onCourt.find((y) => y.court === c);
            const min = x?.startedAt ? Math.max(0, Math.floor((now - Date.parse(x.startedAt)) / 60000)) : 0;
            return (
              <div key={c} className="rounded-[1.2vw] p-[1.2vw]" style={{ background: x ? C.card : '#ffffff12', color: x ? C.ink : '#fff', fontSize: 'clamp(16px,1.5vw,34px)' }}>
                <div className="mb-[0.6vh] flex items-center justify-between">
                  <span className="font-bold" style={{ fontSize: '1.15em' }}>Court {courtName(d, c)}</span>
                  <span className="rounded-full px-3 py-0.5 font-semibold" style={{ fontSize: '0.6em', background: x ? C.lime : '#ffffff1a', color: x ? C.ink : SOFT }}>{x ? `Playing · ${min} min` : 'Free'}</span>
                </div>
                {x ? (<>
                  {bracket && <div className="mb-[0.4vh] font-semibold uppercase" style={{ color: C.muted, fontSize: '0.5em', letterSpacing: 1.5 }}>{roundLabel(d, x)}</div>}
                  <div className="font-semibold leading-tight">{sideName(d, x, 'a')}</div>
                  <div className="my-[0.4vh] font-semibold uppercase" style={{ color: C.muted, fontSize: '0.55em', letterSpacing: 2 }}>vs</div>
                  <div className="font-semibold leading-tight">{sideName(d, x, 'b')}</div>
                </>) : <div style={{ color: SOFT }}>Next match soon</div>}
              </div>
            );
          })}
        </div>
        {queue.length > 0 && (
          <div className="rounded-[1vw] px-[1.5vw] py-[1.2vh]" style={{ background: '#ffffff12', fontSize: 'clamp(15px,1.4vw,30px)' }}>
            <div className="font-semibold uppercase tracking-[2px]" style={{ color: SOFT, fontSize: '0.7em' }}>Up next</div>
            {queue.map((x) => {
              const wait = matchEntries(x).filter((id) => busy.has(id)).map(nm);
              return <div key={x.key} className="flex justify-between gap-3"><span>{sideName(d, x, 'a')} vs {sideName(d, x, 'b')}</span><span style={{ color: SOFT, fontSize: '0.8em' }}>{wait.length ? `waiting on ${wait.join(' & ')}` : 'ready'}</span></div>;
            })}
          </div>
        )}
      </div>
      {bracket ? (
        <aside className="flex flex-col gap-[1.5vh]">
          <div className="flex-1 rounded-[1.2vw] p-[1.2vw]" style={{ background: '#ffffff12', fontSize: 'clamp(14px,1.25vw,28px)' }}>
            <div className="mb-[0.8vh] font-semibold uppercase tracking-[2px]" style={{ color: SOFT, fontSize: '0.7em' }}>Results</div>
            {recent.length ? recent.map((x) => {
              const w = x.winner === 'b' ? 'b' : 'a';
              return (
                <div key={x.key} className="border-t py-[0.4vh]" style={{ borderColor: '#ffffff14' }}>
                  <div style={{ color: SOFT, fontSize: '0.65em' }}>{roundLabel(d, x)}</div>
                  <div><b>{sideName(d, x, w)}</b> <span style={{ color: SOFT }}>d.</span> {sideName(d, x, w === 'a' ? 'b' : 'a')} <span className="tabular-nums" style={{ color: SOFT, fontSize: '0.8em' }}>{scoreWinnerFirst(x)}</span></div>
                </div>
              );
            }) : <div style={{ color: SOFT }}>Results show up as courts finish.</div>}
          </div>
        </aside>
      ) : <aside className="flex flex-col gap-[1.5vh]"><Board st={rows} max={16} title="Standings" /></aside>}
      {bracket && <div className="lg:col-span-2"><BracketBoard d={d} flat /></div>}
    </section>
  );
}

function DrawDone({ d }: { d: Draw }) {
  const rows = drawBoardRows(d);
  if (isBracket(d.format)) return <BracketDone d={d} rows={rows} />;
  const champ = rows[0]?.played ? rows[0] : null;
  const half = Math.ceil(Math.min(rows.length, 24) / 2);
  return (
    <section className="grid flex-1 gap-[2vw] px-[3vw] pb-[3vh] lg:grid-cols-[1fr_1.2fr]">
      <div className="flex flex-col justify-center gap-[2vh]">
        {champ ? (
          <div className="rounded-[1.5vw] p-[2vw] text-center" style={{ background: C.lime, color: C.ink }}>
            <div className="font-semibold uppercase tracking-[3px]" style={{ fontSize: 'clamp(14px,1.3vw,26px)' }}>Champion</div>
            <div className="font-bold leading-tight tracking-tight" style={{ fontSize: 'clamp(48px,7vw,160px)' }}>🏆 {champ.name}</div>
            <div style={{ fontSize: 'clamp(16px,1.6vw,34px)' }}>{champ.wins}–{champ.losses} · games {champ.gamesFor}–{champ.gamesAgainst}</div>
          </div>
        ) : <Center text="That's a wrap" />}
      </div>
      <div className="flex flex-col justify-center">
        <div className="mb-[1vh] font-semibold uppercase tracking-[2px]" style={{ color: SOFT, fontSize: 'clamp(12px,1vw,22px)' }}>Final standings</div>
        <div className="grid gap-[1vw] md:grid-cols-2">
          <Board st={rows.slice(0, half)} max={half} title="" />
          {rows.length > half && <Board st={rows.slice(half, 24)} max={24} title="" />}
        </div>
      </div>
    </section>
  );
}
