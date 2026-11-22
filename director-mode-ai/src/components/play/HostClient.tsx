'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, Sparkles, ArrowRight, MapPin, Clock, ChevronDown, Check } from 'lucide-react';
import { PlacePicker } from './PlacePicker';
import { levelLabel } from '@/lib/play/levels';
import { levelPresets } from './Levels';
import { normalizeDraft, parseSentence, perCourt, whenLine, type PlayDraft } from '@/lib/play/core';
import { C, PlayHeader, apiRaw, canListen, getClub, getHostId, getName, listen, savePending, setClub, setKey, setName, takePending } from './shared';
import Paywall, { type PaywallInfo } from './Paywall';
import { FormatChooser } from './EventPicker';
import { ClubGamesLink } from './ClubGamesLink';
import { trackEvent } from '@/lib/analytics';
import { PRICING_LINE } from '@/lib/play/pricing';
import type { DrawFormat } from '@/lib/play/draw';
import { InviteGroupPicker } from './Groups';

/*
 * /play/new is one numbered path (Darrin 11/21/26: "crystal clear how to proceed... all their options
 * laid out concisely. No clutter!"): 1 Sport, 2 Format, 3 When & where, 4 You, then Create my game (was "Make my link" until 11/22/26).
 * Typing or saying it is a shortcut at the bottom that fills the same steps.
 */
type Tile = 'game' | 'mixer' | 'kotc' | 'tournament';
const TILES: { id: Tile; label: string; sub: string }[] = [
  { id: 'game', label: 'A game', sub: 'Doubles or singles, 1 court' },
  { id: 'mixer', label: 'Social mixer', sub: 'Rotating partners, any headcount' },
  { id: 'kotc', label: 'King of the Court', sub: 'Winners move up a court' },
  { id: 'tournament', label: 'Tournament', sub: 'Round robin or brackets' },
];
// Short enough to read at a glance on a phone (11/22/26 landing overhaul).
const SAY_EXAMPLE = 'Pickleball doubles Friday at 6, 8 players';
const tileOf = (d: PlayDraft): Tile => (d.format === 'tournament' ? 'tournament' : d.format === 'king-of-court' ? 'kotc' : d.kind === 'game' ? 'game' : 'mixer');
const FRESH = (): PlayDraft => normalizeDraft({ kind: 'game', format: 'doubles', spots: 4, courts: 1 });
type Recent = { title: string; text: string; draft: PlayDraft };
const NAME_ERR = 'Add your first name so players know who’s hosting.';
const RECENT = 'rirl_recent_games';
const readRecent = (): Recent[] => { try { const v = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(v) ? v.slice(0, 3) : []; } catch { return []; } };
const saveRecent = (r: Recent) => { try { localStorage.setItem(RECENT, JSON.stringify([r, ...readRecent().filter((x) => x.title !== r.title)].slice(0, 3))); } catch { /* private mode */ } };

