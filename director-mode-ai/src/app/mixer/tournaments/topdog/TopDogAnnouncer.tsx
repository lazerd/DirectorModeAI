'use client';

/**
 * PA announcer for a TopDog tournament.
 *
 * TopDog stays the record: this reads its public match schedule every minute
 * (via /api/topdog/schedule) and never writes back. Matches are grouped by
 * start time; a match is callable once both players are known and it hasn't
 * been played. TopDog courts are used when set; otherwise the director can
 * type one in here (kept on this device only).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Check, ExternalLink, Loader2, Megaphone, RefreshCw, Volume2, VolumeX,
} from 'lucide-react';
import { DEFAULT_THEME, themeVars } from '@/lib/events/displayTheme';
import type { TopDogMatch, TopDogSchedule } from '@/lib/topdog/courtSchedule';

type Loaded = TopDogSchedule & { source: string; fetchedAt: string };

const VOICE_KEY = 'dm:console:voice';
const RATE_KEY = 'dm:console:rate';
const NOTE_DEFAULT = 'Bathrooms, ice, and water are downstairs, under the deck.';

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  return null;
}

function todayValue(): string {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** Middle initials trip the voice up ("Bennett J Stocker") — drop them. */
export function spokenName(name: string): string {
  return name.split(/\s+/).filter((w) => !/^[A-Z]\.?$/.test(w)).join(' ');
}

