'use client';

import { useEffect, useRef, useState } from 'react';

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(new Date(iso));

export default function MakeupVote({
  token,
  pollId,
  playerName,
  teamName,
  originalAt,
  opponent,
  location,
  note,
  options,
  initial,
  preselect,
  timeZone,
}: {
  token: string;
  pollId: string;
  playerName: string;
  teamName: string;
  originalAt: string | null;
  opponent: string | null;
  location: string | null;
  note: string | null;
  options: string[];
  initial: Record<number, 'yes' | 'no'>;
  preselect: { index: number; answer: 'yes' | 'no' } | null;
  timeZone: string;
}) {
  const [state, setState] = useState<Record<number, 'yes' | 'no'>>(initial);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applied = useRef(false);

  async function answer(index: number, a: 'yes' | 'no') {
    setBusy(index);
    setError(null);
    const prev = state[index];
    setState((s) => ({ ...s, [index]: a }));
    try {
      const res = await fetch(`/api/captain/makeup/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poll_id: pollId, option_index: index, answer: a }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save.');
    } catch (e) {
      setState((s) => ({ ...s, [index]: prev }));
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(null);
    }
  }

  // A Yes/No button in the email lands here already chosen — record it.
  useEffect(() => {
    if (applied.current || !preselect) return;
    applied.current = true;
    void answer(preselect.index, preselect.answer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = options.every((_, i) => state[i]);

  return (
    // The app shell paints a dark navy body; this player page paints its own.
    <div style={{ colorScheme: 'light', background: '#f1f5f9', minHeight: '100vh' }}>
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 540, margin: '0 auto', padding: '32px 16px', color: '#0f172a' }}>
        <div style={{ fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>{teamName}</div>
        <h1 style={{ fontSize: 24, margin: '6px 0 8px' }}>Hi {playerName} — makeup dates</h1>
        <p style={{ color: '#475569', fontSize: 16, lineHeight: 1.5, margin: '0 0 18px' }}>
          {originalAt ? `The ${fmt(originalAt, { weekday: 'long', month: 'short', day: 'numeric' }, timeZone)} match` : 'The match'}
          {opponent ? ` vs ${opponent}` : ''} was rained out. Can you play either of these? Please answer both.
        </p>
        {note && (
          <p style={{ fontSize: 15, lineHeight: 1.5, margin: '0 0 18px', padding: '12px 14px', background: '#fff', borderLeft: '3px solid #84cc16', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
            {note}
          </p>
        )}

        {options.map((iso, i) => {
          const s = state[i];
          return (
            <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' }, timeZone)}</div>
              <div style={{ fontSize: 14, color: '#475569', margin: '2px 0 12px' }}>
                {fmt(iso, { hour: 'numeric', minute: '2-digit' }, timeZone)}
                {location ? ` · ${location}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {(['yes', 'no'] as const).map((a) => {
                  const on = s === a;
                  const color = a === 'yes' ? '#16a34a' : '#dc2626';
                  return (
                    <button
                      key={a}
                      onClick={() => answer(i, a)}
                      disabled={busy === i}
                      style={{
                        flex: 1,
                        padding: '12px 0',
                        fontSize: 16,
                        fontWeight: 600,
                        borderRadius: 10,
                        border: `2px solid ${on ? color : '#cbd5e1'}`,
                        background: on ? color : '#fff',
                        color: on ? '#fff' : '#0f172a',
                        cursor: 'pointer',
                      }}
                    >
                      {a === 'yes' ? '✓ Yes' : '✗ No'}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {error && <p style={{ color: '#dc2626', fontSize: 14 }}>{error}</p>}
        <p style={{ color: done ? '#15803d' : '#64748b', fontSize: 15, marginTop: 8 }}>
          {done ? 'Thanks — your captain has your answers. You can change them any time from this link.' : 'Tap Yes or No for each date.'}
        </p>
      </main>
    </div>
  );
}
