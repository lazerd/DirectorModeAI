'use client';

/**
 * Public wait board — what a parent sees after scanning the QR code at the desk.
 *
 * The whole design brief is one sentence: answer "how much longer?" without
 * anyone having to ask a human. So the search box is the hero, not the grid —
 * a parent types their kid's name and gets a single, direct answer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatWait, formatAhead, findPlayer, prettyRound, type WaitBoard } from '@/lib/ondeck/board';

const REFRESH_MS = 10_000;

/**
 * Past this, we stop showing wait estimates at all. A board that has not
 * been updated in half an hour is not "slightly behind" — the courts have
 * moved on, and a confident-looking "~20 min" from an hour ago will send a
 * family away from the club and lose them their match.
 */
const TRUST_LIMIT_SECONDS = 30 * 60;

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

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>{data.title || 'Order of play'}</h1>

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
                ? `Scheduled ${result.row.scheduledTime ?? ''}`
                : formatWait(result.row.etaLowMin, result.row.etaHighMin)}
            </div>
            <div style={S.answerSub}>
              {board.isFutureDate || !trustEstimates ? '' : formatAhead(result.row.ahead)}
              {result.row.court ? ` on court ${result.row.court}` : ''}
              {result.row.scheduledTime ? ` · scheduled ${result.row.scheduledTime}` : ''}
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
            <div style={{ ...S.court, background: '#e5e7eb', color: '#374151' }}>{r.court ?? '–'}</div>
            <div style={S.rowBody}>
              <div style={S.players}>{r.playerA} <span style={S.vs}>v</span> {r.playerB}</div>
              <div style={S.meta}>{r.event}{r.round ? ` · ${prettyRound(r.round)}` : ''}</div>
            </div>
            <div style={S.waitCell}>
              {board.isFutureDate || !trustEstimates ? (
                <div style={S.waitBig}>{r.scheduledTime ?? ''}</div>
              ) : (
                <>
                  <div style={S.waitBig}>{formatWait(r.etaLowMin, r.etaHighMin)}</div>
                  <div style={S.waitSub}>{formatAhead(r.ahead)}</div>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      <p style={S.footer}>
        Wait times are estimates and move with the tennis — a long three-setter pushes
        everything back. Updates automatically; no need to refresh.
        {board.provisional && ' Estimates are still settling as today’s matches finish.'}
      </p>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: '0 auto', padding: '20px 16px 60px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#111827' },
  h1: { fontSize: 24, fontWeight: 700, margin: '0 0 16px', lineHeight: 1.25 },
  h2: { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b7280', margin: '28px 0 10px' },
  muted: { color: '#6b7280', fontSize: 15 },
  warn: { background: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e', padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 15 },
  searchCard: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 },
  searchLabel: { display: 'block', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b7280', marginBottom: 8 },
  // Colour set inline: the global stylesheet renders unstyled inputs white-on-white.
  search: { width: '100%', boxSizing: 'border-box', padding: '14px 16px', fontSize: 17, borderRadius: 10, border: '1px solid #d1d5db', color: '#111827', background: '#fff' },
  answer: { marginTop: 14, padding: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10 },
  answerNow: { marginTop: 14, padding: 14, background: '#dcfce7', border: '1px solid #16a34a', borderRadius: 10 },
  answerBig: { fontSize: 26, fontWeight: 700, lineHeight: 1.2 },
  answerSub: { fontSize: 15, color: '#4b5563', marginTop: 4 },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f3f4f6' },
  court: { width: 44, height: 44, flexShrink: 0, borderRadius: 10, background: '#095896', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, fontWeight: 700 },
  rowBody: { flex: 1, minWidth: 0 },
  players: { fontSize: 16, fontWeight: 600, lineHeight: 1.3 },
  vs: { color: '#9ca3af', fontWeight: 400 },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  waitCell: { textAlign: 'right', flexShrink: 0 },
  waitBig: { fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' },
  waitSub: { fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' },
  footer: { marginTop: 32, fontSize: 13, color: '#6b7280', lineHeight: 1.6 },
};
