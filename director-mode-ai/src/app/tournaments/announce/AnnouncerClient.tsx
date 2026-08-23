'use client';

/**
 * On Deck Announcer — reads court assignments out loud over the PA.
 *
 * Runs entirely in the browser on the tournament desk laptop:
 *   Serve Tennis desk  ->  this page polls  ->  speaks through the laptop  ->  PA
 *
 * No server, no API key, no per-message cost. The Serve Tennis API sends
 * `access-control-allow-origin: *`, so the browser can read the feed
 * directly, and the voice is the browser's own speech engine — the best
 * one the laptop has, which on this machine means a Google network voice
 * rather than the muddy bundled Microsoft default.
 *
 * Darrin assigns a court in Tournament Desk. Within one poll, the PA calls
 * the players. He does nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchFeed, normaliseFeed, diffForAnnouncement, observeCompletions,
  announcementText, type NormalisedMatch,
} from '@/lib/ondeck/servetennis';
import { computeWaitBoard, bucketOf, type Observation } from '@/lib/ondeck/board';

const TOURNAMENT_ID = '55882F65-8F6E-4791-8847-4BEB310376BE';
const POLL_MS = 10_000;
const TOKEN_KEY = 'ondeck.token';
const OBS_KEY = 'ondeck.observations';
/** Slug the public wait board is published under. */
const BOARD_SLUG = 'sh-level5-aug-2026';
const BOARD_TITLE = 'Sleepy Hollow Level 5 — Order of Play';
const VOICE_KEY = 'ondeck.voice';

/**
 * Voices the laptop actually has, best first. The Google entries are
 * network voices and are dramatically clearer over a PA than the bundled
 * Microsoft ones, which is what makes them worth preferring by name.
 */
const VOICE_PREFERENCE = [
  // US English first — this is a California club and an American accent is
  // what players' ears expect over a PA.
  'Google US English',
  'Google UK English Male',
  'Google UK English Female',
  'Microsoft Mark',
  'Microsoft David',
  'Microsoft Zira',
];

interface LogLine { at: string; text: string; kind: 'call' | 'info' | 'error' }