/** "Boys' 10 Singles" → "Boys 10 and under singles". */
function spokenEvent(event: string): string {
  const m = event.match(/^(Boys|Girls|Men|Women|Mixed)'?s?'?\s+(\d+)\s+(.*)$/i);
  if (!m) return event.replace(/'/g, '');
  return `${m[1]} ${m[2]} and under ${m[3].toLowerCase()}`;
}

function spokenRound(round: string): string {
  const base = (r: string): string => {
    const n = r.match(/^Round\s+(\d+)$/i);
    if (n) return `round of ${n[1]}`;
    if (/^Quarters$/i.test(r)) return 'quarterfinal';
    if (/^Semis$/i.test(r)) return 'semifinal';
    if (/^Finals?$/i.test(r)) return 'final';
    if (/^1$/.test(r)) return 'first round';
    return r.toLowerCase();
  };
  const c = round.match(/^Consol(?:ation)?\s+(.*)$/i);
  return c ? `consolation ${base(c[1])}` : base(round);
}

function callLine(m: TopDogMatch, court: string): string {
  const where = court
    ? `Please report to court ${court}.`
    : 'Please check in at the tournament desk.';
  const round = m.round ? `, ${spokenRound(m.round)}` : '';
  return `${spokenEvent(m.event)}${round}. ${spokenName(m.playerA)}, versus ${spokenName(m.playerB)}. ${where}`;
}

type State = 'ready' | 'waiting' | 'done';
function stateOf(m: TopDogMatch): State {
  if (m.winner || m.result) return 'done';
  return m.playerA && m.playerB ? 'ready' : 'waiting';
}

function spokenTime(t: string): string {
  return t.replace(/:00/, '').replace(/(am|pm)$/i, (s) => ` ${s.toUpperCase().split('').join(' ')}`);
}

export default function TopDogAnnouncer({ tournamentId, host }: { tournamentId: string; host: string }) {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [date, setDate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [courts, setCourts] = useState<Record<string, string>>({});
  const [called, setCalled] = useState<Record<string, string>>({});
  const [note, setNote] = useState(NOTE_DEFAULT);
  const [autoCall, setAutoCall] = useState(false);
  const [leadMin, setLeadMin] = useState(10);
  const [link, setLink] = useState('');

  const storeBase = `dm:topdog:${host || 'default'}:${tournamentId}:${date}`;

  // ---- voice (same Web Speech setup as the event console) -----------------
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState('');
  const [rate, setRate] = useState(0.95);
  const [speaking, setSpeaking] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const queue = useRef<string[]>([]);
  // Known only in the browser; checking during render would differ from the server's HTML.
  const [speechOK, setSpeechOK] = useState(false);
  useEffect(() => setSpeechOK('speechSynthesis' in window), []);

  useEffect(() => {
    if (!speechOK) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
      const r = parseFloat(store(RATE_KEY) || '');
      if (r) setRate(r);
      const saved = store(VOICE_KEY);
      if (saved && list.some((v) => v.voiceURI === saved)) setVoiceURI(saved);
      else {
        const en = list.find((v) => v.lang.startsWith('en'));
        if (en) setVoiceURI(en.voiceURI);
      }
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [speechOK]);

  const speakOne = useCallback(
    (text: string) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = voices.find((x) => x.voiceURI === voiceURI);
      if (v) u.voice = v;
      u.rate = rate;
      u.onstart = () => setSpeaking(true);
      u.onend = () => {
        const next = queue.current.shift();
        if (next) speakOne(next);
        else setSpeaking(false);
      };
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [voices, voiceURI, rate],
  );

  const say = useCallback(
    (lines: string[]) => {
      if (!speechOK || lines.length === 0) return;
      window.speechSynthesis.cancel();
      queue.current = lines.slice(1);
      speakOne(lines[0]);
    },
    [speechOK, speakOne],
  );

  const stop = () => {
    queue.current = [];
    window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  // ---- data ---------------------------------------------------------------
  const load = useCallback(async () => {
    if (!tournamentId) return;
    setLoading(true);
    const q = new URLSearchParams({ t: tournamentId });
    if (host) q.set('host', host);
    if (date) q.set('date', date);
    try {
      const res = await fetch(`/api/topdog/schedule?${q}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not read TopDog.');
      setData(json);
      setError(null);
      // First load: jump to today when the tournament is running today.
      if (!date) {
        const today = todayValue();
        const pick = json.dates.some((d: { value: string }) => d.value === today)
          ? today
          : json.date || json.dates[0]?.value || '';
        setDate(pick);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read TopDog.');
    } finally {
      setLoading(false);
    }
  }, [tournamentId, host, date]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  // Per-day courts + "called at" marks, kept on this device.
  useEffect(() => {
    if (!date) return;
    try {
      setCourts(JSON.parse(store(`${storeBase}:courts`) || '{}'));
      setCalled(JSON.parse(store(`${storeBase}:called`) || '{}'));
    } catch {
      setCourts({});
      setCalled({});
    }
    const n = store('dm:topdog:note');
    if (n) setNote(n);
  }, [storeBase, date]);

  const setCourt = (key: string, v: string) => {
    const next = { ...courts, [key]: v.trim() };
    if (!v.trim()) delete next[key];
    setCourts(next);
    store(`${storeBase}:courts`, JSON.stringify(next));
  };

  const markCalled = useCallback(
    (keys: string[]) => {
      const stamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      setCalled((prev) => {
        const next = { ...prev };
        for (const k of keys) next[k] = stamp;
        store(`${storeBase}:called`, JSON.stringify(next));
        return next;
      });
    },
    [storeBase],
  );

  // Showing the day that was asked for, not a stale one mid-switch.
  const showing = data && (!date || data.date === date) ? data : null;
  const matches = useMemo(() => showing?.matches ?? [], [showing]);

  const waves = useMemo(() => {
    const byTime = new Map<string, TopDogMatch[]>();
    for (const m of matches) {
      const list = byTime.get(m.time) ?? [];
      list.push(m);
      byTime.set(m.time, list);
    }
    return [...byTime.entries()].map(([time, list]) => ({ time, minutes: list[0].minutes, list }));
  }, [matches]);

  const isToday = date === todayValue();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const courtFor = (m: TopDogMatch) => m.court ?? courts[m.key] ?? '';

  const callWave = useCallback(
    (time: string, list: TopDogMatch[]) => {
      const ready = list.filter((m) => stateOf(m) === 'ready');
      if (ready.length === 0) return;
      say([
        `Attention players. Now calling the ${spokenTime(time)} matches.`,
        ...ready.map((m) => callLine(m, m.court ?? courts[m.key] ?? '')),
      ]);
      markCalled(ready.map((m) => m.key));
    },
    [say, markCalled, courts],
  );

  // Auto-call: each wave once, `leadMin` minutes before its start, today only.
  useEffect(() => {
    if (!autoCall || !isToday || speaking) return;
    for (const w of waves) {
      const due = w.minutes - leadMin;
      if (nowMin < due || nowMin > w.minutes + 15) continue;
      const fresh = w.list.filter((m) => stateOf(m) === 'ready' && !called[m.key]);
      if (fresh.length) {
        callWave(w.time, fresh);
        return;
      }
    }
  }, [autoCall, isToday, speaking, waves, nowMin, leadMin, called, callWave]);

  const nextWave = isToday
    ? waves.find((w) => w.minutes + 15 >= nowMin && w.list.some((m) => stateOf(m) !== 'done'))
    : undefined;

  // ---- no tournament picked yet -------------------------------------------
  if (!tournamentId) {
    const go = () => {
      const t = link.match(/tournament_?id=(\d+)/i)?.[1] ?? link.match(/^\s*(\d+)\s*$/)?.[1];
      const h = link.match(/https?:\/\/([a-z0-9-]+\.topdoglive\.com)/i)?.[1];
      if (t) router.push(`/mixer/tournaments/topdog?t=${t}${h ? `&host=${h}` : ''}`);
    };
    return (
      <div className="min-h-screen p-4 sm:p-8" style={{ ...themeVars(DEFAULT_THEME), background: 'var(--ev-ground)', color: 'var(--ev-text)' }}>
        <div className="max-w-xl mx-auto space-y-4 pt-10">
          <h1 className="text-3xl font-bold">TopDog announcer</h1>
          <p style={{ color: 'var(--ev-muted)' }}>
            Paste any TopDog link for the tournament (its home page or match schedule), or just its number.
          </p>
          <div className="flex gap-2">
            <input
              id="topdog-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              placeholder="…/information.asp?tournament_id=1715"
              className="flex-1 px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-base"
            />
            <button onClick={go} className="px-4 py-2 rounded-lg font-semibold" style={{ background: 'var(--ev-accent)', color: 'var(--ev-on-accent)' }}>
              Open
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen p-4 sm:p-6 lg:p-8"
      style={{ ...themeVars(DEFAULT_THEME), background: 'var(--ev-ground)', color: 'var(--ev-text)' }}
    >
      <header className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/mixer/tournaments" className="p-2 hover:bg-white/10 rounded-lg" title="Back to tournaments">
            <ArrowLeft size={20} />
          </Link>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.18em] font-semibold flex items-center gap-1.5" style={{ color: 'var(--ev-accent)' }}>
              <Megaphone size={12} /> Announcer · live from TopDog
            </div>
            <h1 className="text-2xl font-bold sm:text-3xl">{data?.name ?? 'Loading…'}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {speechOK ? (
            <>
              {speaking && (
                <button onClick={stop} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm bg-red-500 hover:bg-red-600 text-white">
                  <VolumeX size={16} /> Stop
                </button>
              )}
              <button onClick={() => setShowVoice((s) => !s)} className="p-2 hover:bg-white/10 rounded-lg" title="Voice settings" style={{ color: 'var(--ev-muted)' }}>
                <Volume2 size={18} />
              </button>
            </>
          ) : (
            <span className="text-xs italic" style={{ color: 'var(--ev-muted)' }}>This browser can't speak. Use Chrome.</span>
          )}
          <button onClick={load} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10" style={{ color: 'var(--ev-muted)' }} title="Read TopDog now">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {data ? `TopDog read ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Reading TopDog'}
          </button>
          {data && (
            <a href={data.source} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10" style={{ color: 'var(--ev-muted)' }}>
              TopDog <ExternalLink size={12} />
            </a>
          )}
        </div>
      </header>

      {showVoice && speechOK && (
        <div className="rounded-xl p-4 mb-5 grid sm:grid-cols-2 gap-4 max-w-2xl border" style={{ background: 'var(--ev-panel)', borderColor: 'var(--ev-line)' }}>
          <label className="block text-xs uppercase tracking-wide" style={{ color: 'var(--ev-muted)' }}>
            Voice
            <select
              id="topdog-voice"
              value={voiceURI}
              onChange={(e) => {
                setVoiceURI(e.target.value);
                store(VOICE_KEY, e.target.value);
              }}
              className="mt-1 w-full px-2 py-1.5 bg-[#002838] border border-white/10 rounded text-sm normal-case tracking-normal text-white"
            >
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </select>
          </label>
          <label className="block text-xs uppercase tracking-wide" style={{ color: 'var(--ev-muted)' }}>
            Speed {rate.toFixed(2)}×
            <input
              id="topdog-rate"
              type="range" min={0.5} max={1.3} step={0.05} value={rate}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setRate(v);
                store(RATE_KEY, String(v));
              }}
              className="mt-2 w-full"
            />
          </label>
          <p className="sm:col-span-2 text-xs" style={{ color: 'var(--ev-muted)' }}>
            Plug this device's audio into the PA. Chrome needs one tap on the page before it will speak.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm">
          {error} {data && 'Showing the last good read.'}
        </div>
      )}

      {/* Controls: day, auto-call, and a free-form announcement. */}
      <div className="grid gap-3 lg:grid-cols-[auto_auto_1fr] items-stretch mb-6">
        <div className="flex gap-1 flex-wrap items-center">
          {(data?.dates ?? []).map((d) => (
            <button
              key={d.value}
              onClick={() => setDate(d.value)}
              className="px-3 py-2 rounded-lg text-sm font-semibold border"
              style={
                d.value === date
                  ? { background: 'var(--ev-accent)', color: 'var(--ev-on-accent)', borderColor: 'var(--ev-accent)' }
                  : { background: 'var(--ev-panel)', borderColor: 'var(--ev-line)' }
              }
            >
              {d.label.split(',')[0]}
              {d.value === todayValue() ? ' · today' : ''}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-lg px-3 py-2 border text-sm" style={{ background: 'var(--ev-panel)', borderColor: 'var(--ev-line)', color: 'var(--ev-text)' }}>
          <input id="topdog-autocall" type="checkbox" checked={autoCall} onChange={(e) => setAutoCall(e.target.checked)} />
          Auto-call each time slot
          <select
            id="topdog-lead"
            value={leadMin}
            onChange={(e) => setLeadMin(Number(e.target.value))}
            className="bg-[#002838] border border-white/20 rounded px-1 py-0.5 text-white"
          >
            {[0, 5, 10, 15].map((n) => (
              <option key={n} value={n}>{n === 0 ? 'at start' : `${n} min before`}</option>
            ))}
          </select>
          {autoCall && !isToday && <span style={{ color: 'var(--ev-muted)' }}>(only on the day)</span>}
        </label>
        <div className="flex gap-2">
          <input
            id="topdog-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              store('dm:topdog:note', e.target.value);
            }}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
            aria-label="Announcement to read out"
          />
          <button
            onClick={() => say([note])}
            disabled={!speechOK || !note.trim()}
            className="px-3 py-2 rounded-lg text-sm font-semibold border disabled:opacity-40"
            style={{ borderColor: 'var(--ev-accent)', color: 'var(--ev-accent)' }}
          >
            Say it
          </button>
        </div>
      </div>

      {!data && !error && (
        <div className="flex items-center gap-2" style={{ color: 'var(--ev-muted)' }}>
          <Loader2 size={18} className="animate-spin" /> Reading the schedule from TopDog…
        </div>
      )}

      {showing && waves.length === 0 && (
        <div className="rounded-xl p-8 text-center border" style={{ background: 'var(--ev-panel)', borderColor: 'var(--ev-line)', color: 'var(--ev-muted)' }}>
          No matches on TopDog for this day.
        </div>
      )}

      <div className="space-y-5">
        {waves.map((w) => {
          const ready = w.list.filter((m) => stateOf(m) === 'ready');
          const done = w.list.filter((m) => stateOf(m) === 'done').length;
          const isNext = nextWave?.time === w.time;
          const past = isToday && w.minutes + 15 < nowMin;
          return (
            <section
              key={w.time}
              className="rounded-2xl border-2 p-4 sm:p-5"
              style={
                isNext
                  ? { background: 'color-mix(in srgb, var(--ev-live) 12%, transparent)', borderColor: 'var(--ev-live)' }
                  : { background: 'var(--ev-panel)', borderColor: 'var(--ev-line)', opacity: past && done === w.list.length ? 0.55 : 1 }
              }
            >
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="flex items-baseline gap-3">
                  <div className="text-3xl font-black" style={{ color: isNext ? 'var(--ev-live)' : 'var(--ev-accent)' }}>{w.time}</div>
                  <div className="text-sm" style={{ color: 'var(--ev-muted)' }}>
                    {w.list.length} matches · {ready.length} ready · {done} played
                    {isNext && <span className="ml-2 font-bold uppercase tracking-widest text-xs" style={{ color: 'var(--ev-live)' }}>● Up now</span>}
                  </div>
                </div>
                <button
                  onClick={() => callWave(w.time, w.list)}
                  disabled={!speechOK || ready.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40"
                  style={{ background: 'var(--ev-accent)', color: 'var(--ev-on-accent)' }}
                >
                  <Megaphone size={16} /> Call {ready.length || ''} {ready.length === 1 ? 'match' : 'matches'}
                </button>
              </div>

              <div className="divide-y" style={{ borderColor: 'var(--ev-line)' }}>
                {w.list.map((m) => {
                  const st = stateOf(m);
                  return (
                    <div key={m.key} className="py-2.5 flex items-center gap-3 flex-wrap" style={{ borderColor: 'var(--ev-line)', opacity: st === 'done' ? 0.55 : 1 }}>
                      <div className="w-40 shrink-0 text-xs leading-tight" style={{ color: 'var(--ev-muted)' }}>
                        <div className="font-semibold" style={{ color: 'var(--ev-text)' }}>{m.event.replace(' Singles', 's')}</div>
                        {m.round || '—'}
                      </div>
                      <div className="flex-1 min-w-[12rem] font-semibold">
                        <span className={m.winner === 'A' ? 'underline decoration-2' : ''}>{m.playerA || <i className="font-normal" style={{ color: 'var(--ev-muted)' }}>winner TBD</i>}</span>
                        <span className="mx-2 font-normal" style={{ color: 'var(--ev-muted)' }}>vs</span>
                        <span className={m.winner === 'B' ? 'underline decoration-2' : ''}>{m.playerB || <i className="font-normal" style={{ color: 'var(--ev-muted)' }}>winner TBD</i>}</span>
                        {m.result && <span className="ml-2 text-xs font-normal" style={{ color: 'var(--ev-muted)' }}>({m.result})</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {m.court ? (
                          <span className="text-sm">Ct {m.court}</span>
                        ) : (
                          st !== 'done' && (
                            <input
                              id={`court-${m.key}`}
                              value={courts[m.key] ?? ''}
                              onChange={(e) => setCourt(m.key, e.target.value)}
                              placeholder="Ct"
                              aria-label="Court"
                              className="w-14 px-2 py-1 rounded bg-white/10 border border-white/20 text-sm text-center"
                            />
                          )
                        )}
                        {called[m.key] && st !== 'done' && (
                          <span className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--ev-live)' }} title="Called over the PA">
                            <Check size={12} /> {called[m.key]}
                          </span>
                        )}
                        {st === 'ready' && speechOK && (
                          <button
                            onClick={() => {
                              say([callLine(m, courtFor(m))]);
                              markCalled([m.key]);
                            }}
                            className="p-2 rounded-lg"
                            style={{ background: 'color-mix(in srgb, var(--ev-accent) 20%, transparent)', color: 'var(--ev-accent)' }}
                            title="Call this match"
                          >
                            <Megaphone size={14} />
                          </button>
                        )}
                        {st === 'waiting' && <span className="text-xs" style={{ color: 'var(--ev-muted)' }}>waiting</span>}
                        {st === 'done' && <span className="text-xs" style={{ color: 'var(--ev-muted)' }}>played</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-center" style={{ color: 'var(--ev-muted)' }}>
        Reads TopDog every minute and never changes anything there. Enter results on TopDog; winners show up here on the next read.
      </p>
    </div>
  );
}
