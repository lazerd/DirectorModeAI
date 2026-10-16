'use client';

/**
 * The free MixerMode at /try — the one thing the homepage offers.
 *
 * No account, no email, no card: the whole mixer lives in this browser's
 * localStorage (see src/lib/mixer/guestMixer.ts for the pure logic, which
 * reuses the signed-in MixerMode's RoundGenerator). It must stay usable when
 * storage is blocked — a private window just loses the mixer on reload.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, ChevronLeft, ChevronRight, Minus, Plus, Printer, RotateCcw,
  Shuffle, Trash2, Trophy, UserMinus, UserPlus, X,
} from 'lucide-react';
import {
  FORMAT_LABELS, MAX_COURTS, activePlayers, cannotGenerate, generateRound, makeId,
  newMixer, parsePlayerList, parseSaved, roundComplete, standings,
  type GuestFormat, type GuestMixer, type GuestPlayer,
} from '@/lib/mixer/guestMixer';
import { trackEvent } from '@/lib/analytics';
import OtherToolsLine from '@/components/mixer/OtherToolsLine';
import { landingRef, logLanding } from '@/lib/landing';

const STORAGE_KEY = 'clubmode_free_mixer_v1';
const NUDGE_KEY = 'clubmode_free_mixer_nudge_closed';

type Tab = 'courts' | 'players' | 'standings';

function load(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* private mode: the mixer still works, it just won't survive a reload */ }
}

