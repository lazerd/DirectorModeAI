'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, Sparkles, ArrowRight, MapPin, Clock, ChevronDown } from 'lucide-react';
import { PlacePicker } from './PlacePicker';
import { levelLabel } from '@/lib/play/levels';
import { levelPresets } from './Levels';
import { normalizeDraft, parseSentence, perCourt, whenLine, type PlayDraft } from '@/lib/play/core';
import { C, PlayHeader, apiRaw, canListen, getClub, getHostId, getName, listen, savePending, setClub, setKey, setName, takePending } from './shared';
import Paywall, { type PaywallInfo } from './Paywall';
import { FormatChooser } from './EventPicker';
import { ClubGamesLink } from './ClubGamesLink';
import { trackEvent } from '@/lib/analytics';
import type { DrawFormat } from '@/lib/play/draw';
import { InviteGroupPicker } from './Groups';

// Three short starters (Darrin 11/21/26: the page felt cluttered). Each one shows a different kind of night.
const EXAMPLES: [string, string][] = [
  ['Doubles Sat 9am', 'Doubles Saturday 9am, need 3 more'],
  ['Pickleball mixer Fri 6pm', 'Pickleball mixer Friday 6pm, 3 courts'],
  ['Round robin Sun 10am', 'Tennis round robin tournament Sunday 10am, 2 courts'],
];

