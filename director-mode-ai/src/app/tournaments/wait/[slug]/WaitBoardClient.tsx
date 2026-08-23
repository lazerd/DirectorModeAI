'use client';

/**
 * Public wait board — what a parent sees after scanning the QR code at the desk.
 *
 * The whole design brief is one sentence: answer "how much longer?" without
 * anyone having to ask a human. So the search box is the hero, not the grid —
 * a parent types their kid's name and gets a single, direct answer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatAhead, findPlayer, prettyRound, formatClock, waitHeadline, type WaitBoard } from '@/lib/ondeck/board';
import { pickVoice, speak, stopSpeaking, reportToDeskText } from '@/lib/ondeck/speech';

/**
 * Wait times move on the scale of whole matches, so a phone in someone's
 * pocket has nothing to gain from a faster refresh — and a busy Sunday can
 * put fifty of them on this page at once.
 */
const REFRESH_MS = 45_000;

/**
 * Past this, we stop showing wait estimates at all. A board that has not
 * been updated in half an hour is not "slightly behind" — the courts have
 * moved on, and a confident-looking "~20 min" from an hour ago will send a
 * family away from the club and lose them their match.
 */
const TRUST_LIMIT_SECONDS = 30 * 60;

/**
 * Desk mode adds a call button to every match. It is remembered per device,
 * so the desk laptop keeps it and a parent's phone never sees it.
 *
 * Safe to expose at all: speech happens in whoever's browser pressed the
 * button, so the laptop wired to the PA is the only device that can make a
 * sound in the clubhouse.
 */
const DESK_KEY = 'ondeck.deskMode';
const VOICE_KEY = 'ondeck.voice';

/** A call is read twice — nobody catches a name the first time. */
const CALL_REPEATS = 2;