export default function AnnouncerClient() {
  const [token, setToken] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);           // audio unlocked by a user gesture
  const [live, setLive] = useState<NormalisedMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [voice, setVoice] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [publishState, setPublishState] = useState<'idle' | 'ok' | 'failed' | 'signed_out'>('idle');

  const announced = useRef<Set<string>>(new Set());
  const prevLive = useRef<NormalisedMatch[]>([]);
  const observations = useRef<Observation[]>([]);
  const speakQueue = useRef<Promise<void>>(Promise.resolve());

  const addLog = useCallback((text: string, kind: LogLine['kind'] = 'info') => {
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLog((l) => [{ at, text, kind }, ...l].slice(0, 60));
  }, []);

  // --- token: from the bookmarklet's #token=..., else whatever we stored --
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const fromHash = hash.get('token');
    if (fromHash) {
      localStorage.setItem(TOKEN_KEY, fromHash);
      setToken(fromHash);
      // Don't leave a session token sitting in the address bar.
      history.replaceState(null, '', window.location.pathname);
      addLog('Token received from Serve Tennis.', 'info');
    } else {
      setToken(localStorage.getItem(TOKEN_KEY));
    }
    const v = localStorage.getItem(VOICE_KEY);
    if (v) setVoice(v);
    // Survive an accidental page reload mid-day without losing what we
    // have learned about how long matches are actually taking.
    try {
      const saved = localStorage.getItem(OBS_KEY);
      if (saved) observations.current = JSON.parse(saved) as Observation[];
    } catch { /* corrupt cache just means we relearn */ }
  }, [addLog]);

  useEffect(() => { localStorage.setItem(VOICE_KEY, voice); }, [voice]);

  /**
   * Serve Tennis tokens are ~10h JWTs, so one minted in the evening is dead
   * before the next morning's play. Read the expiry so the page can say when
   * it will stop rather than silently going quiet at the worst moment.
   */
  useEffect(() => {
    if (!token) { setExpiresAt(null); return; }
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.exp) {
        const d = new Date(payload.exp * 1000);
        setExpiresAt(d);
        if (d.getTime() <= Date.now()) setTokenExpired(true);
      }
    } catch { /* opaque token — expiry just goes unshown */ }
  }, [token]);

  // --- speech ------------------------------------------------------------
  /** Voice list arrives asynchronously in Chrome, so wait for it. */
  useEffect(() => {
    const pick = () => {
      const all = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
      if (!all.length) return;
      setVoices(all);
      setVoice((current) => {
        if (current && all.some((v) => v.name === current)) return current;
        const saved = localStorage.getItem(VOICE_KEY);
        if (saved && all.some((v) => v.name === saved)) return saved;
        const preferred = VOICE_PREFERENCE.find((name) =>
          all.some((v) => v.name.startsWith(name))
        );
        const match = preferred
          ? all.find((v) => v.name.startsWith(preferred))
          : all[0];
        return match?.name ?? '';
      });
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
    return () => { speechSynthesis.onvoiceschanged = null; };
  }, []);

  /**
   * Speak one announcement.
   *
   * Rate is dialled back: over a PA outdoors, against kids and parents
   * talking, default speed turns names into mush. Announcements are also
   * strictly serialised — two overlapping voices are worse than silence.
   */
  const speak = useCallback((text: string) => {
    speakQueue.current = speakQueue.current
      .then(() => new Promise<void>((resolve) => {
        try {
          const u = new SpeechSynthesisUtterance(text);
          const v = speechSynthesis.getVoices().find((x) => x.name === voice);
          if (v) u.voice = v;
          u.rate = 0.85;
          u.pitch = 1;
          u.volume = 1;
          u.onstart = () => setSpeaking(true);
          u.onend = () => { setSpeaking(false); resolve(); };
          u.onerror = () => { setSpeaking(false); resolve(); };
          speechSynthesis.speak(u);
        } catch { setSpeaking(false); resolve(); }
      }))
      .catch(() => undefined);
    return speakQueue.current;
  }, [voice]);

  /** Kill everything queued and shut the PA up immediately. */
  const stopSpeaking = useCallback(() => {
    speechSynthesis.cancel();
    speakQueue.current = Promise.resolve();
    setSpeaking(false);
  }, []);

  /**
   * Push the computed board to the public page. Done from here rather than
   * server-side because this laptop is the only place the Serve Tennis token
   * lives — the public board never sees a credential, only the result.
   */
  const publishBoard = useCallback(async (nextLive: NormalisedMatch[]) => {
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
    const board = computeWaitBoard(nextLive, {
      observations: observations.current,
      today,
    });
    try {
      const res = await fetch('/api/ondeck/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: BOARD_SLUG, title: BOARD_TITLE, payload: board }),
      });
      setPublishState(res.status === 401 ? 'signed_out' : res.ok ? 'ok' : 'failed');
    } catch {
      setPublishState('failed');
    }
  }, []);

  // --- polling -----------------------------------------------------------
  const poll = useCallback(async (isFirst: boolean) => {
    if (!token) return;
    try {
      const feed = await fetchFeed(TOURNAMENT_ID, token);
      const { live: nextLive } = normaliseFeed(feed);
      setError(null); setTokenExpired(false); setLastPoll(new Date());

      // Time matches ourselves — the feed has a start but never an end —
      // and tag each one so consolation and main draws learn separately.
      const finished = observeCompletions(prevLive.current, nextLive, new Date());
      for (const f of finished) {
        const src = prevLive.current.find((x) => x.id === f.id);
        if (!src) continue;
        const [h, mm] = f.startTime.split(':').map(Number);
        const start = new Date(f.endedAt); start.setHours(h, mm, 0, 0);
        const mins = (new Date(f.endedAt).getTime() - start.getTime()) / 60000;
        if (mins >= 10 && mins <= 300) {
          observations.current.push({ bucket: bucketOf(src), minutes: mins });
          localStorage.setItem(OBS_KEY, JSON.stringify(observations.current));
        }
      }

      const { toAnnounce, nextAnnounced } = diffForAnnouncement(
        nextLive, announced.current, { seedOnly: isFirst }
      );
      announced.current = nextAnnounced;

      if (isFirst) {
        addLog(`Connected. ${nextLive.length} matches on the sheet; existing ones will not be re-announced.`);
      }
      for (const m of toAnnounce) {
        addLog(`Court ${m.court}: ${m.playerA} vs ${m.playerB}`, 'call');
        void speak(announcementText(m));
      }

      prevLive.current = nextLive;
      setLive(nextLive);
      void publishBoard(nextLive);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'TOKEN_EXPIRED') {
        setTokenExpired(true);
        setError('Serve Tennis session expired — click the bookmarklet again.');
      } else {
        setError(err.message);
      }
    }
  }, [token, addLog, speak, publishBoard]);

  useEffect(() => {
    if (!token || !armed) return;
    let cancelled = false;
    void poll(true);
    const t = setInterval(() => { if (!cancelled) void poll(false); }, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [token, armed, poll]);

  // --- derived view ------------------------------------------------------
  const onCourt = live
    .filter((m) => m.status === 'IN_PROGRESS')
    .sort((a, b) => (a.court ?? '').localeCompare(b.court ?? '', undefined, { numeric: true }));
  const upcoming = live
    .filter((m) => m.status !== 'IN_PROGRESS')
    .sort((a, b) => (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? ''));

  const bookmarklet = `javascript:(async()=>{const r=await fetch('/account/tokens?clientId=clubspark-app',{credentials:'include'});const t=r.headers.get('X-Api-Token');if(!t){alert('Sign in to Serve Tennis first.');return}location.href='${typeof window !== 'undefined' ? window.location.origin : ''}/tournaments/announce#token='+encodeURIComponent(t)})()`;

  // --- setup screen ------------------------------------------------------
  if (!token) {
    return (
      <div style={S.wrap}>
        <h1 style={S.h1}>On Deck Announcer</h1>

        <div style={S.card}>
          <h2 style={S.h2}>Step 1 — install the connect button (once)</h2>
          <p style={S.lead}>
            Press <kbd style={S.kbd}>Ctrl</kbd> + <kbd style={S.kbd}>Shift</kbd> + <kbd style={S.kbd}>B</kbd> to
            show your bookmarks bar, then drag this blue button up onto it:
          </p>
          <p style={{ margin: '18px 0' }}>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href={bookmarklet} style={S.bookmarklet}>🎙️ Announce</a>
          </p>
          <p style={S.muted}>
            It has to be dragged — clicking it here won&apos;t do anything. You only ever do this once.
          </p>
        </div>

        <div style={S.card}>
          <h2 style={S.h2}>Step 2 — connect (every morning)</h2>
          <ol style={S.ol}>
            <li>Open Serve Tennis and sign in as usual.</li>
            <li>Click <strong>🎙️ Announce</strong> on your bookmarks bar.</li>
            <li>You land back here, connected. Press <strong>Start announcing</strong>.</li>
          </ol>
          <p style={S.muted}>
            Serve Tennis logins expire after about 10 hours, so this is a once-a-day thing —
            two clicks, not a re-install. Nothing is sent to any server; the token stays in this browser.
          </p>
        </div>
      </div>
    );
  }

  // --- arm screen (browsers refuse audio without a gesture) --------------
  if (!armed) {
    return (
      <div style={S.wrap}>
        <h1 style={S.h1}>On Deck Announcer</h1>
        <div style={S.card}>
          <p style={S.lead}>Connect the laptop to the PA, turn the volume up, then start.</p>
          <button
            style={S.bigButton}
            onClick={() => { setArmed(true); void speak('Announcer ready.'); }}
          >
            ▶ Start announcing
          </button>
          <p style={S.muted}>
            Browsers block audio until you click something — this is that click.
            Leave the page open all day.
          </p>
        </div>
      </div>
    );
  }

  // --- running -----------------------------------------------------------
  return (
    <div style={S.wrap}>
      <div style={S.headerRow}>
        <h1 style={S.h1}>On Deck Announcer</h1>
        <div style={S.status}>
          <span style={{ ...S.dot, background: error ? '#dc2626' : '#16a34a' }} />
          {error ? error : `Listening · last check ${lastPoll?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '—'}`}
        </div>
      </div>

      {tokenExpired && (
        <div style={S.warn}>
          <strong>Announcements are paused — your Serve Tennis login expired.</strong>
          <br />
          Open Serve Tennis, then click <strong>🎙️ Announce</strong> on your bookmarks bar. Two clicks and
          this page picks straight back up.
        </div>
      )}

      {!tokenExpired && expiresAt && (
        <div style={S.muted}>
          Serve Tennis login good until {expiresAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {' '}— after that, click the 🎙️ Announce bookmark again.
        </div>
      )}

      <div style={S.controls}>
        <label style={S.label}>
          Voice{' '}
          <select value={voice} onChange={(e) => setVoice(e.target.value)} style={S.select}>
            {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </label>

        <button style={S.button} onClick={() => void speak('Attention please. On court five, boys twelve and under singles, quarterfinal. Test announcement.')}>
          Test the PA
        </button>

        <button
          style={speaking ? S.stopButtonActive : S.stopButton}
          onClick={stopSpeaking}
        >
          ■ Stop
        </button>

        <a href={`/tournaments/wait/${BOARD_SLUG}`} target="_blank" rel="noreferrer" style={S.button}>
          Open public board
        </a>

        {publishState === 'signed_out' && (
          <span style={S.warnPill}>
            Public board not updating — sign in to ClubMode on this laptop
          </span>
        )}
        {publishState === 'failed' && <span style={S.warnPill}>Public board failed to update</span>}
        {publishState === 'ok' && <span style={S.badge}>Public board live</span>}

        <span style={S.muted}>
          {observations.current.length
            ? `${observations.current.length} matches timed today`
            : 'Using 55/95 min baselines'}
        </span>
      </div>

      <div style={S.columns}>
        <section style={S.col}>
          <h2 style={S.h2}>On court now ({onCourt.length})</h2>
          {onCourt.length === 0 && <p style={S.muted}>Nothing on court.</p>}
          {onCourt.map((m) => (
            <div key={m.id} style={S.matchCard}>
              <div style={S.court}>{m.court}</div>
              <div style={S.matchBody}>
                <div style={S.players}>{m.playerA} <span style={S.vs}>v</span> {m.playerB}</div>
                <div style={S.meta}>{m.event} · {m.round} · started {m.startTime ?? '—'}</div>
              </div>
              <button style={S.smallButton} onClick={() => void speak(announcementText(m))} title="Announce again">
                🔊
              </button>
            </div>
          ))}
        </section>

        <section style={S.col}>
          <h2 style={S.h2}>Waiting ({upcoming.length})</h2>
          {upcoming.slice(0, 14).map((m) => (
            <div key={m.id} style={{ ...S.matchCard, opacity: 0.75 }}>
              <div style={{ ...S.court, background: '#e5e7eb', color: '#374151' }}>{m.court ?? '–'}</div>
              <div style={S.matchBody}>
                <div style={S.players}>{m.playerA} <span style={S.vs}>v</span> {m.playerB}</div>
                <div style={S.meta}>{m.event} · {m.round} · sched {m.scheduledTime ?? '—'}</div>
              </div>
            </div>
          ))}
          {upcoming.length > 14 && <p style={S.muted}>+{upcoming.length - 14} more</p>}
        </section>

        <section style={S.col}>
          <h2 style={S.h2}>Announcements</h2>
          {log.length === 0 && <p style={S.muted}>Nothing called yet.</p>}
          {log.map((l, i) => (
            <div key={i} style={{ ...S.logLine, color: l.kind === 'error' ? '#dc2626' : l.kind === 'call' ? '#111827' : '#6b7280' }}>
              <span style={S.logTime}>{l.at}</span> {l.text}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1400, margin: '0 auto', padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif', color: '#111827' },
  headerRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  h1: { fontSize: 30, fontWeight: 700, margin: '0 0 4px' },
  h2: { fontSize: 15, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6b7280', margin: '0 0 12px' },
  lead: { fontSize: 18, margin: '0 0 20px' },
  status: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151' },
  dot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, marginTop: 16, boxShadow: '0 1px 2px rgba(0,0,0,.05)' },
  ol: { lineHeight: 2, fontSize: 16, paddingLeft: 20 },
  muted: { color: '#6b7280', fontSize: 14 },
  warn: { background: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e', padding: '12px 16px', borderRadius: 8, marginTop: 16 },
  controls: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', margin: '20px 0' },
  label: { fontSize: 14, color: '#374151' },
  select: { padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, color: '#111827', background: '#fff' },
  button: { padding: '8px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 14, cursor: 'pointer', color: '#111827' },
  stopButton: { padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: '#374151' },
  stopButtonActive: { padding: '8px 18px', borderRadius: 8, border: '1px solid #dc2626', background: '#dc2626', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  bigButton: { padding: '20px 40px', borderRadius: 12, border: 'none', background: '#095896', color: '#fff', fontSize: 22, fontWeight: 700, cursor: 'pointer' },
  smallButton: { border: 'none', background: 'transparent', fontSize: 22, cursor: 'pointer', padding: 4 },
  bookmarklet: { display: 'inline-block', padding: '6px 14px', background: '#095896', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600 },
  badge: { fontSize: 13, background: '#dcfce7', color: '#166534', padding: '5px 10px', borderRadius: 999, fontWeight: 600 },
  columns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, marginTop: 8 },
  col: { minWidth: 0 },
  matchCard: { display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 10 },
  court: { width: 52, height: 52, flexShrink: 0, borderRadius: 10, background: '#095896', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 },
  matchBody: { minWidth: 0, flex: 1 },
  players: { fontSize: 17, fontWeight: 600, lineHeight: 1.3 },
  vs: { color: '#9ca3af', fontWeight: 400 },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  logLine: { fontSize: 14, padding: '5px 0', borderBottom: '1px solid #f3f4f6' },
  logTime: { color: '#9ca3af', marginRight: 8, fontVariantNumeric: 'tabular-nums' },
  warnPill: { fontSize: 13, background: '#fef3c7', color: '#92400e', padding: '5px 10px', borderRadius: 999, fontWeight: 600 },
  kbd: { background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 7px', fontFamily: 'ui-monospace, monospace', fontSize: 14 },
};
