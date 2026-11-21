'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import {
  ArrowLeftRight, Calendar, Check, Clock, Copy, Loader2, MapPin, MessageCircle, Minus, Pause, Play, Plus, QrCode, RefreshCw,
  Share2, Shuffle, Square, Trophy, Undo2, UserPlus, X,
} from 'lucide-react';
import { standings, teamScore, winnerOf, isScored, courtLabel, type GuestMatch, type GuestFormat } from '@/lib/mixer/guestMixer';
import { Directions, PlaceMap, PlacePicker, type Place } from './PlacePicker';
import { FORMAT_NAME, directionsUrl, awards, perCourt, spotsLine, whenLine, checkedIn, type PlayEvent } from '@/lib/play/core';
import { BrandContext, C, PlayHeader, api, getKey, getName, setKey, setName } from './shared';
import { getMyLevel, levelLabel, levelNote, levelNum, setMyLevel } from '@/lib/play/levels';
import { LevelChips } from './Levels';
import { WeatherCard } from './Weather';
import { trackEvent } from '@/lib/analytics';

export type Res = { event: PlayEvent; playerKey?: string; code?: string };

export default function EventClient({ code, initial }: { code: string; initial: PlayEvent }) {
  const [e, setE] = useState<PlayEvent>(initial);
  const [key, setK] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'courts' | 'table'>('courts');
  const [isNew, setIsNew] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [moving, setMoving] = useState(false);
  const [hereLink, setHereLink] = useState(false);
  const lastRound = useRef<number>(0);
  const autoHere = useRef(false);

  const refresh = useCallback(async (k = key) => {
    try { setE(await api<PlayEvent>(`/api/p/${code}`, undefined, k)); } catch { /* keep last */ }
  }, [code, key]);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const hk = q.get('host');
    if (hk && /^[A-Za-z0-9_-]{8,80}$/.test(hk)) { setKey(code, hk); q.delete('host'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '')); }
    const k = getKey(code);
    setK(k);
    setIsNew(new URLSearchParams(location.search).has('new'));
    setHereLink(new URLSearchParams(location.search).get('here') === '1');
    refresh(k);
    // A fresh invite open: this phone has no host/player key for the game yet. Count once per phone.
    try {
      const seen = `cc_open_${code}`;
      if (!k && !hk && !localStorage.getItem(seen)) { localStorage.setItem(seen, '1'); trackEvent('feature_use', 'play_link_open', 'courtconnect', { code }); }
    } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Server time costs money (free plan), so poll gently: live 10s, open 60s, done never.
  // Pause when the tab is hidden, and stop after 10 idle minutes until the person touches the page.
  useEffect(() => {
    if (e.status === 'done') return;
    const ms = e.status === 'live' ? 10000 : 60000;
    let last = Date.now();
    const poke = () => { const idle = Date.now() - last > 10 * 60000; last = Date.now(); if (idle) refresh(); };
    const id = setInterval(() => { if (!document.hidden && Date.now() - last < 10 * 60000) refresh(); }, ms);
    const vis = () => { if (!document.hidden) { last = Date.now(); refresh(); } };
    document.addEventListener('visibilitychange', vis);
    for (const ev of ['pointerdown', 'keydown', 'scroll'] as const) window.addEventListener(ev, poke, { passive: true });
    return () => {
      clearInterval(id); document.removeEventListener('visibilitychange', vis);
      for (const ev of ['pointerdown', 'keydown', 'scroll'] as const) window.removeEventListener(ev, poke);
    };
  }, [e.status, refresh]);

  // a new round: buzz the phone
  const rounds = e.state.mixer?.rounds ?? [];
  useEffect(() => {
    if (rounds.length > lastRound.current && lastRound.current > 0) { try { navigator.vibrate?.([200, 100, 200]); } catch { /* */ } }
    lastRound.current = rounds.length;
  }, [rounds.length]);

  async function act(body: Record<string, unknown>, label = String(body.action)) {
    setBusy(label); setErr('');
    try {
      const r = await api<Res>(`/api/p/${code}`, body, key);
      if (r.playerKey) { setKey(code, r.playerKey); setK(r.playerKey); }
      if (r.event) setE(r.event);
      return r;
    } catch (x) {
      if (x instanceof Error && x.message === 'PAYWALL') { location.href = '/play/pass'; return; }
      setErr(x instanceof Error ? x.message : 'Something went wrong');
    }
    finally { setBusy(''); }
  }

  const meR = e.rsvps.find((r) => r.id === e.me);
  // Scanned the court QR (?here=1) and already on the list: that's a check-in.
  useEffect(() => {
    if (hereLink && meR && !meR.checked_in_at && e.status !== 'done' && !autoHere.current) { autoHere.current = true; act({ action: 'checkin' }, 'checkin'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hereLink, meR?.id, meR?.checked_in_at, e.status]);
  // Times and the share link depend on this phone's clock and address: render after mount only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="min-h-screen" style={{ background: C.paper }} />;
  return (
    <div className="min-h-screen pb-24" style={{ background: C.paper, color: C.ink }}>
      <PlayHeader right={e.isHost ? <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: C.lime }}>You&apos;re hosting</span> : null} />
      <main className="mx-auto w-full max-w-xl px-4">
        {e.prevCode == null && isNew && e.isHost && e.status === 'open' && (
          <div className="mb-3 rounded-2xl p-4 text-[14px]" style={{ background: C.lime }}>
            <b>Your link is ready.</b> Send it to your group chat. Everything else happens on this page, so keep it handy.
            {key && <HostLinkButtons code={code} hostKey={key} />}
          </div>
        )}
        <EventCard e={e} onStatus={() => setSheet(true)} />
        <CrownStrip e={e} />
        {e.status === 'open' && <WeatherCard e={e} isHost={e.isHost} onRainCheck={() => setMoving(true)} />}
        {moving && e.isHost && e.status === 'open' && <MoveGame e={e} busy={busy} act={act} onDone={() => setMoving(false)} />}
        {err && <p className="mt-3 rounded-xl bg-[#fbe9e5] px-4 py-3 text-[14px] text-[#9c3a25]">{err}</p>}

        {e.status === 'open' && <OpenView e={e} meName={meR?.name} busy={busy} act={act} code={code} hereLink={hereLink} />}
        {e.status === 'live' && <LiveView e={e} tab={tab} setTab={setTab} busy={busy} act={act} canScore={e.isHost || !!e.me} code={code} hereLink={hereLink} />}
        {e.status === 'done' && <DoneView e={e} busy={busy} act={act} code={code} myName={meR?.name} />}

        {e.season && <SeasonTable e={e} />}
        {e.status !== 'done' && <PlaceMap e={e} className="mt-6" />}
        {e.isHost && <HostPanel e={e} busy={busy} act={act} hostKey={key} onMove={() => { setMoving(true); scrollTo({ top: 0, behavior: 'smooth' }); }} />}
        {sheet && <StatusSheet e={e} busy={busy} act={act} hostKey={e.isHost ? key : null} onClose={() => setSheet(false)} />}

        <div className="mt-10 text-center text-[13px]" style={{ color: C.muted }}>
          <Link href="/play" className="font-semibold underline underline-offset-4" style={{ color: C.ink }}>Host your own game in 60 seconds</Link>
          <span className="mx-2">·</span>
          <Link href={`/play/near?sport=${e.sport}`} className="font-semibold underline underline-offset-4" style={{ color: C.ink }}>Find a game near me</Link>
          <div className="mt-2">Racquets IRL by ClubMode · no app, no account</div>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function EventCard({ e, onStatus }: { e: PlayEvent; onStatus: () => void }) {
  const when = whenLine(e);
  const n = e.rsvps.filter((r) => r.status === 'in').length;
  return (
    <section className="rounded-3xl p-5 text-white shadow-lg" style={{ background: C.ink }}>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[1.5px]" style={{ color: '#bccdbb' }}>
        <span>{e.sport} · {FORMAT_NAME[e.format]}{e.level_min != null || e.level_max != null ? ` · ${levelLabel({ min: e.level_min ?? null, max: e.level_max ?? null }, e.sport)}` : e.level ? ` · ${e.level}` : ''}</span>
        <button type="button" onClick={onStatus} aria-label="Game status" className="flex items-center gap-1 rounded-full px-2.5 py-1 uppercase" style={e.status === 'live' ? { background: C.lime, color: C.ink } : { background: '#ffffff24', color: '#fff' }}>
          {e.status === 'open' ? 'Open' : e.status === 'live' ? '● Live' : 'Final'} <span aria-hidden>›</span>
        </button>
      </div>
      <h1 className="mt-2 text-[30px] font-medium leading-[1.05] tracking-tight">{e.title}</h1>
      <div className="mt-3 grid gap-1.5 text-[15px]">
        {when && <div className="flex items-center gap-2"><Clock className="h-4 w-4" style={{ color: C.lime }} />{when}</div>}
        {e.location && (
          <div className="flex items-center justify-between gap-3">
            <a className="flex min-w-0 items-center gap-2 underline-offset-4 hover:underline" target="_blank" rel="noreferrer" href={directionsUrl(e) ?? '#'}>
              <MapPin className="h-4 w-4 shrink-0" style={{ color: C.lime }} /><span className="min-w-0">{e.location}{e.place_address && <span className="block truncate text-[12px]" style={{ color: '#bccdbb' }}>{e.place_address}</span>}</span>
            </a>
            {e.place_lat == null && <Directions e={e} light />}
          </div>
        )}
        {e.host_name && <div className="text-[13px]" style={{ color: '#bccdbb' }}>Hosted by {e.host_name}</div>}
      </div>
      {e.status === 'open' && (
        <button type="button" onClick={onStatus} className="block w-full text-left">
          {e.spots != null && <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (n / e.spots) * 100)}%`, background: C.lime }} /></div>}
          <div className="mt-2 flex justify-between text-[13px]" style={{ color: '#dfe8dc' }}><span>{spotsLine(e)}</span><span className="font-semibold" style={{ color: C.lime }}>Status ›</span></div>
        </button>
      )}
      {e.notes && <p className="mt-3 text-[14px]" style={{ color: '#dfe8dc' }}>{e.notes}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
function JoinBox({ e, act, busy, here }: { e: PlayEvent; act: (b: Record<string, unknown>) => Promise<Res | undefined>; busy: string; here?: boolean }) {
  const [name, setN] = useState('');
  const [g, setG] = useState<'male' | 'female' | ''>('');
  const [team, setTeam] = useState<'A' | 'B' | ''>('');
  const [lvl, setLvl] = useState<number | null>(null);
  useEffect(() => { setN(getName()); setLvl(getMyLevel(e.sport)); }, [e.sport]);
  const range = { min: e.level_min ?? null, max: e.level_max ?? null };
  const note = levelNote(range, lvl, e.sport);
  const full = e.spots != null && e.rsvps.filter((r) => r.status === 'in').length >= e.spots && e.status === 'open';
  const go = async () => {
    if (!name.trim()) return;
    setName(name.trim());
    setMyLevel(e.sport, lvl);
    await act({ action: 'join', name: name.trim(), gender: g || null, team: team || null, level_num: lvl, here: !!here });
  };
  return (
    <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
      <div className="text-[18px] font-semibold">{e.status === 'live' || here ? 'Just got here? Check in' : full ? 'It’s full. Get on the waitlist' : 'You in?'}</div>
      <p className="mt-1 text-[14px]" style={{ color: C.muted }}>
        {e.status === 'live' ? 'Add your name and you’re in the next round.' : here ? 'Add your name and you’re checked in for tonight.' : full ? 'If someone drops, you move up automatically.' : 'Just your first name. No app, no account.'}
      </p>
      <form className="mt-3 flex gap-2" onSubmit={(x) => { x.preventDefault(); go(); }}>
        <input value={name} onChange={(x) => setN(x.target.value)} placeholder="First name + last initial" aria-label="Your name" maxLength={40}
          className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-3 text-[16px] outline-none" style={{ borderColor: C.line }} />
        <button disabled={!!busy || !name.trim()} className="rounded-xl px-5 text-[16px] font-semibold disabled:opacity-50" style={{ background: C.lime, color: C.ink }}>
          {busy === 'join' ? <Loader2 className="h-5 w-5 animate-spin" /> : here || e.status === 'live' ? 'I’m here' : full ? 'Waitlist' : 'I’m in'}
        </button>
      </form>
      <div className="mt-3">
        <LevelChips sport={e.sport} value={lvl} onChange={setLvl} size="sm" />
        <div className="mt-1 text-[12px]" style={{ color: note === 'below' || note === 'above' ? '#9c5a12' : C.muted }}>
          {note === 'below' ? `This one is ${levelLabel(range, e.sport)}. You can still join; the host sees your level.`
            : note === 'above' ? `This one is ${levelLabel(range, e.sport)}, a step below you. Still welcome; the host sees your level.`
            : note === 'fits' ? 'Right in range.' : 'Your level (optional). It helps the host balance the courts.'}
        </div>
      </div>
      {e.format === 'team-battle' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
          {(['A', 'B'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTeam(team === t ? '' : t)} className="rounded-lg border px-3 py-1.5 font-semibold"
              style={team === t ? { background: t === 'A' ? C.lime : '#ff9fc4', color: C.ink, borderColor: 'transparent' } : { borderColor: C.line }}>{teamName(e, t)}</button>
          ))}
          <span style={{ color: C.muted }}>{team ? '' : 'or we’ll even out the teams'}</span>
        </div>
      )}
      {e.format === 'mixed-doubles' && (
        <div className="mt-2 flex gap-2 text-[13px]">
          {(['male', 'female'] as const).map((x) => (
            <button key={x} type="button" onClick={() => setG(x)} className="rounded-lg border px-3 py-1.5" style={g === x ? { background: C.ink, color: '#fff' } : { borderColor: C.line }}>{x === 'male' ? 'M' : 'W'}</button>
          ))}
          <span className="self-center" style={{ color: C.muted }}>for mixed pairings</span>
        </div>
      )}
    </section>
  );
}

/** The message a group chat gets: several lines, link last so WhatsApp previews it. */
function groupText(e: PlayEvent, url: string) {
  const when = whenLine(e);
  return [
    `🎾 ${e.title}`,
    [when, e.location, e.level].filter(Boolean).join(' · '),
    `${FORMAT_NAME[e.format]} · ${spotsLine(e)}`,
    `Tap to join: ${url}`,
  ].filter(Boolean).join('\n');
}

/** WhatsApp with the message filled in, or copy it to paste anywhere (falls back to selected text). */
function GroupChatButtons({ text }: { text: () => string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const copy = async () => {
    const t = text();
    try { await navigator.clipboard.writeText(t); setCopied(true); setShown(null); setTimeout(() => setCopied(false), 2500); }
    catch { setShown(t); }
  };
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(text())}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold text-white" style={{ background: '#1f9e57' }}>
          <MessageCircle className="h-5 w-5" />WhatsApp
        </a>
        <button type="button" onClick={copy} className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold" style={{ background: C.lime, color: C.ink }}>
          {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}{copied ? 'Copied! Paste it' : 'Copy message'}
        </button>
      </div>
      {shown && <textarea readOnly value={shown} rows={5} autoFocus onFocus={(x) => x.currentTarget.select()} className="w-full rounded-xl border bg-white p-3 text-[15px]" style={{ borderColor: C.line }} />}
    </div>
  );
}

function ShareBox({ e, code }: { e: PlayEvent; code: string }) {
  const [qr, setQr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const url = `${location.origin}/p/${code}`;
  const msg = () => groupText(e, url);
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: '#103c32', light: '#ffffff' } }).then(setQr).catch(() => {}); }, [url]);
  const share = async () => {
    try { if (navigator.share) { await navigator.share({ title: e.title, text: msg() }); return; } } catch { return; }
    await navigator.clipboard?.writeText(msg());
  };
  return (
    <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
      <div className="text-[16px] font-semibold">Invite people</div>
      <p className="mb-3 text-[13px]" style={{ color: C.muted }}>Drop it in your group chat. Anyone can tap in, no app.</p>
      <GroupChatButtons text={msg} />
      <div className="mt-2 grid grid-cols-3 gap-2 text-[13px] font-semibold">
        <a href={`sms:?&body=${encodeURIComponent(msg())}`} className="flex flex-col items-center gap-1 rounded-2xl py-3" style={{ background: '#eef1e8' }}><MessageCircle className="h-5 w-5" />Text</a>
        <button onClick={share} className="flex flex-col items-center gap-1 rounded-2xl py-3" style={{ background: '#eef1e8' }}><Share2 className="h-5 w-5" />More</button>
        <button onClick={() => setShowQr((v) => !v)} className="flex flex-col items-center gap-1 rounded-2xl py-3" style={{ background: '#eef1e8' }}><QrCode className="h-5 w-5" />QR code</button>
      </div>
      <p className="mt-2 text-center text-[13px]" style={{ color: C.muted }}>{url.replace(/^https?:\/\//, '')}</p>
      {showQr && qr && (
        <div className="mt-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code to join" className="mx-auto w-60 rounded-xl" />
          <p className="mt-2 text-[13px]" style={{ color: C.muted }}>At the courts, people scan this and they&apos;re in.</p>
        </div>
      )}
    </section>
  );
}

function icsHref(e: PlayEvent, code: string) {
  if (!e.starts_at) return null;
  const s = new Date(e.starts_at), en = new Date(s.getTime() + 2 * 3600e3);
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClubMode//CourtConnect//EN', 'BEGIN:VEVENT', `UID:${code}@clubmode.ai`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(s)}`, `DTEND:${f(en)}`, `SUMMARY:${e.title}`, `LOCATION:${e.location ?? ''}`, `URL:https://clubmode.ai/p/${code}`, `DESCRIPTION:https://clubmode.ai/p/${code}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

export function OpenView({ e, meName, busy, act, code, hereLink }: { e: PlayEvent; meName?: string; busy: string; act: (b: Record<string, unknown>) => Promise<Res | undefined>; code: string; hereLink?: boolean }) {
  const ins = e.rsvps.filter((r) => r.status === 'in'), waits = e.rsvps.filter((r) => r.status === 'wait');
  const me = e.rsvps.find((r) => r.id === e.me);
  const ics = icsHref(e, code);
  return (
    <>
      {me ? (
        <section className="mt-4 rounded-3xl p-5 shadow-sm" style={{ background: C.lime }}>
          <div className="flex items-center gap-2 text-[18px] font-semibold"><Check className="h-5 w-5" />{me.status === 'wait' ? `You're on the waitlist, ${meName}` : `You're in, ${meName}!`}</div>
          <p className="mt-1 text-[14px]">{me.checked_in_at ? 'You’re checked in. You’ll see your court and partner here when it starts.' : me.status === 'wait' ? 'If a spot opens you move up automatically. Check back here.' : 'At the courts, open this link and tap “I’m here”. It will show your court and partner.'}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[13px] font-semibold">
            {me.checked_in_at
              ? <button onClick={() => act({ action: 'checkout' })} className="flex items-center gap-1 rounded-xl bg-white px-3 py-2"><Check className="h-4 w-4" />Checked in</button>
              : <button disabled={!!busy} onClick={() => act({ action: 'checkin' })} className="flex items-center gap-1 rounded-xl px-3 py-2 text-white" style={{ background: C.ink }}>{busy === 'checkin' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}I’m here</button>}
            {ics && <a href={ics} download={`${code}.ics`} className="flex items-center gap-1 rounded-xl bg-white/70 px-3 py-2"><Calendar className="h-4 w-4" />Add to calendar</a>}
            {!me.is_host && <button onClick={() => act({ action: 'leave' })} className="rounded-xl bg-white/40 px-3 py-2">Can&apos;t make it</button>}
          </div>
          <CrownAlert e={e} act={act} />
        </section>
      ) : (
        <JoinBox e={e} act={act} busy={busy} here={hereLink} />
      )}
      <TaleOfTheTape e={e} act={act} busy={busy} />
      <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between"><div className="text-[16px] font-semibold">Who&apos;s in ({e.spots != null ? `${ins.length}/${e.spots}` : ins.length})</div>
          {checkedIn(e).length > 0 && <div className="text-[13px] font-semibold" style={{ color: '#2f7a4f' }}>✓ {checkedIn(e).length} here</div>}</div>
        {e.format === 'team-battle' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(['A', 'B'] as const).map((t) => (
              <div key={t} className="rounded-2xl p-3" style={{ background: t === 'A' ? '#f1ffc8' : '#ffe4ef' }}>
                <div className="text-[13px] font-bold">{teamName(e, t)} · {ins.filter((r) => r.team === t).length}</div>
                <div className="mt-1 text-[14px]">{ins.filter((r) => r.team === t).map((r) => r.name).join(', ') || '—'}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {ins.map((r) => <span key={r.id} className="rounded-full px-3 py-1.5 text-[14px]" style={{ background: r.id === e.me ? C.lime : '#eef1e8' }}>{r.checked_in_at && <span className="mr-1 font-bold" style={{ color: '#2f7a4f' }} title="Here">✓</span>}{r.name}{r.level_num != null && <span className="ml-1 text-[12px] font-semibold tabular-nums" style={{ color: C.muted }}>{levelNum(r.level_num)}</span>}{r.is_host ? ' · host' : ''}</span>)}
          {Array.from({ length: e.spots == null ? 0 : Math.max(0, e.spots - ins.length) }).slice(0, 12).map((_, i) => <span key={i} className="rounded-full border border-dashed px-3 py-1.5 text-[14px]" style={{ borderColor: '#b9c4b5', color: '#9aa79c' }}>open</span>)}
        </div>
        {waits.length > 0 && <p className="mt-3 text-[13px]" style={{ color: C.muted }}>Waitlist: {waits.map((w) => w.name).join(', ')}</p>}
      </section>
      <ShareBox e={e} code={code} />
    </>
  );
}

/* ------------------------------------------------------------------ */
function useClock(startIso: string | null | undefined, minutes: number, pausedIso?: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  if (!startIso) return null;
  const at = pausedIso ? Date.parse(pausedIso) : now; // a paused clock stands still
  return Date.parse(startIso) + minutes * 60e3 - at;
}

export function LiveView({ e, tab, setTab, busy, act, canScore, code, hereLink }: { e: PlayEvent; tab: 'courts' | 'table'; setTab: (t: 'courts' | 'table') => void; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined>; canScore: boolean; code: string; hereLink?: boolean }) {
  const m = e.state.mixer!;
  const round = m.rounds[m.rounds.length - 1];
  const name = (id: string) => m.players.find((p) => p.id === id)?.name ?? '?';
  const left = useClock(e.state.roundStartedAt, e.round_minutes, e.state.pausedAt);
  const [pick, setPick] = useState<string | null>(null); // host swap: first player tapped
  const [swapping, setSwapping] = useState(false);
  const tap = e.isHost && swapping ? (id: string) => {
    if (!pick) { setPick(id); return; }
    if (pick !== id) act({ action: 'swap', a: pick, b: id }, 'swap');
    setPick(null);
  } : undefined;
  const inRotation = !!e.me && m.players.some((p) => p.id === e.me && !p.out);
  const mine = round?.matches.find((x) => [...x.teamA, ...x.teamB].includes(e.me ?? '-'));
  const sitting = round?.sittingOut.includes(e.me ?? '-');
  const st = standings(m);
  const mm = left == null ? '' : left <= 0 ? 'Time!' : `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
  const paused = !!e.state.pausedAt;
  return (
    <>
      <section className="mt-4 flex items-center justify-between rounded-3xl bg-white p-5 shadow-sm">
        <div><div className="text-[12px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>Round</div><div className="text-[40px] font-semibold leading-none">{round?.number ?? '–'}</div></div>
        <div className="text-right"><div className="text-[12px] font-semibold uppercase tracking-[1.5px]" style={{ color: paused ? '#b4432f' : C.muted }}>{paused ? 'Clock paused' : `${e.round_minutes} min rounds`}</div>
          <div className={`text-[40px] font-semibold leading-none tabular-nums ${left != null && left <= 0 ? 'text-[#b4432f]' : ''}`}>{mm}</div></div>
      </section>

      {e.format === 'team-battle' && <TeamBoard e={e} />}
      {e.isHost && <a href={`/p/${code}/tv`} target="_blank" rel="noopener" className="mt-2 block text-right text-[13px] font-semibold underline" style={{ color: C.ink }}>Open the TV / projector board ↗</a>}
      {e.me && !inRotation && (
        <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: C.lime }}>
          <div className="text-[18px] font-semibold">You&apos;re signed up. Here now?</div>
          <p className="mt-1 text-[14px]">Check in and you&apos;re in the next round.</p>
          <button disabled={!!busy} onClick={() => act({ action: 'checkin' }, 'checkin')} className="mt-3 flex items-center gap-2 rounded-xl px-4 py-2.5 text-[15px] font-semibold text-white" style={{ background: C.ink }}>
            {busy === 'checkin' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}I&apos;m here
          </button>
        </section>
      )}
      {e.me && inRotation && round && (
        <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: sitting ? '#e9eae3' : C.lime }}>
          {mine ? (
            <>
              <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">You&apos;re on</div>
              <div className="text-[44px] font-semibold leading-none">Court {courtLabel(m, mine.court)}</div>
              <div className="mt-2 text-[17px]">
                {mine.teamA.includes(e.me) ? <><b>{mine.teamA.map((i) => i === e.me ? 'You' : name(i)).join(' & ')}</b> vs {mine.teamB.map(name).join(' & ')}</>
                  : <><b>{mine.teamB.map((i) => i === e.me ? 'You' : name(i)).join(' & ')}</b> vs {mine.teamA.map(name).join(' & ')}</>}
              </div>
            </>
          ) : <div className="text-[18px] font-semibold">You sit this round. You&apos;re in the next one.</div>}
        </section>
      )}
      {!e.me && !e.isHost && <JoinBox e={e} act={act} busy={busy} here={hereLink} />}
      {!round && <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-[15px] shadow-sm">Rounds were reset. {e.isHost ? 'Tap “Next round” to make round 1.' : 'The host is making the next round.'}</p>}

      <div className="mt-4 flex gap-2 rounded-2xl bg-white p-1 text-[14px] font-semibold">
        {(['courts', 'table'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="flex-1 rounded-xl py-2" style={tab === t ? { background: C.ink, color: '#fff' } : {}}>{t === 'courts' ? 'Courts' : 'Leaderboard'}</button>
        ))}
      </div>

      {tab === 'courts' && round && e.isHost && (
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => { setSwapping((v) => !v); setPick(null); }} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold" style={swapping ? { background: C.ink, color: '#fff' } : { background: '#fff' }}>
            <ArrowLeftRight className="h-4 w-4" />{swapping ? 'Done swapping' : 'Swap players'}
          </button>
          {swapping && <span className="text-[13px]" style={{ color: C.muted }}>{pick ? `Now tap who ${name(pick)} trades places with` : 'Tap a player, then who they trade places with (sit-outs too).'}</span>}
        </div>
      )}
      {tab === 'courts' && round && (
        <section className="mt-3 grid gap-3">
          {round.matches.map((x) => <CourtCard key={x.court} x={x} label={courtLabel(m, x.court)} name={name} me={e.me} canScore={canScore} onTap={tap} picked={pick}
            save={(a, b, tiebreak) => act({ action: 'score', round: round.number, court: x.court, a, b, tiebreak }, `score${x.court}`)} saving={busy === `score${x.court}`} />)}
          {round.sittingOut.length > 0 && (
            <p className="px-2 text-[14px]" style={{ color: C.muted }}>Sitting out:{' '}
              {round.sittingOut.map((id, i) => tap
                ? <button key={id} onClick={() => tap(id)} className="mr-1 rounded-lg px-2 py-0.5 font-semibold" style={{ background: pick === id ? C.lime : '#fff', color: C.ink }}>{name(id)}</button>
                : <span key={id}>{i ? ', ' : ''}{name(id)}</span>)}
            </p>
          )}
        </section>
      )}
      {tab === 'table' && (
        <section className="mt-3 rounded-3xl bg-white p-4 shadow-sm">
          {st.length === 0 ? <p className="p-2 text-[14px]" style={{ color: C.muted }}>Scores show up here as courts finish.</p> : (
            <table className="w-full text-[15px]"><thead><tr className="text-left text-[12px] uppercase" style={{ color: C.muted }}><th className="py-1">#</th><th>Player</th><th className="text-right">W–L</th><th className="text-right">Games</th></tr></thead>
              <tbody>{st.map((s) => <tr key={s.id} className="border-t" style={{ borderColor: '#eef1e8', fontWeight: s.id === e.me ? 700 : 400 }}><td className="py-2">{s.rank}</td><td>{s.name}</td><td className="text-right">{s.wins}–{s.losses}</td><td className="text-right">{s.gamesFor}–{s.gamesAgainst}</td></tr>)}</tbody></table>
          )}
        </section>
      )}
      {e.isHost && <ShareBox e={e} code={code} />}
    </>
  );
}