/** "7:54 PM" / "yesterday at 7:54 PM" — never a raw minute count. */
function lastUpdatedPhrase(updatedAt: string): string {
  const then = new Date(updatedAt);
  const now = new Date();
  const time = then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = then.toDateString() === now.toDateString();
  if (sameDay) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return `${then.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

interface Payload {
  title: string;
  board: WaitBoard;
  updatedAt: string;
  ageSeconds: number;
  stale: boolean;
}

export default function WaitBoardClient({ slug }: { slug: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [deskMode, setDeskMode] = useState(false);
  const [voice, setVoice] = useState('');
  const [calling, setCalling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ondeck/board?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' });
      if (res.status === 404) { setError('This board is not live yet.'); setLoading(false); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // ?desk=1 turns it on and is remembered, so the laptop only needs it once.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('desk');
    if (fromUrl === '1') { localStorage.setItem(DESK_KEY, '1'); setDeskMode(true); }
    else if (fromUrl === '0') { localStorage.removeItem(DESK_KEY); setDeskMode(false); }
    else setDeskMode(localStorage.getItem(DESK_KEY) === '1');
  }, []);

  useEffect(() => {
    if (!deskMode) return;
    const choose = () => setVoice(pickVoice(localStorage.getItem(VOICE_KEY)));
    choose();
    speechSynthesis.onvoiceschanged = choose;
    return () => { speechSynthesis.onvoiceschanged = null; };
  }, [deskMode]);

  const callPlayers = useCallback((id: string, a: string, b: string) => {
    setCalling(id);
    void speak(reportToDeskText(a, b), { voice, times: CALL_REPEATS })
      .finally(() => setCalling((c) => (c === id ? null : c)));
  }, [voice]);

  const result = useMemo(
    () => (data?.board ? findPlayer(data.board, query) : null),
    [data, query]
  );

  if (loading) return <div style={S.wrap}><p style={S.muted}>Loading…</p></div>;

  if (error || !data) {
    return (
      <div style={S.wrap}>
        <h1 style={S.h1}>Order of play</h1>
        <p style={S.muted}>{error ?? 'Not available.'}</p>
        <p style={S.muted}>Please check with the tournament desk.</p>
      </div>
    );
  }

  const { board } = data;
  // Too old to quote a wait for. Times still shown, estimates withheld.
  const trustEstimates = data.ageSeconds <= TRUST_LIMIT_SECONDS;

  const CallButton = ({ id, a, b }: { id: string; a: string; b: string }) => (
    <button
      onClick={() => callPlayers(id, a, b)}
      style={calling === id ? S.micActive : S.mic}
      title={`Call ${a} and ${b} to the tournament desk`}
      aria-label={`Call ${a} and ${b} to the tournament desk`}
    >
      🎤
    </button>
  );

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>{data.title || 'Order of play'}</h1>

      {deskMode && (
        <div style={S.deskBar}>
          <span style={S.deskBadge}>Desk mode</span>
          <span style={S.muted}>Tap 🎤 to call players to the desk.</span>
          <button style={S.stopBtn} onClick={stopSpeaking}>■ Stop</button>
        </div>
      )}

      {data.stale && (
        <div style={S.warn}>
          <strong>This board isn&apos;t live right now.</strong>
          <br />
          Last updated {lastUpdatedPhrase(data.updatedAt)}. Please check the order of play
          with the tournament desk.
        </div>
      )}

      {/* The search box is the product. Everything below it is backup. */}
      <div style={S.searchCard}>
        <label htmlFor="q" style={S.searchLabel}>Find your match</label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a player's name"
          autoComplete="off"
          style={S.search}
        />

        {result?.kind === 'on_court' && (
          <div style={S.answerNow}>
            <div style={S.answerBig}>On court {result.row.court} now</div>
            <div style={S.answerSub}>
              {result.row.playerA} v {result.row.playerB}
              {result.row.elapsedMin !== null && ` · started ${result.row.elapsedMin} min ago`}
            </div>
          </div>
        )}

        {result?.kind === 'waiting' && (
          <div style={S.answer}>
            <div style={S.answerBig}>
              {board.isFutureDate || !trustEstimates
                ? formatClock(result.row.scheduledTime)
                : waitHeadline(result.row)}
            </div>
            <div style={S.answerSub}>
              Scheduled {formatClock(result.row.scheduledTime)}
              {!board.isFutureDate && trustEstimates && result.row.estimatedStart
                ? ` · estimated ${formatClock(result.row.estimatedStart)}`
                : ''}
            </div>
            <div style={S.answerSub}>
              {board.isFutureDate || !trustEstimates ? '' : formatAhead(result.row.ahead)}
              {result.row.court ? ` · court ${result.row.court}` : ''}
            </div>
            <div style={S.answerSub}>{result.row.playerA} v {result.row.playerB}</div>
          </div>
        )}

        {result?.kind === 'not_found' && (
          <p style={S.muted}>
            No match found for “{query}”. They may have finished for the day — check with the desk.
          </p>
        )}
      </div>

      <section>
        <h2 style={S.h2}>On court now</h2>
        {board.onCourt.length === 0 && <p style={S.muted}>Nothing on court.</p>}
        {board.onCourt.map((r) => (
          <div key={r.court} style={S.row}>
            <div style={S.court}>{r.court}</div>
            <div style={S.rowBody}>
              <div style={S.players}>{r.playerA} <span style={S.vs}>v</span> {r.playerB}</div>
              <div style={S.meta}>
                {r.event}{r.round ? ` · ${prettyRound(r.round)}` : ''}
                {r.elapsedMin !== null && ` · ${r.elapsedMin} min in`}
              </div>
            </div>
            {deskMode && <CallButton id={`c-${r.court}`} a={r.playerA} b={r.playerB} />}
          </div>
        ))}
      </section>

      <section>
        <h2 style={S.h2}>
          {board.isFutureDate && board.boardDate
            ? `${new Date(board.boardDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} — order of play`
            : 'Coming up'}
        </h2>
        {board.waiting.length === 0 && <p style={S.muted}>Nothing else scheduled.</p>}
        {board.waiting.map((r) => (
          <div key={r.id} style={S.row}>
            <div style={{ ...S.court, background: '#1e4a63', color: '#cbd5e1' }}>{r.court ?? '–'}</div>
            <div style={S.rowBody}>
              <div style={S.players}>{r.playerA} <span style={S.vs}>v</span> {r.playerB}</div>
              <div style={S.meta}>{r.event}{r.round ? ` · ${prettyRound(r.round)}` : ''}</div>
            </div>
            {deskMode && <CallButton id={r.id} a={r.playerA} b={r.playerB} />}
            <div style={S.waitCell}>
              {board.isFutureDate || !trustEstimates ? (
                <div style={S.waitBig}>{formatClock(r.scheduledTime)}</div>
              ) : (
                <>
                  <div style={S.waitBig}>{waitHeadline(r)}</div>
                  <div style={S.waitSub}>Sched {formatClock(r.scheduledTime)}</div>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      <p style={S.footer}>
        Scheduled times are official. Estimates are our best guess from how long
        matches are actually taking today, and they move with the tennis — one long
        three-setter pushes everything back. Updates automatically; no need to refresh.
        {board.provisional && ' Estimates are still settling as today’s matches finish.'}
      </p>
    </div>
  );
}

/**
 * Palette is explicit and dark-first: the ClubMode shell paints a dark navy
 * body, so anything relying on a default background renders dark-on-dark and
 * disappears. Sizes are deliberately large — this is read on a phone, one
 * handed, in direct sun, by someone who is already annoyed.
 */
const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: '0 auto', padding: '20px 16px 60px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#f1f5f9' },
  h1: { fontSize: 26, fontWeight: 800, margin: '0 0 16px', lineHeight: 1.2, color: '#ffffff' },
  h2: { fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7dd3fc', margin: '30px 0 10px' },
  muted: { color: '#94a3b8', fontSize: 15 },
  warn: { background: '#7c2d12', border: '1px solid #fb923c', color: '#ffedd5', padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 15 },
  searchCard: { background: '#0b2b3d', border: '1px solid #17455f', borderRadius: 12, padding: 16 },
  searchLabel: { display: 'block', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#7dd3fc', marginBottom: 8 },
  // Colour set inline: globals.css otherwise renders inputs white-on-white.
  search: { width: '100%', boxSizing: 'border-box', padding: '15px 16px', fontSize: 18, borderRadius: 10, border: '1px solid #38617a', color: '#0f172a', background: '#ffffff' },
  answer: { marginTop: 14, padding: 16, background: '#0f3a52', border: '1px solid #17455f', borderRadius: 10 },
  answerNow: { marginTop: 14, padding: 16, background: '#14532d', border: '1px solid #22c55e', borderRadius: 10 },
  answerBig: { fontSize: 28, fontWeight: 800, lineHeight: 1.15, color: '#ffffff' },
  answerSub: { fontSize: 16, color: '#cbd5e1', marginTop: 5 },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #123a4f' },
  court: { width: 48, height: 48, flexShrink: 0, borderRadius: 10, background: '#0284c7', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, fontWeight: 800 },
  rowBody: { flex: 1, minWidth: 0 },
  players: { fontSize: 18, fontWeight: 700, lineHeight: 1.3, color: '#ffffff' },
  vs: { color: '#7891a5', fontWeight: 400 },
  meta: { fontSize: 13.5, color: '#94a3b8', marginTop: 3 },
  waitCell: { textAlign: 'right', flexShrink: 0 },
  waitBig: { fontSize: 16, fontWeight: 800, whiteSpace: 'nowrap', color: '#fbbf24' },
  waitSub: { fontSize: 12.5, color: '#94a3b8', whiteSpace: 'nowrap' },
  deskBar: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, padding: '10px 12px', background: '#0b2b3d', border: '1px solid #17455f', borderRadius: 10 },
  deskBadge: { fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', background: '#0284c7', color: '#fff', padding: '4px 9px', borderRadius: 999 },
  stopBtn: { marginLeft: 'auto', padding: '7px 14px', borderRadius: 8, border: '1px solid #ef4444', background: 'transparent', color: '#fca5a5', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  mic: { flexShrink: 0, width: 46, height: 46, borderRadius: 10, border: '1px solid #17455f', background: '#0b2b3d', fontSize: 21, cursor: 'pointer', lineHeight: 1 },
  micActive: { flexShrink: 0, width: 46, height: 46, borderRadius: 10, border: '1px solid #22c55e', background: '#14532d', fontSize: 21, cursor: 'pointer', lineHeight: 1 },
  footer: { marginTop: 32, fontSize: 13, color: '#7891a5', lineHeight: 1.6 },
};