function localNow() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())} (${d.toLocaleDateString('en-US', { weekday: 'long' })})`;
}

export default function HostClient({ initial, club, resume }: { initial?: string; club?: string; resume?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initial ?? '');
  const [draft, setDraft] = useState<PlayDraft | null>(FRESH);
  const autoTitle = useRef(true); // title follows the format until the host names it (or types a sentence)
  const [thinking, setThinking] = useState(false);
  const [mic, setMic] = useState<null | (() => void)>(null);
  const [micOk, setMicOk] = useState(false);
  const [host, setHost] = useState('');
  const [playing, setPlaying] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const started = useRef(false);
  const [paywall, setPaywall] = useState<PaywallInfo | null>(null);
  // Tournament: which draw (round robin singles / doubles). Sent with the create; changeable on the event page until the start.
  const [drawFormat, setDrawFormat] = useState<DrawFormat>('rr-singles');
  const [recent, setRecent] = useState<Recent[]>([]);
  const [inviteGroup, setInviteGroup] = useState(''); // Groups: email the new link to this saved group
  // Kevin's scorecard: time from first intent to a created game.
  const t0 = useRef<number | null>(null);
  const drafted = useRef(false);
  const mark = () => { if (t0.current == null) t0.current = Date.now(); };

  useEffect(() => {
    setMicOk(canListen());
    setHost(getName());
    setRecent(readRecent());
    trackEvent('feature_use', 'play_host_open', 'courtconnect', {});
    if (club && /^[a-z0-9]{4,20}$/.test(club)) setClub(club);
    if (resume && !started.current) {
      const p = takePending<{ draft: PlayDraft; host: string; playing: boolean; text: string; drawFormat?: DrawFormat }>();
      if (p) { started.current = true; setDraft(p.draft); setHost(p.host); setPlaying(p.playing); setText(p.text); if (p.drawFormat) setDrawFormat(p.drawFormat); create(p.draft, p.host, p.playing, p.text, p.drawFormat); return; }
    }
    if (initial && !started.current) { started.current = true; build(initial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const touched = useRef<Set<string>>(new Set());
  const [listed, setListed] = useState(true);
  const [more, setMore] = useState(false); // "More options": player cap, round length, weekly, nearby
  async function build(t = text) {
    if (!t.trim()) return;
    mark();
    if (!drafted.current) { drafted.current = true; trackEvent('feature_use', 'play_draft', 'courtconnect', {}); }
    setErr('');
    const quick = parseSentence(t);
    touched.current = new Set();
    autoTitle.current = false;
    setDraft(quick);
    setThinking(true);
    try {
      const r = await fetch('/api/p/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t, local: localNow() }) });
      if (r.status === 200) {
        const j = (await r.json()) as { draft: PlayDraft; local_start: string | null; draw_format?: DrawFormat | null };
        if (j.draw_format) setDrawFormat(j.draw_format);
        const starts = j.local_start && !isNaN(Date.parse(j.local_start)) ? new Date(j.local_start).toISOString() : quick.starts_at;
        // Optimize Courts is the default for any social unless they said "doubles only" (host can still switch).
        const fmt = j.draft.format !== 'tournament' && j.draft.kind === 'social' && j.draft.format === 'doubles' && !/doubles only|only doubles/i.test(t) ? 'maximize-courts' : j.draft.format;
        const ai = normalizeDraft({ ...j.draft, format: fmt, starts_at: starts, when_text: j.draft.when_text ?? quick.when_text, location: j.draft.location ?? quick.location });
        // Anything the host already changed while it was tidying up stays theirs.
        setDraft((d) => {
          if (!d) return ai;
          const keep: Record<string, unknown> = {};
          for (const k of touched.current) keep[k] = d[k as keyof PlayDraft];
          return { ...ai, ...keep } as PlayDraft;
        });
      }
    } catch { /* keep the quick reading */ }
    setThinking(false);
    document.getElementById('step-1')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Run it back: re-read the sentence so "Saturday 9am" means the coming Saturday.
  function again(r: Recent) {
    mark();
    if (r.text) { setText(r.text); build(r.text); return; }
    touched.current = new Set(); autoTitle.current = false; setErr('');
    setDraft(normalizeDraft({ ...r.draft, starts_at: null, when_text: null }));
  }
  // Step 2: one tap sets the format; the title follows it until the host names the game.
  function pickTile(t: Tile) {
    mark();
    if (!drafted.current) { drafted.current = true; trackEvent('feature_use', 'play_draft', 'courtconnect', {}); }
    const d = draft ?? FRESH();
    const many = Math.max(2, d.courts);
    const p: Partial<PlayDraft> =
      t === 'game' ? { kind: 'game', format: d.format === 'singles' ? 'singles' : 'doubles', spots: d.format === 'singles' ? 2 : 4, courts: 1 }
      : t === 'mixer' ? { kind: 'social', format: 'maximize-courts', spots: null, courts: many }
      : t === 'kotc' ? { kind: 'social', format: 'king-of-court', spots: null, courts: many }
      : { kind: 'social', format: 'tournament', spots: null, courts: many };
    set(p);
  }

  const [typing, setTyping] = useState(!!initial);
  const [typeOnly, setTypeOnly] = useState(false); // opened with "Or just type it in": focus the box, don't start the mic
  function openSay() { setTyping(true); if (micOk && !mic) talk(); }

  const usedMic = useRef(false);
  function talk() {
    mark(); usedMic.current = true;
    if (mic) { mic(); setMic(null); return; }
    const stop = listen((t, fin) => { setText(t); if (fin) { setMic(null); build(t); } }, () => setMic(null));
    if (stop) setMic(() => stop);
  }

  async function create(d = draft, h = host, pl = playing, src = text, df = drawFormat) {
    if (!d) return;
    if (!h.trim()) {
      setErr(NAME_ERR);
      const el = document.getElementById('host-name');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true });
      return;
    }
    setSaving(true); setErr('');
    try {
      setName(h.trim());
      const r = await apiRaw('/api/p', { draft: d, host: { name: h.trim(), playing: pl }, source: src, hostId: getHostId(), clubCode: getClub() || undefined, ...(d.format === 'tournament' ? { drawFormat: df } : {}) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 402) {
        savePending({ draft: d, host: h.trim(), playing: pl, text: src, drawFormat: df });
        setPaywall(j.paywall as PaywallInfo); setSaving(false);
        trackEvent('feature_use', 'play_paywall', 'courtconnect', {});
        return;
      }
      if (!r.ok) throw new Error(j.error || 'Could not make it');
      setKey(j.code, j.hostKey);
      saveRecent({ title: d.title, text: src.trim(), draft: d });
      trackEvent('feature_use', 'play_created', 'courtconnect', { kind: d.kind, spots: d.spots, ms: t0.current ? Date.now() - t0.current : null, voice: usedMic.current });
      router.push(`/p/${j.code}?new=1${inviteGroup ? `&group=${encodeURIComponent(inviteGroup)}` : ''}`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not make it'); setSaving(false); }
  }

  // Typed text stays exactly as typed (normalizeDraft trims, which ate every space as you typed it).
  // The server normalizes again when the game is saved.
  const set = (p: Partial<PlayDraft>) => setDraft((d) => {
    if (!d) return d;
    for (const k of Object.keys(p)) touched.current.add(k);
    if ('location' in p) ['place_address', 'place_lat', 'place_lng'].forEach((k) => touched.current.add(k));
    const raw: Partial<PlayDraft> = {};
    for (const k of ['title', 'location', 'level', 'notes'] as const) if (typeof p[k] === 'string') (raw as Record<string, string>)[k] = p[k] as string;
    if (autoTitle.current && !('title' in p)) {
      const n = normalizeDraft({ ...d, ...p, title: '' });
      return { ...n, title: n.format === 'king-of-court' ? 'King of the Court' : n.title, ...raw };
    }
    if ('title' in p) autoTitle.current = false;
    return { ...normalizeDraft({ ...d, ...p }), ...raw };
  });
  const field = 'w-full rounded-xl border bg-white px-3 py-2.5 text-[16px] outline-none focus:ring-2';

  const d = draft ?? FRESH();
  const tile = tileOf(d);
  return (
    <div className="hc min-h-screen pb-16" style={{ background: C.paper, color: C.ink }}>
      <style>{HC_CSS}</style>
      <PlayHeader right={<span className="text-xs" style={{ color: C.muted }}>Free · No login</span>} />
      <main className="mx-auto w-full max-w-xl px-5">
        <h1 className="pt-6 text-center text-[36px] font-medium leading-[1.04] tracking-[-1.5px] sm:text-[48px]">Create a game</h1>

        {/* Say it (Darrin 11/21/26, Kevin: the big AI box complicated the page). One line under the
            headline; tapping listens (or opens a small box where speech isn't supported) and the
            steps below fill in. */}
        {!typing ? (
          <button type="button" onClick={openSay} className="mx-auto mt-4 flex items-center gap-3 rounded-full px-3 py-2 text-left">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: C.ink, color: C.lime }}><Mic className="h-5 w-5" /></span>
            <span className="text-[15px] font-semibold">Know what you want? Just say it.</span>
          </button>
        ) : null}
        {!typing ? (
          <button type="button" onClick={() => { setTyping(true); setTypeOnly(true); }} className="mx-auto mt-1 block text-[14px] underline underline-offset-4" style={{ color: C.muted }}>Or just type it in.</button>
        ) : (
          <form className="mt-4" onSubmit={(e) => { e.preventDefault(); build(); }}>
            <div className="hc-box flex items-end gap-2 rounded-2xl border bg-white p-2 pl-4 shadow-sm" style={{ borderColor: C.line }}>
              <textarea value={text} onChange={(e) => { mark(); setText(e.target.value); }} autoFocus={!micOk || typeOnly}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); build(); } }}
                rows={2} placeholder={SAY_EXAMPLE} aria-label="Describe your game"
                className="min-h-[52px] flex-1 resize-none bg-transparent py-2 text-[16px] outline-none placeholder:text-[#8a978d]" />
              {micOk && (
                <button type="button" onClick={talk} aria-label={mic ? 'Stop listening' : 'Say it'} className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${mic ? 'animate-pulse' : ''}`}
                  style={{ background: mic ? '#e0735e' : '#eef1e8', color: mic ? '#fff' : C.ink }}><Mic className="h-5 w-5" /></button>
              )}
              <button type="submit" aria-label="Fill it in" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: C.ink }}>
                {thinking ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
              </button>
            </div>
            <p className="mt-2 text-center text-[12px]" style={{ color: C.muted }}>{mic ? 'Listening… say the sport, format, when, where, courts' : 'The steps below fill in. Check them, then Create my game.'}</p>
          </form>
        )}

        {recent.length > 0 && (
          <section className="mt-5 grid gap-2">
            {recent.map((r) => (
              <button key={r.title} onClick={() => again(r)} className="flex items-center justify-between rounded-2xl border bg-white px-4 py-3 text-left" style={{ borderColor: C.line }}>
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>Run it back</span>
                  <span className="block truncate text-[15px] font-semibold">{r.title}{r.draft.location ? ` · ${r.draft.location}` : ''}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </button>
            ))}
          </section>
        )}

        {thinking && <p className="mt-4 flex items-center justify-center gap-1.5 text-[13px]" style={{ color: C.muted }}><Sparkles className="h-4 w-4" /> Filling it in…</p>}

        <Step n={1} title="Sport">
          <Seg value={d.sport} options={[['tennis', 'Tennis'], ['pickleball', 'Pickleball'], ['padel', 'Padel']]} onChange={(v) => set({ sport: v as PlayDraft['sport'] })} />
        </Step>

        <Step n={2} title="Format">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Format">
            {TILES.map((t) => {
              const on = tile === t.id;
              return (
                <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => pickTile(t.id)} className="rounded-2xl border px-3.5 py-3 text-left"
                  style={{ borderColor: on ? C.ink : C.line, background: on ? '#f4ffd9' : '#fff', boxShadow: on ? `inset 0 0 0 1px ${C.ink}` : undefined }}>
                  <span className="flex items-center justify-between gap-1 text-[15px] font-semibold">{t.label}{on && <Check className="h-4 w-4" />}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug" style={{ color: C.muted }}>{t.sub}</span>
                </button>
              );
            })}
          </div>
          {tile === 'game' && (
            <div className="mt-2"><Seg value={d.format === 'singles' ? 'singles' : 'doubles'} options={[['doubles', 'Doubles (4)'], ['singles', 'Singles (2)']]}
              onChange={(v) => set({ format: v as PlayDraft['format'], spots: v === 'singles' ? 2 : 4, kind: 'game', courts: 1 })} /></div>
          )}
          {(tile === 'mixer' || tile === 'tournament') && (
            <FormatChooser inline={tile === 'tournament'} value={d.format} drawFormat={drawFormat} spots={d.spots} courts={d.courts} onChange={(f, df) => { if (df) setDrawFormat(df); set({ format: f, kind: 'social' }); }} />
          )}
        </Step>

        <Step n={3} title="When & where">
          <div className="grid gap-2">
            <label className="relative flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: C.line }}>
              <Clock className="h-4 w-4 shrink-0" style={{ color: C.muted }} />
              <input type="datetime-local" aria-label="When" value={d.starts_at ? toLocalInput(d.starts_at) : ''}
                onChange={(e) => set({ starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className={`peer min-w-0 flex-1 bg-transparent text-[16px] outline-none ${d.starts_at ? '' : 'text-transparent focus:text-[#103c32]'}`} />
              {!d.starts_at && <span className="pointer-events-none absolute peer-focus:hidden left-10 text-[16px]" style={{ color: '#8a978d' }}>{d.when_text ?? 'Pick a day & time'}</span>}
            </label>
            <div className="hc-box flex items-start gap-2 rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: C.line }}>
              <MapPin className="mt-1 h-4 w-4 shrink-0" style={{ color: C.muted }} />
              <PlacePicker value={d} onChange={(pl) => set(pl)} dark={false} />
            </div>
            {tile !== 'game' && <Stepper label="Courts" value={d.courts} min={1} max={24} onChange={(v) => set({ courts: v })} />}
          </div>
        </Step>

        <div className="mt-4">
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="flex min-h-[44px] items-center gap-1 text-[14px] font-semibold" style={{ color: C.muted }}>
            More options <span className="font-normal">(name, level, player cap, weekly)</span> <ChevronDown className={`h-4 w-4 transition-transform ${more ? 'rotate-180' : ''}`} />
          </button>
          {more && (
            <div className="mt-2 grid gap-2 text-[14px]">
              <label className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: C.line }}>
                <span className="shrink-0" style={{ color: C.muted }}>Name</span>
                <input value={d.title} onChange={(e) => set({ title: e.target.value })} aria-label="Name of the game" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none" />
              </label>
              <div className="rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: C.line }}>
                <div className="flex items-center gap-2">
                  <span className="shrink-0" style={{ color: C.muted }}>Level</span>
                  <input value={d.level ?? ''} onChange={(e) => set({ level: e.target.value })} placeholder="Any level" aria-label="Level" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none" />
                  {d.level?.trim() && <span className="shrink-0 text-[12px] font-semibold" style={{ color: d.level_min != null || d.level_max != null ? '#2f7a4f' : '#b4432f' }}>{d.level_min != null || d.level_max != null ? levelLabel({ min: d.level_min ?? null, max: d.level_max ?? null }, d.sport) : '?'}</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {levelPresets(d.sport).map((x) => (
                    <button key={x} type="button" onClick={() => set({ level: d.level === x ? '' : x })} className="min-h-[32px] rounded-lg px-3 py-1.5 text-[13px] font-semibold"
                      style={d.level === x ? { background: C.ink, color: '#fff' } : { background: '#eef1e8', color: C.ink }}>{x}</button>
                  ))}
                </div>
              </div>
              {tile !== 'game' && (
                <Stepper label="Player cap" value={d.spots} min={2} max={96} nullable={{ def: Math.max(perCourt(d.format), d.courts * perCourt(d.format)), off: 'None' }}
                  onChange={(v) => set(v == null ? { spots: null, kind: 'social' } : { spots: v, kind: 'social' })} />
              )}
              {d.kind === 'social' && d.format !== 'tournament' && <Stepper label="Minutes per round" value={d.round_minutes} min={5} max={120} step={5} onChange={(v) => set({ round_minutes: v })} />}
              <label className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: C.line }}>
                <input type="checkbox" checked={!!d.repeat_weekly} onChange={(e) => set({ repeat_weekly: e.target.checked })} className="h-4 w-4 accent-[#103c32]" />
                <span>Every week <span style={{ color: C.muted }}>(next week&apos;s game makes itself)</span></span>
              </label>
              <label className="flex items-start gap-2 rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: C.line, opacity: d.place_lat == null ? 0.6 : 1 }}>
                <input type="checkbox" checked={listed && d.place_lat != null} disabled={d.place_lat == null} onChange={(e) => setListed(e.target.checked)} className="mt-1 h-4 w-4 accent-[#103c32]" />
                <span>Let nearby players find it<span className="block text-[12px]" style={{ color: C.muted }}>{d.place_lat == null ? 'Pick the place from the map suggestions to turn this on.' : 'Shows on “Games near me” while it needs players.'}</span></span>
              </label>
            </div>
          )}
        </div>

        <Step n={4} title="You">
          <div className="grid gap-3">
            <input id="host-name" value={host} onChange={(e) => { setHost(e.target.value); if (err === NAME_ERR && e.target.value.trim()) setErr(''); }} placeholder="Your first name" aria-label="Your name" autoComplete="given-name"
              aria-invalid={err === NAME_ERR} aria-describedby={err === NAME_ERR ? 'host-name-err' : undefined} className={field} style={{ borderColor: err === NAME_ERR ? '#b4432f' : C.line }} />
            {err === NAME_ERR && <p id="host-name-err" role="alert" className="-mt-1 text-[14px] font-medium text-[#b4432f]">{NAME_ERR}</p>}
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={playing} onChange={(e) => setPlaying(e.target.checked)} className="h-5 w-5 bg-white accent-[#103c32]" />
              I&apos;m playing too{d.spots != null ? ` (counts as 1 of the ${d.spots})` : ''}
            </label>
            <InviteGroupPicker value={inviteGroup} onChange={setInviteGroup} />
          </div>
        </Step>

        <section className="mt-5 grid gap-2">
          {err && err !== NAME_ERR && <p role="alert" className="text-[14px] font-medium text-[#b4432f]">{err} Your game details are still here. Try again.</p>}
          <button onClick={() => create({ ...d, listed: listed && d.place_lat != null })} disabled={saving || thinking} className="flex h-14 items-center justify-center gap-2 rounded-2xl text-[17px] font-semibold disabled:opacity-60" style={{ background: C.lime, color: C.ink }}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : null} {saving ? 'Creating…' : 'Create my game'}
          </button>
          {paywall ? <Paywall info={paywall} /> : <p className="text-center text-[13px] leading-snug" style={{ color: C.muted }}>{PRICING_LINE}</p>}
        </section>

        <section className="mt-8 border-t pt-5" style={{ borderColor: C.line }}>
          <p className="text-center text-[13px]" style={{ color: C.muted }}>
            <a href="/play/demo" className="underline underline-offset-4">Watch a demo</a>
            <span className="mx-2">·</span>
            <a href="/play/near" className="underline underline-offset-4">Find a game near me</a>
          </p>
        </section>
        <ClubGamesLink className="mt-6 text-center text-[13px]" />
      </main>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={`step-${n}`} className="mt-6 scroll-mt-4">
      <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
        <span className="grid h-6 w-6 place-items-center rounded-full text-[12px] font-bold" style={{ background: C.ink, color: C.lime }}>{n}</span>{title}
      </h2>
      {children}
    </section>
  );
}
function Seg({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" className="grid gap-1 rounded-xl p-1" style={{ background: '#e7ece2', gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)} className="min-h-[44px] rounded-lg py-2.5 text-[14px] font-semibold"
          style={v === value ? { background: C.ink, color: '#fff' } : { color: C.ink }}>{l}</button>
      ))}
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Stepper<N extends number | null = number>({ label, value, min, max, step = 1, onChange, nullable }: { label: string; value: N; min: number; max: number; step?: number; onChange: (v: N) => void; nullable?: { def: number; off: string } }) {
  // nullable: stepping below the minimum turns it off (value null); + from off starts at `def`.
  const down = () => (value == null ? undefined : value - step < min ? (nullable ? onChange(null as N) : onChange(min as N)) : onChange((value - step) as N));
  const up = () => onChange((value == null ? Math.min(max, Math.max(min, nullable?.def ?? min)) : Math.min(max, value + step)) as N);
  return (
    <div className="flex items-center justify-between rounded-xl border bg-white px-3 py-2" style={{ borderColor: C.line }}>
      <span className="text-[14px]" style={{ color: C.muted }}>{label}</span>
      <span className="flex items-center gap-2">
        <button type="button" aria-label={`Fewer ${label}`} onClick={down} disabled={value == null} className="grid h-10 w-10 place-items-center rounded-lg text-[18px] disabled:opacity-40" style={{ background: '#eef1e8' }}>−</button>
        <b className="min-w-6 text-center text-[16px]">{value ?? nullable?.off ?? ''}</b>
        <button type="button" aria-label={`More ${label}`} onClick={up} className="grid h-10 w-10 place-items-center rounded-lg text-[18px]" style={{ background: '#eef1e8' }}>+</button>
      </span>
    </div>
  );
}

/* Visible keyboard focus on every control (the inputs sit inside bordered boxes, so the box shows it). */
const HC_CSS = `
.hc :is(button,a):focus-visible{outline:3px solid #103c32;outline-offset:2px}
.hc label:focus-within,.hc .hc-box:focus-within{box-shadow:0 0 0 2px #103c32}
.hc #host-name:focus{box-shadow:0 0 0 2px #103c32}
`;