function CourtCard({ x, label, name, me, canScore, save, saving, onTap, picked }: { x: GuestMatch; label: string; name: (id: string) => string; me: string | null; canScore: boolean; save: (a: number | null, b: number | null, tiebreak: 'A' | 'B' | null) => void; saving: boolean; onTap?: (id: string) => void; picked?: string | null }) {
  const [a, setA] = useState<number | null>(x.scoreA ?? null);
  const [b, setB] = useState<number | null>(x.scoreB ?? null);
  const [tb, setTb] = useState<'A' | 'B' | null>(x.tiebreak ?? null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) { setA(x.scoreA ?? null); setB(x.scoreB ?? null); setTb(x.tiebreak ?? null); } }, [x.scoreA, x.scoreB, x.tiebreak, editing]);
  const mineHere = !!me && [...x.teamA, ...x.teamB].includes(me);
  const done = isScored(x);
  const w = winnerOf(x);
  const tied = a != null && b != null && a === b && a > 0;
  const who = (ids: string[]) => ids.map((i) => (i === me ? 'You' : name(i))).join(' & ');
  const Side = ({ ids, v, setV, won }: { ids: string[]; v: number | null; setV: (n: number | null) => void; won: boolean }) => (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className={`text-[16px] ${won ? 'font-bold' : ''}`}>{onTap
        ? ids.map((i, k) => <button key={i} onClick={() => onTap(i)} className="mr-1 rounded-lg px-1.5 py-0.5" style={{ background: picked === i ? C.lime : '#eef1e8' }}>{k ? '& ' : ''}{name(i)}</button>)
        : who(ids)}{won && x.scoreA === x.scoreB ? <span className="ml-1 text-[11px] font-semibold" style={{ color: C.muted }}>(tiebreak)</span> : null}</div>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <button aria-label="minus" onClick={() => setV(Math.max(0, (v ?? 0) - 1))} className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: '#eef1e8' }}><Minus className="h-4 w-4" /></button>
          <b className="w-7 text-center text-[20px] tabular-nums">{v ?? 0}</b>
          <button aria-label="plus" onClick={() => setV(Math.min(99, (v ?? 0) + 1))} className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: '#eef1e8' }}><Plus className="h-4 w-4" /></button>
        </div>
      ) : <b className="text-[22px] tabular-nums">{v ?? '–'}</b>}
    </div>
  );
  return (
    <div className="rounded-3xl bg-white p-4 shadow-sm" style={mineHere ? { outline: `3px solid ${C.lime}` } : {}}>
      <div className="mb-1 flex items-center justify-between text-[12px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>
        <span>Court {label}</span>{done && !editing ? <span className="text-[#2f7a4f]">✓ in</span> : null}
      </div>
      <Side ids={x.teamA} v={a} setV={setA} won={!editing && w === 'A'} />
      <div className="border-t" style={{ borderColor: '#eef1e8' }} />
      <Side ids={x.teamB} v={b} setV={setB} won={!editing && w === 'B'} />
      {canScore && editing && tied && (
        <div className="mt-2 rounded-xl p-2 text-[13px]" style={{ background: '#fff7d6' }}>
          <div className="mb-1.5 font-semibold">Tied {a}–{b}. Who won the tiebreak?</div>
          <div className="grid grid-cols-2 gap-2">
            {(['A', 'B'] as const).map((t) => (
              <button key={t} onClick={() => setTb(t)} className="truncate rounded-lg px-2 py-2 font-semibold" style={tb === t ? { background: C.ink, color: '#fff' } : { background: '#fff' }}>{who(t === 'A' ? x.teamA : x.teamB)}</button>
            ))}
          </div>
        </div>
      )}
      {canScore && (editing ? (
        <div className="mt-2 flex gap-2">
          <button disabled={(a ?? 0) === 0 && (b ?? 0) === 0 || (tied && !tb)} onClick={() => { save(a ?? 0, b ?? 0, tied ? tb : null); setEditing(false); }} className="flex-1 rounded-xl py-2.5 text-[15px] font-semibold disabled:opacity-40" style={{ background: C.ink, color: '#fff' }}>Save score</button>
          <button onClick={() => setEditing(false)} className="rounded-xl px-4 text-[14px]" style={{ background: '#eef1e8' }}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => { setA(x.scoreA ?? 0); setB(x.scoreB ?? 0); setEditing(true); }} className="mt-2 w-full rounded-xl py-2 text-[14px] font-semibold" style={{ background: '#eef1e8' }}>
          {saving ? 'Saving…' : done ? 'Fix score' : 'Enter score'}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function DoneView({ e, busy, act, code, myName }: { e: PlayEvent; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined>; code: string; myName?: string }) {
  const m = e.state.mixer;
  const aw = useMemo(() => (m ? awards(m) : []), [m]);
  const st = m ? standings(m) : [];
  const [joinedNext, setJoinedNext] = useState(false);
  const next = e.state.nextCode;
  const url = typeof window !== 'undefined' ? `${location.origin}/p/${code}` : '';
  const share = async () => {
    const text = `${e.title}: ${aw[0] ? `${aw[0].who} took it (${aw[0].why}).` : 'done!'} Full recap:`;
    try { if (navigator.share) { await navigator.share({ title: e.title, text, url }); return; } } catch { return; }
    await navigator.clipboard?.writeText(`${text} ${url}`);
  };
  const joinNext = async () => {
    if (!next) return;
    const name = myName || getName();
    if (!name) { location.href = `/p/${next}`; return; }
    try {
      const r = await api<{ playerKey?: string }>(`/api/p/${next}`, { action: 'join', name }, getKey(next));
      if (r.playerKey) setKey(next, r.playerKey);
      setJoinedNext(true);
    } catch { location.href = `/p/${next}`; }
  };
  return (
    <>
      {e.format === 'team-battle' && <TeamBoard e={e} final />}
      <SportsDesk e={e} act={act} busy={busy} code={code} />
      {!e.me && !e.isHost && <YourGroup />}
      {e.me && <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm"><CrownAlert e={e} act={act} /></div>}
      {aw.length > 0 && (
        <section className="mt-4 overflow-hidden rounded-3xl shadow-sm" style={{ background: C.lime }}>
          <div className="p-6 text-center">
            <Trophy className="mx-auto h-8 w-8" />
            <div className="mt-2 text-[12px] font-semibold uppercase tracking-[2px]">Champion</div>
            <div className="text-[40px] font-semibold leading-tight tracking-tight">{aw[0].who}</div>
            <div className="text-[15px]">{aw[0].why}</div>
          </div>
          <div className="grid grid-cols-2 gap-px bg-[#103c3222]">
            {aw.slice(1).map((a, i, all) => (
              <div key={a.title} className={`bg-white/85 p-4 ${all.length % 2 && i === all.length - 1 ? 'col-span-2' : ''}`}>
                <div className="text-[22px]">{a.emoji}</div>
                <div className="text-[12px] font-semibold uppercase tracking-[1px]" style={{ color: C.muted }}>{a.title}</div>
                <div className="text-[16px] font-semibold leading-tight">{a.who}</div>
                <div className="text-[13px]" style={{ color: C.muted }}>{a.why}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={share} className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold text-white" style={{ background: C.ink }}><Share2 className="h-4 w-4" />Share the recap</button>
        {e.isHost ? (
          <button disabled={!!busy} onClick={async () => { const r = await act({ action: 'runback' }); if (r?.code) location.href = `/p/${r.code}?new=1`; }}
            className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold" style={{ background: C.lime }}>
            <RefreshCw className="h-4 w-4" />Run it back next week
          </button>
        ) : next ? (
          <button onClick={joinNext} disabled={joinedNext} className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold" style={{ background: C.lime }}>
            {joinedNext ? <><Check className="h-4 w-4" />In for next week</> : <>I&apos;m in next week</>}
          </button>
        ) : (
          <Link href="/play" className="flex items-center justify-center rounded-2xl py-3.5 text-[15px] font-semibold" style={{ background: C.lime }}>Host your own</Link>
        )}
      </div>
      <div className="mt-2"><GroupChatButtons text={() => `🏆 ${e.title}: ${aw[0] ? `${aw[0].who} took it (${aw[0].why}).` : 'final results are in.'}${e.state.recap ? '\n🎙️ ' + e.state.recap.headline : ''}\nFull recap: ${url}`} /></div>
      {joinedNext && next && <p className="mt-2 text-center text-[13px]"><Link className="underline" href={`/p/${next}`}>See next week&apos;s game</Link></p>}
      {st.length > 0 && (
        <section className="mt-4 rounded-3xl bg-white p-4 shadow-sm">
          <div className="mb-2 px-1 text-[16px] font-semibold">Final standings</div>
          <table className="w-full text-[15px]"><tbody>{st.map((s) => <tr key={s.id} className="border-t" style={{ borderColor: '#eef1e8', fontWeight: s.id === e.me ? 700 : 400 }}><td className="py-2 pl-1">{s.rank}</td><td>{s.name}</td><td className="text-right">{s.wins}–{s.losses}</td><td className="pr-1 text-right" style={{ color: C.muted }}>{s.gamesFor}–{s.gamesAgainst}</td></tr>)}</tbody></table>
        </section>
      )}
      {!m && <p className="mt-4 text-center text-[15px]" style={{ color: C.muted }}>This one is over.</p>}
    </>
  );
}

/* ------------------------------------------------------------------ */
function Toggle({ on, disabled, onChange, title, sub }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; title: string; sub: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className="flex items-center gap-3 rounded-2xl p-3 text-left disabled:opacity-60" style={{ background: '#eef1e8' }}>
      <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold">{title}</span><span className="block text-[12px]" style={{ color: C.muted }}>{sub}</span></span>
      <span className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: on ? C.ink : '#c9d1c4' }}>
        <span className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" style={{ left: on ? 24 : 4 }} />
      </span>
    </button>
  );
}

/** Rain check: pick a new time, then tell the group. Everyone already in stays in. */
function MoveGame({ e, busy, act, onDone }: { e: PlayEvent; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined>; onDone: () => void }) {
  const base = e.starts_at ? new Date(Date.parse(e.starts_at) + 864e5) : new Date(Date.now() + 864e5);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const [v, setV] = useState(`${base.getFullYear()}-${p2(base.getMonth() + 1)}-${p2(base.getDate())}T${p2(base.getHours())}:${p2(base.getMinutes())}`);
  const [moved, setMoved] = useState<string | null>(null);
  const url = `${location.origin}/p/${e.code}`;
  if (moved) return (
    <section className="mt-4 rounded-3xl p-5 shadow-sm" style={{ background: C.lime }}>
      <div className="text-[17px] font-semibold">Moved to {moved}. Now tell the group.</div>
      <p className="mt-1 text-[14px]">Same link. Everyone who was in is still in.</p>
      <div className="mt-3"><GroupChatButtons text={() => `🌧️ Rain check: ${e.title} is moved to ${moved}.\nSame link, you're still in. Can't make the new time? Tap "Can't make it" so a sub gets your spot.\n${url}`} /></div>
      <button onClick={onDone} className="mt-3 text-[14px] font-semibold underline underline-offset-4">Done</button>
    </section>
  );
  return (
    <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
      <div className="text-[17px] font-semibold">Move the game</div>
      <p className="mt-1 text-[14px]" style={{ color: C.muted }}>Pick the new time. Everyone stays in, and you get a message for the group.</p>
      <input type="datetime-local" value={v} onChange={(x) => setV(x.target.value)} aria-label="New time" className="mt-3 w-full rounded-xl border px-3 py-3 text-[16px]" style={{ borderColor: C.line }} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={onDone} className="rounded-xl py-3 text-[15px] font-semibold" style={{ background: '#eef1e8' }}>Cancel</button>
        <button disabled={!!busy || !v} onClick={async () => {
          const iso = new Date(v).toISOString();
          const r = await act({ action: 'edit', draft: { starts_at: iso, when_text: null } }, 'move');
          if (r) setMoved(whenLine({ starts_at: iso, when_text: null }) ?? 'the new time');
        }} className="flex items-center justify-center gap-2 rounded-xl py-3 text-[15px] font-semibold text-white disabled:opacity-50" style={{ background: C.ink }}>
          {busy === 'move' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Move it
        </button>
      </div>
    </section>
  );
}

/** A weekly series: the running table across nights. */
function SeasonTable({ e }: { e: PlayEvent }) {
  const s = e.season!;
  const meName = e.rsvps.find((r) => r.id === e.me)?.name.toLowerCase();
  return (
    <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <div className="text-[16px] font-semibold">Season table</div>
        <div className="text-[12px]" style={{ color: C.muted }}>{s.nights} nights</div>
      </div>
      <table className="mt-2 w-full text-[14px] tabular-nums">
        <thead><tr className="text-left text-[11px] uppercase tracking-[1px]" style={{ color: C.muted }}><th className="py-1">#</th><th>Player</th><th className="text-right">Nights</th><th className="text-right">W–L</th><th className="text-right">Games</th></tr></thead>
        <tbody>
          {s.rows.slice(0, 12).map((r, i) => (
            <tr key={r.name} className="border-t" style={{ borderColor: '#eef1e8', background: r.name.toLowerCase() === meName ? '#f1ffc8' : undefined }}>
              <td className="py-1.5 font-semibold">{i + 1}</td><td className="font-semibold">{r.name}</td><td className="text-right">{r.nights}</td><td className="text-right">{r.wins}–{r.losses}</td><td className="text-right">{r.games}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Host fixes or pins the place after the game is made. */
function ChangePlace({ e, busy, act }: { e: PlayEvent; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined> }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<Place>({ location: e.location, place_address: e.place_address ?? null, place_lat: e.place_lat ?? null, place_lng: e.place_lng ?? null });
  if (!open) return (
    <button type="button" onClick={() => { setP({ location: e.location, place_address: e.place_address ?? null, place_lat: e.place_lat ?? null, place_lng: e.place_lng ?? null }); setOpen(true); }}
      className="flex items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-semibold" style={{ background: '#eef1e8' }}>
      <MapPin className="h-4 w-4" />{e.place_lat != null ? 'Change the place' : e.location ? 'Pin the place on the map' : 'Add the place'}
    </button>
  );
  return (
    <div className="rounded-2xl p-3" style={{ background: '#eef1e8' }}>
      <div className="rounded-xl bg-white px-3 py-2.5 text-[15px]"><PlacePicker value={p} onChange={setP} dark={false} autoFocus /></div>
      <div className="mt-1.5 text-[12px]" style={{ color: C.muted }}>Pick a suggestion to pin it on the map. Everyone’s page updates.</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl bg-white py-2.5 text-[14px] font-semibold">Cancel</button>
        <button type="button" disabled={!!busy || !p.location?.trim()} onClick={async () => { const r = await act({ action: 'edit', draft: { ...p, location: p.location?.trim() || null } }, 'edit'); if (r) setOpen(false); }}
          className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: C.ink }}>
          {busy === 'edit' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save place
        </button>
      </div>
    </div>
  );
}

export function HostPanel({ e, busy, act, hostKey, onMove }: { e: PlayEvent; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined>; hostKey: string | null; onMove?: () => void }) {
  const [names, setNames] = useState('');
  const [open, setOpen] = useState(false);
  const [addHere, setAddHere] = useState(e.status === 'live');
  const m = e.state.mixer;
  const ins = e.rsvps.filter((r) => r.status === 'in');
  const here = checkedIn(e);
  const need = perCourt(e.format);
  const round = m?.rounds[m.rounds.length - 1];
  const unscored = round ? round.matches.filter((x) => !isScored(x)).length : 0;
  const inMixer = new Set((m?.players ?? []).filter((p) => !p.out).map((p) => p.id));
  const isHere = (id: string) => (e.status === 'live' ? inMixer.has(id) : !!e.rsvps.find((r) => r.id === id)?.checked_in_at);
  const pairing = m?.pairing ?? e.state.pairingPref ?? 'smart';
  const Btn = ({ onClick, children, primary, disabled }: { onClick: () => void; children: React.ReactNode; primary?: boolean; disabled?: boolean }) => (
    <button onClick={onClick} disabled={!!busy || disabled} className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold disabled:opacity-50"
      style={primary ? { background: C.ink, color: '#fff' } : { background: '#eef1e8' }}>{children}</button>
  );
  if (e.status === 'done') return (
    <section className="mt-6 rounded-3xl border border-dashed p-4" style={{ borderColor: '#b9c4b5' }}>
      <div className="text-[12px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>Host</div>
      <button className="mt-2 text-[14px] underline" onClick={() => act({ action: 'reopen' })}>Reopen this event</button>
    </section>
  );
  return (
    <section className="mt-6 rounded-3xl border-2 p-4" style={{ borderColor: C.ink }}>
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">Host controls</div>
        <div className="flex items-center gap-2 text-[13px]">
          Courts
          <button aria-label="Fewer courts" onClick={() => act({ action: 'courts', courts: e.courts - 1 })} className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: '#eef1e8' }}><Minus className="h-4 w-4" /></button>
          <b>{e.courts}</b>
          <button aria-label="More courts" onClick={() => act({ action: 'courts', courts: e.courts + 1 })} className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: '#eef1e8' }}><Plus className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
        {e.status === 'open' && <SubButton e={e} />}
        <a href={`/p/${e.code}/tv`} target="_blank" rel="noopener" className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold" style={{ background: '#eef1e8' }}>TV / projector board ↗</a>
        <ChangePlace e={e} busy={busy} act={act} />
        {e.status === 'open' && onMove && <Btn onClick={onMove}><Clock className="h-4 w-4" />Move the game (rain check)</Btn>}
        <Toggle on={!!e.listed} disabled={!!busy || (!e.listed && e.place_lat == null)} onChange={(v) => act({ action: 'list', on: v }, 'list')}
          title="Let nearby players find it" sub={e.place_lat == null ? 'Pin the place first. Then players near you at this level can find it and tap in.' : 'Shows on “Games near me” while it needs players, and pings nearby players at this level.'} />
        <Toggle on={!!e.repeat_weekly} disabled={!!busy} onChange={(v) => act({ action: 'weekly', on: v }, 'weekly')}
          title="Every week" sub="Next week’s game makes itself after this one, and a season table keeps score across nights." />
        {e.repeat_weekly && e.state.weeklyPaywall && !e.state.nextCode && (
          <a href="/play/pass" className="rounded-2xl p-3 text-[14px] font-semibold" style={{ background: C.lime }}>Next week’s game is waiting on a Host Pass. Get one and it’s made right away ›</a>
        )}
        {e.state.nextCode && <Link href={`/p/${e.state.nextCode}`} className="rounded-2xl p-3 text-center text-[14px] font-semibold" style={{ background: '#eef1e8' }}>Next week’s game is up ›</Link>}
        {e.status === 'open' && <CheckInList e={e} busy={busy} act={act} />}
        {e.status === 'open' && (
          <Btn primary onClick={() => act({ action: 'start' })} disabled={here.length < need}>
            {busy === 'start' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            {here.length < need ? (here.length ? `${here.length} checked in · need ${need - here.length} more` : 'Check people in to start') : `Start with ${here.length} checked in`}
          </Btn>
        )}
        {e.status === 'live' && (
          <>
            <Btn primary onClick={() => { if (unscored && !confirm(`${unscored} court${unscored > 1 ? 's have' : ' has'} no score yet. Start the next round anyway?`)) return; act({ action: 'next' }); }}>
              {busy === 'next' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}Next round
            </Btn>
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => { if (round && round.matches.some(isScored) && !confirm('Reshuffle this round? Its scores are cleared.')) return; act({ action: 'reshuffle' }); }}><Shuffle className="h-4 w-4" />Reshuffle</Btn>
              <Btn onClick={() => { if (confirm('End the night and show the recap?')) act({ action: 'end' }); }}><Square className="h-4 w-4" />End + recap</Btn>
            </div>
            <ClockControls e={e} busy={busy} act={act} />
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => { if (confirm(`Take back round ${round?.number ?? ''}? Its pairings and scores are removed.`)) act({ action: 'undo_round' }); }} disabled={!round}><Undo2 className="h-4 w-4" />Undo last round</Btn>
              <Btn onClick={() => { if (confirm('Start the rounds over from round 1? Every round and score so far is removed; players stay checked in.')) act({ action: 'reset_rounds' }); }} disabled={!m?.rounds.length}><RefreshCw className="h-4 w-4" />Start rounds over</Btn>
            </div>
            <FormatSwitch e={e} busy={busy} act={act} />
          </>
        )}
        <Toggle on={pairing === 'smart'} disabled={!!busy} onChange={(v) => act({ action: 'pairing', mode: v ? 'smart' : 'random' }, 'pairing')}
          title="Balance courts by level"
          sub={pairing === 'smart' ? 'Round 1 puts strong and newer players on every court (by the levels people picked). Then courts are grouped by how people are doing. Partners still rotate.' : 'Random shuffle each round (still no repeat partners and fair sit-outs).'} />
        <CourtNumbers e={e} busy={busy} act={act} />
        {e.format === 'team-battle' && <TeamNames e={e} act={act} />}
        {e.format === 'team-battle' && <TeamSplit e={e} busy={busy} act={act} />}
        <button onClick={() => setOpen((v) => !v)} className="mt-1 flex items-center justify-center gap-2 text-[14px] font-semibold"><UserPlus className="h-4 w-4" />Add players or manage the list</button>
        {open && (
          <div className="grid gap-2">
            <textarea value={names} onChange={(x) => setNames(x.target.value)} rows={3} placeholder="Walk-ups or a pasted list: one name per line or commas"
              className="rounded-xl border bg-white p-3 text-[16px] outline-none" style={{ borderColor: C.line }} />
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={addHere} onChange={(x) => setAddHere(x.target.checked)} className="h-4 w-4 accent-[#103c32]" />They&apos;re here now (check them in)</label>
            <Btn onClick={async () => { await act({ action: 'add', names, checkin: addHere }); setNames(''); }} disabled={!names.trim()}>Add</Btn>
            <div className="flex flex-wrap gap-2 pt-1">
              {e.rsvps.filter((r) => r.status !== 'out').map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1 rounded-full py-1 pl-1 pr-1 text-[13px]" style={{ background: '#eef1e8' }}>
                  <button aria-label={isHere(r.id) ? `Check ${r.name} out` : `Check ${r.name} in`} title={isHere(r.id) ? 'Here (tap to check out)' : 'Not here (tap to check in)'}
                    onClick={() => act({ action: isHere(r.id) ? 'checkout' : 'checkin', id: r.id })}
                    className="grid h-6 w-6 place-items-center rounded-full border" style={isHere(r.id) ? { background: C.ink, color: '#fff', borderColor: C.ink } : { background: '#fff', borderColor: '#b9c4b5' }}>
                    {isHere(r.id) ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                  {r.name}{r.status === 'wait' ? ' (waitlist)' : ''}
                  {e.format === 'team-battle' && (
                    <button onClick={() => act({ action: 'team', id: r.id, team: r.team === 'A' ? 'B' : 'A' })} className="rounded-full px-1.5 text-[11px] font-bold" style={{ background: r.team === 'B' ? '#ff9fc4' : r.team === 'A' ? C.lime : '#fff' }}>{r.team ? teamName(e, r.team).slice(0, 10) : 'Team?'}</button>
                  )}
                  {e.format === 'mixed-doubles' && (
                    <button onClick={() => act({ action: 'gender', id: r.id, gender: r.gender === 'male' ? 'female' : 'male' })} className="rounded-full bg-white px-1.5 text-[11px] font-bold">{r.gender === 'male' ? 'M' : r.gender === 'female' ? 'W' : 'M/W?'}</button>
                  )}
                  {!r.is_host && <button aria-label={`Remove ${r.name}`} onClick={() => act({ action: 'remove', id: r.id })} className="grid h-6 w-6 place-items-center rounded-full bg-white"><X className="h-3.5 w-3.5" /></button>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="mt-3 text-[12px]" style={{ color: C.muted }}>Run it from another phone too: send yourself the host link. Don&apos;t post that one in the group.</p>
      {hostKey && <HostLinkButtons code={e.code} hostKey={hostKey} />}
    </section>
  );
}

/* ---------- Check-in (MixerMode's "who's here"): only checked-in players go on courts ---------- */
function CheckInList({ e, busy, act }: { e: PlayEvent; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined> }) {
  const list = e.rsvps.filter((r) => r.status !== 'out');
  const here = list.filter((r) => r.checked_in_at).length;
  const [qr, setQr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const url = `${location.origin}/p/${e.code}?here=1`;
  useEffect(() => { if (showQr && !qr) QRCode.toDataURL(url, { margin: 1, width: 520, color: { dark: '#103c32', light: '#ffffff' } }).then(setQr).catch(() => {}); }, [showQr, qr, url]);
  return (
    <div className="rounded-2xl p-3" style={{ background: '#eef1e8' }}>
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold">Check-in · {here} of {list.length} here</div>
        <div className="flex gap-1.5 text-[12px] font-semibold">
          <button disabled={!!busy || !list.length} onClick={() => act({ action: 'checkin_all' }, 'checkin_all')} className="rounded-lg bg-white px-2.5 py-1.5">Check in everyone</button>
          {here > 0 && <button disabled={!!busy} onClick={() => { if (confirm('Clear every check-in?')) act({ action: 'checkin_clear' }, 'checkin_clear'); }} className="rounded-lg bg-white/60 px-2.5 py-1.5">Clear</button>}
        </div>
      </div>
      <p className="mt-1 text-[12px]" style={{ color: C.muted }}>Tap names as people arrive, or let them check themselves in: they tap “I’m here” on the link, or scan the court QR. Only checked-in players get courts; anyone else sits until they check in.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {list.map((r) => (
          <button key={r.id} disabled={!!busy} onClick={() => act({ action: r.checked_in_at ? 'checkout' : 'checkin', id: r.id }, 'ci' + r.id)}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[14px]" style={r.checked_in_at ? { background: C.ink, color: '#fff' } : { background: '#fff' }}>
            {r.checked_in_at ? <Check className="h-3.5 w-3.5" /> : null}{r.name}{r.status === 'wait' ? ' (wait)' : ''}
          </button>
        ))}
        {!list.length && <span className="text-[13px]" style={{ color: C.muted }}>Nobody has tapped in yet.</span>}
      </div>
      <button onClick={() => setShowQr((v) => !v)} className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold underline underline-offset-4"><QrCode className="h-4 w-4" />{showQr ? 'Hide' : 'Show'} the check-in QR for the courts</button>
      {showQr && qr && (
        <div className="mt-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Scan to check in" className="mx-auto w-64 rounded-xl" />
          <p className="mt-1 text-[12px]" style={{ color: C.muted }}>Players scan this at the courts: it signs them up if needed and checks them in.</p>
        </div>
      )}
    </div>
  );
}

/* Round clock: pause / resume / add time / restart (MixerMode's RoundTimer controls). */
function ClockControls({ e, busy, act }: { e: PlayEvent; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined> }) {
  const paused = !!e.state.pausedAt;
  const b = 'flex items-center justify-center gap-1 rounded-xl py-2.5 text-[13px] font-semibold disabled:opacity-50';
  return (
    <div className="grid grid-cols-4 gap-1.5">
      <button disabled={!!busy} onClick={() => act({ action: 'timer', op: paused ? 'resume' : 'pause' }, 'timer')} className={b} style={{ background: paused ? C.lime : '#eef1e8' }}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{paused ? 'Resume' : 'Pause'}</button>
      <button disabled={!!busy} onClick={() => act({ action: 'timer', op: 'extend', min: 2 }, 'timer')} className={b} style={{ background: '#eef1e8' }}>+2 min</button>
      <button disabled={!!busy} onClick={() => act({ action: 'timer', op: 'extend', min: 5 }, 'timer')} className={b} style={{ background: '#eef1e8' }}>+5 min</button>
      <button disabled={!!busy} onClick={() => act({ action: 'timer', op: 'restart' }, 'timer')} className={b} style={{ background: '#eef1e8' }}><RefreshCw className="h-3.5 w-3.5" />Restart</button>
    </div>
  );
}

/* People didn't show (or more did): switch the format mid-night; it applies from the next round. */
function FormatSwitch({ e, busy, act }: { e: PlayEvent; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined> }) {
  const opts: GuestFormat[] = ['maximize-courts', 'doubles', 'mixed-doubles', 'singles', 'king-of-court', 'team-battle'];
  return (
    <label className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 text-[14px]" style={{ background: '#eef1e8' }}>
      <span className="font-semibold">Format <span className="font-normal" style={{ color: C.muted }}>(from the next round)</span></span>
      <select value={e.format} disabled={!!busy} onChange={(x) => act({ action: 'edit', draft: { format: x.target.value } }, 'edit')} className="rounded-lg bg-white px-2 py-1.5 text-[14px]">
        {opts.map((f) => <option key={f} value={f}>{FORMAT_NAME[f]}</option>)}
      </select>
    </label>
  );
}

/* The club's own court numbers (MixerMode's court names): "5-8" or "5, 6, Center". */
function CourtNumbers({ e, busy, act }: { e: PlayEvent; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined> }) {
  const cur = (e.state.mixer?.courtLabels ?? e.state.courtLabels ?? []).join(', ');
  const [v, setV] = useState(cur);
  useEffect(() => setV(cur), [cur]);
  return (
    <form className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: '#eef1e8' }} onSubmit={(x) => { x.preventDefault(); act({ action: 'labels', labels: v }, 'labels'); }}>
      <span className="shrink-0 text-[14px] font-semibold">Court numbers</span>
      <input value={v} onChange={(x) => setV(x.target.value)} placeholder={`1–${e.courts} (e.g. 5-8)`} aria-label="Court numbers" className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 text-[15px] outline-none" />
      <button disabled={!!busy || v === cur} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40" style={{ background: C.ink }}>Save</button>
    </form>
  );
}

/* Team Battle: how many singles vs doubles courts (MixerMode's TeamBattleTab setting). */
function TeamSplit({ e, busy, act }: { e: PlayEvent; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined> }) {
  const cur = e.state.mixer?.teamSplit ?? e.state.teamSplit ?? null;
  const [d, setD] = useState(cur?.doubles ?? Math.max(1, e.courts - 1));
  const [sg, setSg] = useState(cur?.singles ?? (e.courts > 1 ? 1 : 0));
  const step = (v: number, set: (n: number) => void, delta: number) => set(Math.max(0, Math.min(e.courts, v + delta)));
  return (
    <div className="rounded-2xl p-3 text-[14px]" style={{ background: '#eef1e8' }}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Court split</span>
        <span style={{ color: C.muted }}>{cur ? `${cur.doubles} doubles + ${cur.singles} singles` : 'Auto (as many doubles as fit)'}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {([['Doubles', d, setD], ['Singles', sg, setSg]] as const).map(([lab, v, set]) => (
          <span key={lab} className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1">{lab}
            <button type="button" aria-label={`Fewer ${lab}`} onClick={() => step(v, set, -1)} className="px-1">−</button><b>{v}</b>
            <button type="button" aria-label={`More ${lab}`} onClick={() => step(v, set, 1)} className="px-1">+</button></span>
        ))}
        <button disabled={!!busy || d + sg < 1} onClick={() => act({ action: 'teamsplit', doubles: d, singles: sg }, 'split')} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40" style={{ background: C.ink }}>Use this split</button>
        {cur && <button disabled={!!busy} onClick={() => act({ action: 'teamsplit', auto: true }, 'split')} className="text-[13px] underline">Auto</button>}
      </div>
      <p className="mt-1 text-[12px]" style={{ color: C.muted }}>Lines line up by level, strongest on court 1, like team tennis.</p>
    </div>
  );
}

/* "Your game always happens": one tap drafts the urgent ask for open spots. */
function SubButton({ e }: { e: PlayEvent }) {
  if (e.spots == null) return null; // no cap: nothing to fill
  const open = e.spots - e.rsvps.filter((r) => r.status === 'in').length;
  if (open <= 0) return null;
  const url = `${location.origin}/p/${e.code}`;
  const soon = e.starts_at && Date.parse(e.starts_at) - Date.now() < 18 * 3600e3;
  const when = whenLine(e) ?? '';
  const msg = () => `Need ${open} for ${e.format === 'singles' ? 'singles' : e.sport === 'pickleball' ? 'pickleball' : 'doubles'}${soon ? ' — ' + (when.toUpperCase() || 'SOON') : when ? ' ' + when : ''}${e.location ? ', ' + e.location : ''}${e.level ? ', ' + e.level : ''}. First to tap gets it: ${url}`;
  return (
    <div className="rounded-2xl p-3" style={{ background: '#eef1e8' }}>
      <div className="mb-2 text-[14px] font-semibold">Need {open} more? Send the sub call</div>
      <GroupChatButtons text={msg} compact />
    </div>
  );
}

/* King of the Court: the stakes, before, during and after. */
function CrownStrip({ e }: { e: PlayEvent }) {
  const c = e.crown;
  if (!e.location || !c) return null;
  const k = c.king, q = c.queen;
  const holder = [k && `${k.name} (${k.wins} W)`, q && `Queen ${q.name} (${q.wins} W)`].filter(Boolean).join(' · ');
  const line = e.status === 'done'
    ? (holder ? `Crown at ${c.place}: ${holder}` : `Results count toward the crown at ${c.place}.`)
    : holder ? `Reigning at ${c.place}: ${holder}. Win tonight and take it.` : `Nobody holds the crown at ${c.place} yet. Win tonight and it's yours.`;
  return (
    <Link href={`/court/${c.slug}`} className="mt-3 flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 text-[14px] shadow-sm" style={{ borderColor: '#e7d58a' }}>
      <span className="text-[26px] leading-none">👑</span>
      <span className="flex-1"><b className="block text-[12px] uppercase tracking-[1.5px]" style={{ color: '#8a6d00' }}>King of the Court</b>{line}</span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}

/* ---------- "Call the game": the AI sportscaster recap ---------- */
function SportsDesk({ e, act, busy, code }: { e: PlayEvent; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined>; busy: string; code: string }) {
  const r = e.state.recap;
  const brand = useContext(BrandContext);
  const [sharing, setSharing] = useState(false);
  if (!r) {
    if (!e.state.mixer) return null;
    if (!e.isHost) return <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-[14px] shadow-sm">🎙️ The sportscaster&apos;s write-up of tonight lands here in a moment, with a line about you.</p>;
    return (
      <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
        <div className="text-[18px] font-semibold">🎙️ Call the game</div>
        <p className="mt-1 text-[14px]" style={{ color: C.muted }}>Our sportscaster writes up tonight from the real scores, with a line for every player.</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[14px] font-semibold">
          {(['mild', 'club', 'locker'] as const).map((sp) => (
            <button key={sp} disabled={!!busy} onClick={() => act({ action: 'recap', spice: sp }, 'recap')} className="rounded-xl py-3 disabled:opacity-50" style={{ background: sp === 'club' ? C.lime : '#eef1e8' }}>
              {busy === 'recap' ? '…' : sp === 'mild' ? 'Mild' : sp === 'club' ? 'Club' : 'Locker room'}
            </button>
          ))}
        </div>
      </section>
    );
  }
  const mine = r.lines.find((l) => l.id === e.me);
  const shareMine = async () => {
    if (!mine) return;
    setSharing(true);
    const url = `${location.origin}/p/${code}`;
    const text = `${mine.tag}: ${mine.line} ${url}`;
    try {
      const blob = await fetch(`/p/${code}/card/${mine.id}`).then((x) => x.blob());
      const file = new File([blob], 'courtconnect.png', { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare?.({ files: [file] })) await navigator.share({ files: [file], text });
      else if (navigator.share) await navigator.share({ text, url });
      else window.open(`/p/${code}/card/${mine.id}`, '_blank');
    } catch { /* cancelled */ }
    setSharing(false);
  };
  return (
    <section className="mt-4 overflow-hidden rounded-3xl bg-white shadow-sm">
      <div className="border-b-4 px-5 pb-3 pt-4" style={{ borderColor: C.ink }}>
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[2px]" style={{ color: C.muted }}>
          <span>🎙️ The {brand} Daily</span><span>{r.spice === 'locker' ? 'Locker room edition' : r.spice === 'mild' ? 'Family edition' : 'Club edition'}</span>
        </div>
        <h2 className="mt-2 font-serif text-[28px] font-bold leading-[1.1]">{r.headline}</h2>
      </div>
      <div className="px-5 py-4">
        {r.crown && <p className="mb-3 rounded-xl px-3 py-2 text-[15px] font-semibold" style={{ background: '#fff7d6' }}>{r.crown}</p>}
        <p className="font-serif text-[16px] leading-relaxed">{r.story}</p>
      </div>
      {mine && !mine.skipped && (
        <div className="mx-4 mb-4 rounded-2xl p-4" style={{ background: C.lime }}>
          <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">You, tonight · {mine.tag}</div>
          <p className="mt-1 text-[17px] font-medium leading-snug">{mine.line}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[13px] font-semibold">
            <button onClick={shareMine} className="rounded-xl px-4 py-2 text-white" style={{ background: C.ink }}>{sharing ? 'Opening…' : 'Share my card'}</button>
            <button disabled={!!busy} onClick={() => act({ action: 'recap_me', mode: 'soften' }, 'soften')} className="rounded-xl bg-white/70 px-3 py-2">{busy === 'soften' ? 'Softening…' : 'Soften it'}</button>
            <button disabled={!!busy} onClick={() => act({ action: 'recap_me', mode: 'skip' })} className="rounded-xl bg-white/40 px-3 py-2">Leave me out</button>
          </div>
        </div>
      )}
      {mine?.skipped && (
        <p className="mx-5 mb-4 text-[13px]" style={{ color: C.muted }}>You&apos;re left out of the write-up. <button className="underline" onClick={() => act({ action: 'recap_me', mode: 'show' })}>Put me back</button></p>
      )}
      <div className="grid gap-px border-t bg-[#eef1e8]" style={{ borderColor: '#eef1e8' }}>
        {r.lines.filter((l) => !l.skipped && l.id !== e.me).map((l) => (
          <div key={l.id} className="bg-white px-5 py-3">
            <div className="text-[13px] font-semibold">{l.name} <span className="font-normal" style={{ color: C.muted }}>· {l.tag}</span></div>
            <p className="text-[15px] leading-snug">{l.line}</p>
          </div>
        ))}
      </div>
      {e.isHost && (
        <div className="flex items-center justify-between border-t px-5 py-3 text-[13px]" style={{ borderColor: '#eef1e8', color: C.muted }}>
          <span>Call it again:</span>
          <span className="flex gap-2">{(['mild', 'club', 'locker'] as const).map((sp) => <button key={sp} disabled={!!busy} onClick={() => act({ action: 'recap', spice: sp }, 'recap')} className="rounded-lg px-2 py-1 font-semibold" style={{ background: '#eef1e8' }}>{busy === 'recap' ? '…' : sp === 'locker' ? 'Locker' : sp[0].toUpperCase() + sp.slice(1)}</button>)}</span>
        </div>
      )}
    </section>
  );
}

/* ---------- Pre-game "Tale of the Tape": the invite is the entertainment ---------- */
function TaleOfTheTape({ e, act, busy }: { e: PlayEvent; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined>; busy: string }) {
  const p = e.state.preview;
  const asked = useRef(false);
  useEffect(() => {
    if (!p && e.isHost && !asked.current && e.rsvps.some((r) => r.status === 'in')) { asked.current = true; act({ action: 'hype' }, 'hype'); }
  }, [p, e.isHost, e.rsvps, act]);
  if (!p) return busy === 'hype' ? <p className="mt-4 text-center text-[14px]" style={{ color: C.muted }}>🎙️ The announcer is warming up…</p> : null;
  const ins = new Set(e.rsvps.filter((r) => r.status === 'in').map((r) => r.id));
  return (
    <section data-demo="tape" className="mt-4 overflow-hidden rounded-3xl text-white shadow-sm" style={{ background: '#1d1d1b' }}>
      <div className="px-5 pt-4 text-[11px] font-semibold uppercase tracking-[2px]" style={{ color: C.lime }}>🎙️ Tale of the tape</div>
      <h2 className="px-5 pb-3 pt-1 text-[24px] font-bold uppercase leading-[1.05] tracking-tight">{p.headline}</h2>
      <div className="grid gap-px bg-white/10">
        {p.lines.filter((l) => ins.has(l.id)).map((l) => (
          <div key={l.id} className="px-5 py-2.5" style={{ background: '#1d1d1b' }}>
            <span className="font-semibold" style={{ color: l.id === e.me ? C.lime : '#fff' }}>{l.name}</span>
            <span className="text-[14px]" style={{ color: '#d6d6cf' }}> · {l.line}</span>
          </div>
        ))}
        {e.spots != null && e.spots - ins.size > 0 && <div className="px-5 py-2.5 text-[14px]" style={{ background: '#1d1d1b', color: '#9b9b93' }}>{e.spots - ins.size} spot{e.spots - ins.size === 1 ? '' : 's'} open. Your line is waiting.</div>}
      </div>
      {e.isHost && <button disabled={!!busy} onClick={() => act({ action: 'hype' }, 'hype')} className="w-full py-2.5 text-[13px] font-semibold" style={{ color: C.lime }}>{busy === 'hype' ? 'Re-hyping…' : '↻ Re-hype with everyone who’s in'}</button>}
    </section>
  );
}

/* A friend's recap is a dead end unless the viewer can start their own. */
function YourGroup() {
  const [q, setQ] = useState('');
  return (
    <section className="mt-4 rounded-3xl p-5 text-white shadow-sm" style={{ background: C.ink }}>
      <div className="text-[20px] font-semibold leading-tight">Your group deserves a sportscaster.</div>
      <p className="mt-1 text-[14px]" style={{ color: '#bccdbb' }}>Say when and where you play. You get the link, the hype, and the write-up. Your first one is free.</p>
      <form className="mt-3 flex gap-2" onSubmit={(x) => { x.preventDefault(); location.href = `/play?q=${encodeURIComponent(q.trim() || 'Doubles this weekend')}`; }}>
        <input value={q} onChange={(x) => setQ(x.target.value)} placeholder="Doubles Sat 8am at Orinda CC" aria-label="Your game" className="min-w-0 flex-1 rounded-xl bg-white px-3 py-3 text-[16px] outline-none" style={{ color: C.ink }} />
        <button className="rounded-xl px-4 font-semibold" style={{ background: C.lime, color: C.ink }}>Go</button>
      </form>
    </section>
  );
}

/* "Email me if my crown changes": the only thing we ask for, and only if they want it. */
function CrownAlert({ e, act }: { e: PlayEvent; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined> }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { try { setDone(localStorage.getItem('cc_watch_' + (e.crown?.slug ?? '')) === '1'); setEmail(localStorage.getItem('cc_email') || ''); } catch { /* */ } }, [e.crown?.slug]);
  if (!e.location || !e.crown) return null;
  if (done) return <p className="mt-3 text-[13px]">👑 Crown alerts on for {e.crown.place}.</p>;
  return (
    <form className="mt-3" onSubmit={async (x) => {
      x.preventDefault();
      const r = await act({ action: 'watch', email: email.trim() }, 'watch');
      if (r) { setDone(true); try { localStorage.setItem('cc_watch_' + e.crown!.slug, '1'); localStorage.setItem('cc_email', email.trim()); } catch { /* */ } }
    }}>
      <div className="text-[13px] font-semibold">👑 Email me if the crown at {e.crown.place} changes hands</div>
      <div className="mt-1.5 flex gap-2">
        <input type="email" required value={email} onChange={(x) => setEmail(x.target.value)} placeholder="you@email.com" aria-label="Email for crown alerts"
          className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-[16px] outline-none" style={{ borderColor: C.line }} />
        <button className="rounded-xl px-3 text-[14px] font-semibold text-white" style={{ background: C.ink }}>Alert me</button>
      </div>
      <p className="mt-1 text-[11px]" style={{ color: C.muted }}>Only crown news. One tap to unsubscribe.</p>
    </form>
  );
}

/* ---------- Team Battle ---------- */
function teamName(e: PlayEvent, t: 'A' | 'B') { return e.state.teamNames?.[t] || (t === 'A' ? 'Team A' : 'Team B'); }

function TeamBoard({ e, final }: { e: PlayEvent; final?: boolean }) {
  const m = e.state.mixer;
  if (!m) return null;
  const sc = teamScore(m);
  const lead = sc.A === sc.B ? null : sc.A > sc.B ? 'A' : 'B';
  return (
    <section className="mt-3 overflow-hidden rounded-3xl shadow-sm" style={{ background: C.ink }}>
      <div className="px-5 pt-4 text-[11px] font-semibold uppercase tracking-[2px]" style={{ color: '#bccdbb' }}>{final ? 'Final · courts won' : 'Team score · courts won'}</div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 pb-4 pt-1 text-white">
        <div><div className="truncate text-[15px] font-semibold" style={{ color: C.lime }}>{teamName(e, 'A')}</div><div className="text-[48px] font-bold leading-none tabular-nums">{sc.A}</div></div>
        <div className="text-[20px]" style={{ color: '#9fb3a6' }}>vs</div>
        <div className="text-right"><div className="truncate text-[15px] font-semibold" style={{ color: '#ff9fc4' }}>{teamName(e, 'B')}</div><div className="text-[48px] font-bold leading-none tabular-nums">{sc.B}</div></div>
      </div>
      {final && <div className="px-5 pb-4 text-[16px] font-semibold" style={{ color: C.lime }}>{lead ? `🏆 ${teamName(e, lead)} wins it` : 'All square. Run it back.'} <span className="font-normal" style={{ color: '#bccdbb' }}>· games {sc.gamesA}–{sc.gamesB}</span></div>}
    </section>
  );
}

function TeamNames({ e, act }: { e: PlayEvent; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined> }) {
  const [A, setA] = useState(teamName(e, 'A'));
  const [B, setB] = useState(teamName(e, 'B'));
  return (
    <form className="flex gap-2" onSubmit={(x) => { x.preventDefault(); act({ action: 'teamnames', A, B }); }}>
      <input value={A} onChange={(x) => setA(x.target.value)} aria-label="Team A name" className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-[15px]" style={{ borderColor: C.line }} />
      <input value={B} onChange={(x) => setB(x.target.value)} aria-label="Team B name" className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-[15px]" style={{ borderColor: C.line }} />
      <button className="rounded-xl px-3 text-[13px] font-semibold" style={{ background: '#eef1e8' }}>Name teams</button>
    </form>
  );
}

/* ---------- Status: who's in, who we're still waiting on, what to do next ---------- */
/** Names the host typed into the notes ("Players: Kevin & Dana, Lawrence & Haley"). */
function expectedNames(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const body = notes.replace(/^[^:]{0,24}:\s*/, (m) => (/player|who|roster|group|list|invite|crew/i.test(m) ? '' : m));
  const parts = body.split(/\s*(?:,|;|&|\+|\/|\n|\band\b)\s*/i).map((x) => x.trim().replace(/[.!?]+$/, ''));
  const ok = parts.filter((x) => /^[A-Z][a-zA-Z'’.-]{1,20}( [A-Z][a-zA-Z'’.-]{0,20})?$/.test(x));
  return ok.length >= 2 ? Array.from(new Set(ok)).slice(0, 40) : [];
}
const firstName = (n: string) => n.trim().split(/\s+/)[0].toLowerCase();

function HostLinkButtons({ code, hostKey }: { code: string; hostKey: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/p/${code}?host=${hostKey}`;
  const msg = `My Racquets IRL host link (don't share it): ${url}`;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 text-[13px] font-semibold">
      <a href={`sms:?&body=${encodeURIComponent(msg)}`} className="flex items-center justify-center gap-1.5 rounded-xl bg-white/80 py-2.5" style={{ color: C.ink }}><MessageCircle className="h-4 w-4" />Text me my host link</a>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt('Your host link', url); } }}
        className="flex items-center justify-center gap-1.5 rounded-xl bg-white/80 py-2.5" style={{ color: C.ink }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy host link'}</button>
    </div>
  );
}

export function StatusSheet({ e, busy, act, hostKey, onClose }: { e: PlayEvent; busy: string; act: (b: Record<string, unknown>, l?: string) => Promise<Res | undefined>; hostKey: string | null; onClose: () => void }) {
  const ins = e.rsvps.filter((r) => r.status === 'in');
  const wait = e.rsvps.filter((r) => r.status === 'wait');
  const have = new Set(e.rsvps.map((r) => firstName(r.name)));
  const missing = expectedNames(e.notes).filter((n) => !have.has(firstName(n)));
  const open = e.spots == null ? 0 : Math.max(0, e.spots - ins.length);
  const here = checkedIn(e).length;
  const need = perCourt(e.format);
  const when = whenLine(e);
  const ms = e.starts_at ? Date.parse(e.starts_at) - Date.now() : NaN;
  const until = Number.isFinite(ms) && ms > 0 ? (ms > 36 * 3600e3 ? `in ${Math.round(ms / 86400e3)} days` : ms > 3600e3 ? `in ${Math.round(ms / 3600e3)} hours` : `in ${Math.max(1, Math.round(ms / 60e3))} min`) : '';
  const url = `${location.origin}/p/${e.code}`;
  const nudge = () => [
    `🏓 ${e.title}${when ? ' · ' + when : ''}`,
    `In so far: ${ins.map((r) => r.name.split(' ')[0]).join(', ') || 'nobody yet'}.`,
    missing.length ? `Still need a tap from ${missing.join(', ')} 👀` : open ? `${open} spot${open === 1 ? '' : 's'} left.` : 'Full. Waitlist is open.',
    `Tap "I'm in" (5 seconds, no app): ${url}`,
  ].join('\n');
  const isHost = !!hostKey;
  const plan = here >= need ? `${here} checked in, ready to start` : here ? `${here} checked in, need ${need - here} more to start` : `${ins.length} signed up · check people in as they arrive`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" onClick={onClose}>
      <div role="dialog" aria-label="Game status" className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-3xl p-5 pb-8 shadow-2xl" style={{ background: C.paper, color: C.ink }} onClick={(x) => x.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>Game status</div>
          <button aria-label="Close" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: '#eef1e8' }}><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-2 text-[30px] font-semibold leading-tight tracking-tight">{e.status === 'open' ? (e.spots != null ? `${ins.length} of ${e.spots} in` : `${ins.length} in`) : e.status === 'live' ? 'Playing now' : 'Final'}</div>
        <div className="text-[14px]" style={{ color: C.muted }}>{[when, until, e.status === 'open' ? plan : ''].filter(Boolean).join(' · ')}</div>

        <div className="mt-4 rounded-2xl bg-white p-4">
          <div className="text-[13px] font-semibold">✅ In ({ins.length}){here ? ` · ${here} here` : ''}</div>
          <div className="mt-1 text-[15px]">{ins.map((r) => (r.checked_in_at ? '✓' : '') + r.name).join(', ') || '—'}</div>
          {wait.length > 0 && <><div className="mt-3 text-[13px] font-semibold">⏳ Waitlist ({wait.length})</div><div className="mt-1 text-[15px]">{wait.map((r) => r.name).join(', ')}</div></>}
          {missing.length > 0 && (
            <>
              <div className="mt-3 text-[13px] font-semibold">👀 Haven&apos;t tapped in ({missing.length})</div>
              <div className="mt-1 text-[15px]">{missing.join(', ')}</div>
              <div className="mt-1 text-[12px]" style={{ color: C.muted }}>From the names in the game notes.</div>
            </>
          )}
        </div>

        {e.status === 'open' && (
          <div className="mt-4 grid gap-2">
            {isHost && missing.length > 0 && (
              <button disabled={!!busy} onClick={() => act({ action: 'add', names: missing.join(', '), checkin: false }, 'add')} className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold disabled:opacity-60" style={{ background: C.lime }}>
                {busy === 'add' ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}They&apos;re coming. Add all {missing.length}
              </button>
            )}
            <div className="mt-1 text-[13px] font-semibold">{missing.length ? 'Nudge the group' : open ? `Fill the last ${open}` : 'Tell the group'}</div>
            <GroupChatButtons text={nudge} />
            {isHost && (
              <button disabled={!!busy || here < need} onClick={async () => { const r = await act({ action: 'start' }, 'start'); if (r) onClose(); }} className="mt-1 flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-50" style={{ background: C.ink }}>
                {busy === 'start' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}{here < need ? (here ? `${here} checked in · need ${need - here} more` : 'Check people in to start') : `Start with ${here} checked in`}
              </button>
            )}
          </div>
        )}

        {isHost ? (
          <div className="mt-5 rounded-2xl p-4" style={{ background: '#eef1e8' }}>
            <div className="text-[13px] font-semibold">Run this game from another phone</div>
            <HostLinkButtons code={e.code} hostKey={hostKey!} />
          </div>
        ) : (
          <p className="mt-5 text-[13px]" style={{ color: C.muted }}>
            Hosting this one{e.host_name ? `, ${e.host_name.split(' ')[0]}` : ''}? Open your <b>host link</b> on this phone to get the controls. On the phone you made the game on, tap “Open ›” then “Copy host link”.
          </p>
        )}
      </div>
    </div>
  );
}
