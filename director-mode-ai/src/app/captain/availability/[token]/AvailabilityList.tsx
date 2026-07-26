'use client';

import { useEffect, useRef, useState } from 'react';

export type AvailMatch = {
  id: string;
  matchAt: string;
  isHome: boolean;
  opponent: string | null;
  location: string | null;
  status: 'yes' | 'no' | 'maybe' | null;
};

const OPTIONS: { value: 'yes' | 'no' | 'maybe'; label: string; bg: string; fg: string }[] = [
  { value: 'yes', label: 'Yes', bg: '#D3FB52', fg: '#0f172a' },
  { value: 'no', label: 'No', bg: '#fecaca', fg: '#7f1d1d' },
  { value: 'maybe', label: 'Maybe', bg: '#e2e8f0', fg: '#334155' },
];

function when(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default function AvailabilityList({
  token,
  playerName,
  teamName,
  teamLevel,
  matches,
  preselect,
}: {
  token: string;
  playerName: string;
  teamName: string;
  teamLevel: string | null;
  matches: AvailMatch[];
  preselect: { matchId: string; status: 'yes' | 'no' | 'maybe' } | null;
}) {
  const [state, setState] = useState<Record<string, AvailMatch['status']>>(
    Object.fromEntries(matches.map((m) => [m.id, m.status])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applied = useRef(false);

  async function answer(matchId: string, status: 'yes' | 'no' | 'maybe') {
    setBusy(matchId);
    setError(null);
    const previous = state[matchId];
    setState((s) => ({ ...s, [matchId]: status }));
    try {
      const res = await fetch(`/api/captain/availability/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setState((s) => ({ ...s, [matchId]: previous }));
        setError(j.error || 'Could not save that. Try again.');
      }
    } catch {
      setState((s) => ({ ...s, [matchId]: previous }));
      setError('Network problem — try again.');
    } finally {
      setBusy(null);
    }
  }

  // One-tap from the email: apply the choice carried in the query string.
  useEffect(() => {
    if (applied.current || !preselect) return;
    applied.current = true;
    if (matches.some((m) => m.id === preselect.matchId)) {
      void answer(preselect.matchId, preselect.status);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 560,
        margin: '0 auto',
        padding: '32px 20px 64px',
        color: '#0f172a',
      }}
    >
      <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>
        {teamName}
        {teamLevel ? ` · ${teamLevel}` : ''}
      </p>
      <h1 style={{ fontSize: 24, margin: '4px 0 4px' }}>Hi {playerName}</h1>
      <p style={{ color: '#475569', marginTop: 0 }}>
        Tap your availability for each match. You can change it any time.
      </p>

      {error && (
        <p
          role="alert"
          style={{
            background: '#fef2f2',
            color: '#991b1b',
            padding: '10px 12px',
            borderRadius: 8,
            fontSize: 14,
          }}
        >
          {error}
        </p>
      )}

      {matches.length === 0 && (
        <p style={{ color: '#64748b' }}>No upcoming matches on the schedule yet.</p>
      )}

      {matches.map((m) => (
        <section
          key={m.id}
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 16,
            marginBottom: 12,
            opacity: busy === m.id ? 0.6 : 1,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 16 }}>{when(m.matchAt)}</div>
          <div style={{ color: '#64748b', fontSize: 14, marginTop: 2 }}>
            {m.opponent ? `vs ${m.opponent} · ` : ''}
            {m.isHome ? 'Home' : 'Away'}
            {m.location ? ` · ${m.location}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {OPTIONS.map((o) => {
              const active = state[m.id] === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => answer(m.id, o.value)}
                  disabled={busy === m.id}
                  aria-pressed={active}
                  style={{
                    flex: '1 1 auto',
                    minWidth: 88,
                    padding: '12px 16px',
                    borderRadius: 10,
                    border: active ? '2px solid #0f172a' : '1px solid #cbd5e1',
                    background: active ? o.bg : '#fff',
                    color: active ? o.fg : '#475569',
                    fontWeight: 600,
                    fontSize: 15,
                    cursor: busy === m.id ? 'default' : 'pointer',
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 24 }}>
        Your captain sees these answers. No account needed — this link is yours.
      </p>
    </main>
  );
}