function localNow() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())} (${d.toLocaleDateString('en-US', { weekday: 'long' })})`;
}

export default function HostClient({ initial, club, resume }: { initial?: string; club?: string; resume?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initial ?? '');
  const [draft, setDraft] = useState<PlayDraft | null>(null);
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
  const [inviteGroup, setInviteGroup] = useState(''); // Groups: email the new link to this saved group
  // Kevin's scorecard: time from first intent to a created game.
  const t0 = useRef<number | null>(null);
  const drafted = useRef(false);
  const mark = () => { if (t0.current == null) t0.current = Date.now(); };

  useEffect(() => {
    setMicOk(canListen());
    setHost(getName());
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
    setDraft(quick);
    setThinking(true);
    try {
      const r = await fetch('/api/p/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t, local: localNow() }) });
      if (r.status === 200) {
        const j = (await r.json()) as { draft: PlayDraft; local_start: string | null };
        const starts = j.local_start && !isNaN(Date.parse(j.local_start)) ? new Date(j.local_start).toISOString() : quick.starts_at;
        // Optimize Courts is the default for any social unless they said "doubles only" (host can still switch).
        const fmt = j.draft.kind === 'social' && j.draft.format === 'doubles' && !/doubles only|only doubles/i.test(t) ? 'maximize-courts' : j.draft.format;
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
  }

  const usedMic = useRef(false);
  function talk() {
    mark(); usedMic.current = true;
    if (mic) { mic(); setMic(null); return; }
    const stop = listen((t, fin) => { setText(t); if (fin) { setMic(null); build(t); } }, () => setMic(null));
    if (stop) setMic(() => stop);
  }

  async function create(d = draft, h = host, pl = playing, src = text, df = drawFormat) {
    if (!d) return;
    if (!h.trim()) { setErr('Add your name so people know who is hosting.'); return; }
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
    return { ...normalizeDraft({ ...d, ...p }), ...raw };
  });
  const field = 'w-full rounded-xl border bg-white px-3 py-2.5 text-[16px] outline-none focus:ring-2';

  return (
    <div className="min-h-screen pb-16" style={{ background: C.paper, color: C.ink }}>
      <PlayHeader right={<span className="text-xs" style={{ color: C.muted }}>Tennis · Pickleball · Padel</span>} />
      <main className="mx-auto w-full max-w-xl px-5">
        {!draft && (
          <section className="pt-8 text-center">
            <h1 className="text-[40px] font-medium leading-[1.04] tracking-[-2px] sm:text-[52px]">Start a game</h1>
            <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed" style={{ color: C.muted }}>Type it like you&apos;d text your group. Free. No login needed.</p>
          </section>
        )}

        <form className="mt-7" onSubmit={(e) => { e.preventDefault(); build(); }}>
          <div className="flex items-end gap-2 rounded-2xl border bg-white p-2 pl-4 shadow-sm" style={{ borderColor: C.line }}>
            <textarea
              value={text}
              onChange={(e) => { mark(); setText(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); build(); } }}
              rows={2}
              placeholder="e.g. Doubles Friday 6pm at Heather Farm, need 3 more"
              aria-label="Describe your game"
              className="min-h-[52px] flex-1 resize-none bg-transparent py-2 text-[16px] outline-none placeholder:text-[#8a978d]"
            />
            {micOk && (
              <button type="button" onClick={talk} aria-label={mic ? 'Stop listening' : 'Say it'}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${mic ? 'animate-pulse' : ''}`}
                style={{ background: mic ? '#e0735e' : '#eef1e8', color: mic ? '#fff' : C.ink }}>
                <Mic className="h-5 w-5" />
              </button>
            )}
            <button type="submit" aria-label="Make it" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: C.ink }}>
              {thinking ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
            </button>
          </div>
          {mic && <p className="mt-2 text-center text-sm" style={{ color: C.muted }}>Listening… say when, where, how many</p>}
        </form>

        {!draft && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map(([label, full]) => (
              <button key={label} onClick={() => { setText(full); build(full); }} className="rounded-full border bg-white px-3.5 py-1.5 text-[13px] font-medium" style={{ borderColor: C.line, color: C.ink }}>
                {label}
              </button>
            ))}
          </div>
        )}
        {!draft && (
          <p className="mt-8 text-center text-[13px]" style={{ color: C.muted }}>
            <a href="/play/demo" className="font-semibold underline underline-offset-4" style={{ color: C.ink }}>Watch a demo</a>
            <span className="mx-2">·</span>
            <a href="/play/near" className="font-semibold underline underline-offset-4" style={{ color: C.ink }}>Find a game near me</a>
          </p>
        )}

        {draft && (
          <section className="mt-5 rounded-3xl p-5 text-white shadow-lg" style={{ background: C.ink }}>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[1.5px]" style={{ color: '#bccdbb' }}>
              <span>{draft.sport} · {draft.format === 'tournament' ? 'tournament' : draft.kind === 'game' ? 'a game' : 'rotating partners'}</span>
              {thinking ? <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> tidying up…</span> : null}
            </div>
            <input value={draft.title} onChange={(e) => set({ title: e.target.value })} aria-label="Title"
              className="mt-2 w-full bg-transparent text-[28px] font-medium leading-tight tracking-tight text-white outline-none" />
            <div className="mt-3 grid gap-2 text-[15px]">
              <label className="flex items-center gap-2"><Clock className="h-4 w-4 shrink-0" style={{ color: C.lime }} />
                <input type="datetime-local" aria-label="When"
                  value={draft.starts_at ? toLocalInput(draft.starts_at) : ''}
                  onChange={(e) => set({ starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                  className="bg-transparent text-white outline-none [color-scheme:dark]" />
                {!draft.starts_at && <span style={{ color: '#bccdbb' }}>{draft.when_text ?? 'Pick a time'}</span>}
              </label>
              <label className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" style={{ color: C.lime }} />
                <PlacePicker value={draft} onChange={(p) => set(p)} />
              </label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
              <Pick label="Sport" value={draft.sport} options={[['tennis', 'Tennis'], ['pickleball', 'Pickleball'], ['padel', 'Padel']]} onChange={(v) => set({ sport: v as PlayDraft['sport'] })} wide />
              <Stepper label="Courts" value={draft.courts} min={1} max={24} onChange={(v) => set({ courts: v })} />
              <label className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: '#ffffff14' }}>
                <span style={{ color: '#bccdbb' }}>Level</span>
                <input value={draft.level ?? ''} onChange={(e) => set({ level: e.target.value })} placeholder="any" aria-label="Level" className="w-full min-w-0 bg-transparent text-white outline-none placeholder:text-[#9fb3a6]" />
                {draft.level?.trim() && <span className="shrink-0 text-[11px] font-semibold" style={{ color: draft.level_min != null || draft.level_max != null ? C.lime : '#ffb4a2' }}>{draft.level_min != null || draft.level_max != null ? levelLabel({ min: draft.level_min ?? null, max: draft.level_max ?? null }, draft.sport) : '?'}</span>}
              </label>
            </div>
            <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="mt-3 flex items-center gap-1 text-[13px] font-semibold" style={{ color: '#bccdbb' }}>
              More options <ChevronDown className={`h-4 w-4 transition-transform ${more ? 'rotate-180' : ''}`} />
            </button>
            {more && (
              <div className="mt-2 grid gap-2 text-[13px] text-white">
                <div className="flex flex-wrap gap-1.5">
                  {levelPresets(draft.sport).map((x) => (
                    <button key={x} type="button" onClick={() => set({ level: draft.level === x ? '' : x })} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold"
                      style={draft.level === x ? { background: C.lime, color: C.ink } : { background: '#ffffff14', color: '#fff' }}>{x}</button>
                  ))}
                </div>
                <Stepper label="Player cap" value={draft.spots} min={2} max={96} nullable={{ def: Math.max(perCourt(draft.format), draft.courts * perCourt(draft.format)), off: 'None' }}
                  onChange={(v) => set(v == null ? { spots: null, kind: 'social' } : { spots: v, kind: v > perCourt(draft.format) ? 'social' : 'game', courts: Math.max(1, Math.min(draft.courts, Math.ceil(v / perCourt(draft.format)))) })} />
                {draft.kind === 'social' && draft.format !== 'tournament' && <Stepper label="Min / round" value={draft.round_minutes} min={5} max={120} step={5} onChange={(v) => set({ round_minutes: v })} />}
                <label className="flex items-center gap-2 rounded-xl px-3 py-2 text-white" style={{ background: '#ffffff14' }}>
                  <input type="checkbox" checked={!!draft.repeat_weekly} onChange={(e) => set({ repeat_weekly: e.target.checked })} className="h-4 w-4 accent-[#d4ff49]" />
                  <span>Every week <span style={{ color: '#bccdbb' }}>(next week’s game makes itself)</span></span>
                </label>
                <label className="flex items-start gap-2 rounded-xl px-3 py-2 text-white" style={{ background: '#ffffff14', opacity: draft.place_lat == null ? 0.6 : 1 }}>
                  <input type="checkbox" checked={listed && draft.place_lat != null} disabled={draft.place_lat == null} onChange={(e) => setListed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#d4ff49]" />
                  <span>Let nearby players find it<span className="block text-[12px]" style={{ color: '#bccdbb' }}>{draft.place_lat == null ? 'Pick the place from the map suggestions to turn this on.' : 'Shows on “Games near me” while it needs players.'}</span></span>
                </label>
              </div>
            )}
          </section>
        )}

        {draft && <FormatChooser value={draft.format} drawFormat={drawFormat} spots={draft.spots} courts={draft.courts} onChange={(f, df) => { if (df) setDrawFormat(df); set({ format: f, kind: draft.spots == null || draft.spots > 4 || f === 'king-of-court' || f === 'maximize-courts' || f === 'team-battle' || f === 'tournament' ? 'social' : draft.kind }); }} />}

        {draft && (
          <section className="mt-4 grid gap-3">
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Your first name" aria-label="Your name" className={field} style={{ borderColor: C.line }} />
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={playing} onChange={(e) => setPlaying(e.target.checked)} className="h-5 w-5 bg-white accent-[#103c32]" />
              I&apos;m playing too{draft.spots != null ? ` (counts as 1 of the ${draft.spots})` : ''}
            </label>
            <InviteGroupPicker value={inviteGroup} onChange={setInviteGroup} />
            {err && <p className="text-[14px] text-[#b4432f]">{err}</p>}
            <button onClick={() => create({ ...draft, listed: listed && draft.place_lat != null })} disabled={saving} className="flex h-14 items-center justify-center gap-2 rounded-2xl text-[17px] font-semibold disabled:opacity-60" style={{ background: C.lime, color: C.ink }}>
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Make my link
            </button>
            {paywall ? <Paywall info={paywall} /> : <p className="text-center text-[12px]" style={{ color: C.muted }}>Free to host your first game. Joining is always free.</p>}
          </section>
        )}
        <ClubGamesLink className="mt-8 text-center text-[13px]" />
      </main>
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
    <div className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: '#ffffff14' }}>
      <span style={{ color: '#bccdbb' }}>{label}</span>
      <span className="flex items-center gap-2">
        <button type="button" aria-label={`Fewer ${label}`} onClick={down} disabled={value == null} className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 disabled:opacity-40">−</button>
        <b className="min-w-6 text-center text-[16px]">{value ?? nullable?.off ?? ''}</b>
        <button type="button" aria-label={`More ${label}`} onClick={up} className="grid h-7 w-7 place-items-center rounded-lg bg-white/10">+</button>
      </span>
    </div>
  );
}
function Pick({ label, value, options, onChange, wide }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${wide ? 'col-span-2' : ''}`} style={{ background: '#ffffff14' }}>
      <span style={{ color: '#bccdbb' }}>{label}</span>
      <span className="flex gap-1">
        {options.map(([v, l]) => (
          <button type="button" key={v} onClick={() => onChange(v)} className="rounded-lg px-2 py-1 text-[12px] font-semibold"
            style={v === value ? { background: C.lime, color: C.ink } : { background: '#ffffff10', color: '#dfe8dc' }}>{l}</button>
        ))}
      </span>
    </div>
  );
}