export default function FreeMixerPage() {
  const [mixer, setMixer] = useState<GuestMixer>(newMixer);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('courts');
  const [viewRound, setViewRound] = useState(0);
  const [error, setError] = useState('');
  const [nudgeClosed, setNudgeClosed] = useState(false);

  useEffect(() => {
    const saved = parseSaved(load(STORAGE_KEY));
    if (saved) {
      setMixer(saved);
      setViewRound(Math.max(0, saved.rounds.length - 1));
    }
    setNudgeClosed(load(NUDGE_KEY) === '1');
    landingRef(); // keep a letter's ?r= for this tab, in case they came straight here
    setReady(true);
    trackEvent('feature_use', 'free_mixer_open', 'mixer', { resumed: !!saved });
  }, []);

  useEffect(() => {
    if (ready) save(STORAGE_KEY, JSON.stringify(mixer));
  }, [mixer, ready]);

  const byId = useMemo(() => new Map(mixer.players.map((p) => [p.id, p])), [mixer.players]);
  const nameOf = (id: string) => byId.get(id)?.name ?? '—';
  const started = mixer.rounds.length > 0;
  const blocked = cannotGenerate(mixer);

  const update = (patch: Partial<GuestMixer>) => setMixer((m) => ({ ...m, ...patch }));

  const nextRound = () => {
    setError('');
    try {
      const r = generateRound(mixer);
      setMixer((m) => ({ ...m, rounds: [...m.rounds, r] }));
      setViewRound(mixer.rounds.length);
      setTab('courts');
      if (r.number === 1) logLanding('mixermode', 'first_round');
      trackEvent('feature_use', r.number === 1 ? 'free_mixer_first_round' : 'free_mixer_next_round', 'mixer', {
        round: r.number, players: activePlayers(mixer).length, courts: mixer.courts, format: mixer.format,
      });
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make the round.');
    }
  };

  const reshuffleLast = () => {
    setError('');
    try {
      const r = generateRound(mixer, { replaceLast: true });
      setMixer((m) => ({ ...m, rounds: [...m.rounds.slice(0, -1), r] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reshuffle.');
    }
  };

  const setScore = (roundIdx: number, matchIdx: number, side: 'scoreA' | 'scoreB', raw: string) => {
    const n = raw.trim() === '' ? null : Math.max(0, Math.min(99, parseInt(raw, 10) || 0));
    setMixer((m) => ({
      ...m,
      rounds: m.rounds.map((r, i) =>
        i !== roundIdx ? r : { ...r, matches: r.matches.map((x, j) => (j !== matchIdx ? x : { ...x, [side]: n })) },
      ),
    }));
  };

  const startOver = () => {
    if (started && !window.confirm('Start a new mixer? This clears the current one from this device.')) return;
    const fresh = newMixer();
    // Keep the roster and setup — the usual "same group, next week" case.
    if (started) {
      fresh.name = mixer.name;
      fresh.courts = mixer.courts;
      fresh.format = mixer.format;
      fresh.players = mixer.players.filter((p) => !p.out).map((p) => ({ ...p }));
    }
    setMixer(fresh);
    setViewRound(0);
    setTab('courts');
    setError('');
  };

  const clearAll = () => {
    if (!window.confirm('Clear every player and round?')) return;
    setMixer(newMixer());
    setViewRound(0);
  };

  const closeNudge = () => {
    setNudgeClosed(true);
    save(NUDGE_KEY, '1');
  };

  return (
    <div className="min-h-screen bg-[#001820] text-white print:bg-white print:text-black">
      <header className="print:hidden sticky top-0 z-30 bg-[#001820]/90 backdrop-blur border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link href="/mixermode" className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-[#D3FB52] text-[#002838] flex items-center justify-center shrink-0">
              <Shuffle size={15} strokeWidth={2.5} />
            </span>
            <span className="font-semibold tracking-tight truncate">MixerMode</span>
            <span className="hidden sm:inline text-white/40 text-sm">by ClubMode</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-white/50 px-2.5 py-1 rounded-full border border-white/10">
              Free · no account
            </span>
            {started && (
              <button onClick={startOver} className="text-sm text-white/70 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-white/5">
                New mixer
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-6 pb-24">
        {!ready ? (
          <div className="h-64 rounded-2xl bg-white/[0.03] animate-pulse" />
        ) : !started ? (
          <Setup
            mixer={mixer}
            update={update}
            blocked={blocked}
            onStart={nextRound}
            onClear={clearAll}
            error={error}
          />
        ) : (
          <>
            <div className="print:hidden mb-5">
              <input
                value={mixer.name}
                onChange={(e) => update({ name: e.target.value.slice(0, 80) })}
                placeholder="Untitled mixer"
                aria-label="Mixer name"
                className="w-full bg-transparent text-2xl sm:text-3xl font-bold tracking-tight placeholder:text-white/30 focus:outline-none"
              />
              <p className="text-sm text-white/50 mt-1">
                {FORMAT_LABELS[mixer.format]} · {mixer.courts} {mixer.courts === 1 ? 'court' : 'courts'} ·{' '}
                {activePlayers(mixer).length} players
              </p>
            </div>

            <nav className="print:hidden flex gap-1 p-1 bg-white/[0.04] rounded-xl mb-5" aria-label="Mixer sections">
              {(['courts', 'players', 'standings'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                    tab === t ? 'bg-[#D3FB52] text-[#002838]' : 'text-white/60 hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </nav>

            {error && <p role="alert" className="mb-4 text-sm text-red-300">{error}</p>}

            {tab === 'courts' && (
              <Courts
                mixer={mixer}
                viewRound={Math.min(viewRound, mixer.rounds.length - 1)}
                setViewRound={setViewRound}
                nameOf={nameOf}
                setScore={setScore}
                onNext={nextRound}
                onReshuffle={reshuffleLast}
                blocked={blocked}
              />
            )}
            {tab === 'players' && <PlayersPanel mixer={mixer} update={update} />}
            {tab === 'standings' && <StandingsPanel mixer={mixer} />}

            {!nudgeClosed && mixer.rounds.length >= 1 && (
              <aside className="print:hidden mt-10 relative rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <button onClick={closeNudge} aria-label="Dismiss" className="absolute top-3 right-3 p-1 text-white/40 hover:text-white">
                  <X size={16} />
                </button>
                <p className="font-semibold pr-6">Running this again next week?</p>
                <p className="text-sm text-white/60 mt-1 leading-relaxed">
                  This mixer is saved on this device only. A free ClubMode account keeps your mixers and
                  lets players check their court on their own phones with an event code.
                </p>
                <Link
                  href="/register?next=/mixer/home"
                  onClick={() => trackEvent('feature_use', 'free_mixer_signup_click', 'mixer')}
                  className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-[#D3FB52] hover:underline"
                >
                  Create a free account <ArrowRight size={14} />
                </Link>
              </aside>
            )}
            <OtherToolsLine className="print:hidden mt-8" />
          </>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ setup */

function Setup({
  mixer, update, blocked, onStart, onClear, error,
}: {
  mixer: GuestMixer;
  update: (p: Partial<GuestMixer>) => void;
  blocked: string | null;
  onStart: () => void;
  onClear: () => void;
  error: string;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Set up your mixer</h1>
        <p className="text-white/60 mt-2">Three steps. Nothing to sign up for.</p>
      </div>

      <section className="space-y-3">
        <StepLabel n={1}>Name and format</StepLabel>
        <input
          value={mixer.name}
          onChange={(e) => update({ name: e.target.value.slice(0, 80) })}
          placeholder="Friday Night Mixer (optional)"
          aria-label="Mixer name"
          className="w-full h-12 px-4 rounded-xl bg-white/[0.05] border border-white/10 placeholder:text-white/35 focus:outline-none focus:border-[#D3FB52]/60"
        />
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Format">
          {(Object.keys(FORMAT_LABELS) as GuestFormat[]).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={mixer.format === f}
              onClick={() => update({ format: f })}
              className={`h-12 rounded-xl text-sm font-medium border transition-colors ${
                mixer.format === f
                  ? 'bg-[#D3FB52] text-[#002838] border-[#D3FB52]'
                  : 'bg-white/[0.03] border-white/10 text-white/75 hover:border-white/25'
              }`}
            >
              {FORMAT_LABELS[f]}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <StepLabel n={2}>Courts</StepLabel>
        <CourtStepper value={mixer.courts} onChange={(courts) => update({ courts })} />
      </section>

      <section className="space-y-3">
        <StepLabel n={3}>Players</StepLabel>
        <PlayerEditor mixer={mixer} update={update} />
        {mixer.players.length > 0 && (
          <button onClick={onClear} className="text-xs text-white/40 hover:text-white/70 inline-flex items-center gap-1">
            <Trash2 size={12} /> Clear list
          </button>
        )}
      </section>

      <div className="sticky bottom-4 pt-2">
        {error && <p role="alert" className="mb-2 text-sm text-red-300">{error}</p>}
        <button
          onClick={onStart}
          disabled={!!blocked}
          className="w-full h-14 rounded-xl bg-[#D3FB52] text-[#002838] font-semibold text-base inline-flex items-center justify-center gap-2 shadow-xl shadow-black/30 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#c5f035] transition-colors"
        >
          Make round 1 <ArrowRight size={18} />
        </button>
        {blocked && <p className="text-center text-xs text-white/50 mt-2">{blocked}</p>}
      </div>
    </div>
  );
}

function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 text-sm font-semibold text-white/80">
      <span className="w-6 h-6 rounded-full bg-white/10 text-xs flex items-center justify-center">{n}</span>
      {children}
    </h2>
  );
}

function CourtStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.max(1, Math.min(MAX_COURTS, n)));
  return (
    <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03]">
      <button onClick={() => set(value - 1)} aria-label="Fewer courts" className="w-12 h-12 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30" disabled={value <= 1}>
        <Minus size={18} />
      </button>
      <span className="w-20 text-center text-lg font-semibold tabular-nums" aria-live="polite">
        {value} <span className="text-sm font-normal text-white/50">{value === 1 ? 'court' : 'courts'}</span>
      </span>
      <button onClick={() => set(value + 1)} aria-label="More courts" className="w-12 h-12 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30" disabled={value >= MAX_COURTS}>
        <Plus size={18} />
      </button>
    </div>
  );
}

/** Paste-a-list box plus the roster. Used in setup and for late arrivals. */
function PlayerEditor({ mixer, update, compact }: { mixer: GuestMixer; update: (p: Partial<GuestMixer>) => void; compact?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const mixed = mixer.format === 'mixed-doubles';

  const add = () => {
    const parsed = parsePlayerList(text, mixer.players.filter((p) => !p.out).map((p) => p.name));
    if (!parsed.length) return;
    const revived = new Set<string>();
    const players = mixer.players.map((p) => {
      const hit = p.out && parsed.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
      if (hit) { revived.add(hit.name.toLowerCase()); return { ...p, out: false }; }
      return p;
    });
    const fresh: GuestPlayer[] = parsed
      .filter((x) => !revived.has(x.name.toLowerCase()))
      .map((x) => ({ id: makeId(), name: x.name, gender: x.gender }));
    update({ players: [...players, ...fresh] });
    setText('');
    ref.current?.focus();
  };

  const setGender = (id: string, gender: 'male' | 'female') =>
    update({ players: mixer.players.map((p) => (p.id === id ? { ...p, gender } : p)) });
  const remove = (id: string) => update({ players: mixer.players.filter((p) => p.id !== id) });

  const roster = mixer.players.filter((p) => !p.out);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-white/[0.05] focus-within:border-[#D3FB52]/60">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !text.includes('\n')) { e.preventDefault(); add(); }
          }}
          rows={compact ? 2 : 4}
          placeholder={
            compact
              ? 'Late arrival? Type a name and press Enter'
              : `Type a name and press Enter, or paste your whole sign-up list.${mixed ? '\nAdd (M) or (W) after a name to set it.' : ''}`
          }
          aria-label="Add players"
          className="w-full bg-transparent px-4 py-3 resize-none placeholder:text-white/35 focus:outline-none"
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <span className="text-xs text-white/40">{roster.length} {roster.length === 1 ? 'player' : 'players'}</span>
          <button
            onClick={add}
            disabled={!text.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-sm font-medium hover:bg-white/15 disabled:opacity-30"
          >
            <UserPlus size={14} /> Add
          </button>
        </div>
      </div>

      {!compact && roster.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {roster.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-1 pl-3 pr-1 h-9 rounded-full bg-white/[0.06] border border-white/10 text-sm">
              <span className="max-w-[10rem] truncate">{p.name}</span>
              {mixed && <GenderToggle value={p.gender} onChange={(g) => setGender(p.id, g)} />}
              <button onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`} className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GenderToggle({ value, onChange }: { value?: 'male' | 'female'; onChange: (g: 'male' | 'female') => void }) {
  return (
    <span className="inline-flex ml-1 rounded-full overflow-hidden border border-white/15 text-[11px] font-semibold">
      {(['male', 'female'] as const).map((g) => (
        <button
          key={g}
          onClick={() => onChange(g)}
          aria-pressed={value === g}
          className={`px-2 h-6 ${value === g ? 'bg-[#D3FB52] text-[#002838]' : value ? 'text-white/40' : 'text-amber-300/90'}`}
        >
          {g === 'male' ? 'M' : 'W'}
        </button>
      ))}
    </span>
  );
}

/* ----------------------------------------------------------------- courts */

function Courts({
  mixer, viewRound, setViewRound, nameOf, setScore, onNext, onReshuffle, blocked,
}: {
  mixer: GuestMixer;
  viewRound: number;
  setViewRound: (n: number) => void;
  nameOf: (id: string) => string;
  setScore: (r: number, m: number, side: 'scoreA' | 'scoreB', v: string) => void;
  onNext: () => void;
  onReshuffle: () => void;
  blocked: string | null;
}) {
  const round = mixer.rounds[viewRound];
  const isLatest = viewRound === mixer.rounds.length - 1;
  const anyScored = round.matches.some((x) => x.scoreA != null || x.scoreB != null);
  const done = roundComplete(round);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setViewRound(viewRound - 1)}
          disabled={viewRound === 0}
          aria-label="Previous round"
          className="print:hidden w-10 h-10 rounded-lg flex items-center justify-center text-white/60 hover:bg-white/5 disabled:opacity-20"
        >
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-lg font-semibold">
          Round {round.number}
          <span className="text-white/40 font-normal"> of {mixer.rounds.length}</span>
        </h2>
        <button
          onClick={() => setViewRound(viewRound + 1)}
          disabled={isLatest}
          aria-label="Next round"
          className="print:hidden w-10 h-10 rounded-lg flex items-center justify-center text-white/60 hover:bg-white/5 disabled:opacity-20"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {round.matches.map((x, j) => (
          <div key={j} className="rounded-2xl bg-[#002838] border border-white/[0.07] p-4 print:bg-white print:border-black/30 break-inside-avoid">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#D3FB52]/90 mb-3">Court {x.court}</p>
            <TeamRow
              names={x.teamA.map(nameOf)}
              score={x.scoreA}
              onScore={(v) => setScore(viewRound, j, 'scoreA', v)}
              label={`Court ${x.court} team 1 games`}
            />
            <div className="my-2 text-[11px] uppercase tracking-widest text-white/30 pl-0.5">vs</div>
            <TeamRow
              names={x.teamB.map(nameOf)}
              score={x.scoreB}
              onScore={(v) => setScore(viewRound, j, 'scoreB', v)}
              label={`Court ${x.court} team 2 games`}
            />
          </div>
        ))}
      </div>

      {round.sittingOut.length > 0 && (
        <p className="mt-4 text-sm text-white/60">
          <span className="text-white/40">Sitting out:</span> {round.sittingOut.map(nameOf).join(', ')}
        </p>
      )}

      <p className="print:hidden mt-3 text-xs text-white/40">Scores are optional — enter games won to fill the standings.</p>

      <div className="print:hidden mt-6 flex flex-col sm:flex-row gap-2.5">
        {isLatest ? (
          <button
            onClick={onNext}
            disabled={!!blocked}
            className="flex-1 h-12 rounded-xl bg-[#D3FB52] text-[#002838] font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#c5f035] disabled:opacity-40"
          >
            {done || !anyScored ? 'Next round' : 'Next round (scores can wait)'} <ArrowRight size={17} />
          </button>
        ) : (
          <button
            onClick={() => setViewRound(mixer.rounds.length - 1)}
            className="flex-1 h-12 rounded-xl bg-white/10 font-semibold hover:bg-white/15"
          >
            Back to round {mixer.rounds.length}
          </button>
        )}
        {isLatest && !anyScored && (
          <button onClick={onReshuffle} className="h-12 px-4 rounded-xl border border-white/15 text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-white/5">
            <RotateCcw size={15} /> Reshuffle
          </button>
        )}
        <button onClick={() => window.print()} className="h-12 px-4 rounded-xl border border-white/15 text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-white/5">
          <Printer size={15} /> Print
        </button>
      </div>
      {blocked && isLatest && <p className="print:hidden text-xs text-white/50 mt-2">{blocked}</p>}
    </div>
  );
}

function TeamRow({ names, score, onScore, label }: { names: string[]; score?: number | null; onScore: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <p className="flex-1 min-w-0 font-medium leading-snug">
        {names.map((n, i) => (
          <span key={i} className="block truncate">{n}</span>
        ))}
      </p>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        value={score ?? ''}
        onChange={(e) => onScore(e.target.value.replace(/\D/g, ''))}
        aria-label={label}
        placeholder="–"
        className="print:border-white/40 w-14 h-11 rounded-lg bg-white/[0.06] border border-white/10 text-center text-lg font-semibold tabular-nums placeholder:text-white/25 focus:outline-none focus:border-[#D3FB52]/60"
      />
    </div>
  );
}

/* ---------------------------------------------------------------- players */

function PlayersPanel({ mixer, update }: { mixer: GuestMixer; update: (p: Partial<GuestMixer>) => void }) {
  const mixed = mixer.format === 'mixed-doubles';
  const setOut = (id: string, out: boolean) =>
    update({ players: mixer.players.map((p) => (p.id === id ? { ...p, out } : p)) });
  const setGender = (id: string, gender: 'male' | 'female') =>
    update({ players: mixer.players.map((p) => (p.id === id ? { ...p, gender } : p)) });

  return (
    <div className="space-y-6">
      <PlayerEditor mixer={mixer} update={update} compact />

      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] pl-4 pr-1 py-1">
        <span className="text-sm text-white/70">Courts for the next round</span>
        <CourtStepper value={mixer.courts} onChange={(courts) => update({ courts })} />
      </div>

      <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 overflow-hidden">
        {mixer.players.map((p) => (
          <li key={p.id} className={`flex items-center gap-3 px-4 h-14 ${p.out ? 'opacity-45' : ''}`}>
            <span className="flex-1 min-w-0 truncate">{p.name}</span>
            {mixed && !p.out && <GenderToggle value={p.gender} onChange={(g) => setGender(p.id, g)} />}
            <button
              onClick={() => setOut(p.id, !p.out)}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5"
            >
              {p.out ? <><UserPlus size={13} /> Back in</> : <><UserMinus size={13} /> Left</>}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-white/40">Changes apply from the next round. Players who left keep their results.</p>
    </div>
  );
}

/* -------------------------------------------------------------- standings */

function StandingsPanel({ mixer }: { mixer: GuestMixer }) {
  const rows = standings(mixer);
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center">
        <Trophy className="mx-auto text-white/30" size={28} />
        <p className="mt-3 text-white/70">No scores yet.</p>
        <p className="text-sm text-white/45 mt-1">Enter games on the Courts tab and the standings fill in here.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-white/[0.04] text-white/50 text-xs uppercase tracking-wider">
          <tr>
            <th className="text-left font-medium px-4 py-2.5">Player</th>
            <th className="font-medium px-2 py-2.5">W–L</th>
            <th className="font-medium px-2 py-2.5">Games</th>
            <th className="font-medium px-3 py-2.5">+/–</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {rows.map((s, i) => {
            const diff = s.gamesFor - s.gamesAgainst;
            return (
              <tr key={s.id}>
                <td className="px-4 py-3">
                  <span className="text-white/35 tabular-nums mr-2.5">{i + 1}</span>
                  {s.name}
                </td>
                <td className="text-center tabular-nums">{s.wins}–{s.losses}</td>
                <td className="text-center tabular-nums text-white/70">{s.gamesFor}–{s.gamesAgainst}</td>
                <td className={`text-center tabular-nums px-3 ${diff > 0 ? 'text-[#D3FB52]' : diff < 0 ? 'text-white/50' : ''}`}>
                  {diff > 0 ? `+${diff}` : diff}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
