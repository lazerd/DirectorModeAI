'use client';

import { useState } from 'react';

export default function ConfirmButton({
  token,
  matchId,
  playerName,
  teamName,
  when,
  detail,
  court,
  inLineup,
  alreadyConfirmed,
}: {
  token: string;
  matchId: string;
  playerName: string;
  teamName: string;
  when: string;
  detail: string;
  court: string | null;
  inLineup: boolean;
  alreadyConfirmed: boolean;
}) {
  const [done, setDone] = useState(alreadyConfirmed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/captain/confirm/${token}/${matchId}`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(j.error || 'Could not confirm. Try again.');
      else setDone(true);
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 520,
        margin: '0 auto',
        padding: '40px 20px',
        color: '#0f172a',
      }}
    >
      <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>{teamName}</p>
      <h1 style={{ fontSize: 24, margin: '4px 0 12px' }}>
        {done ? "You're confirmed" : `${playerName}, can you confirm?`}
      </h1>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>{when}</div>
        {detail && <div style={{ color: '#64748b', fontSize: 14, marginTop: 2 }}>{detail}</div>}
        {court && (
          <div style={{ marginTop: 8, fontWeight: 600 }}>
            You&rsquo;re on <span style={{ color: '#0369a1' }}>{court}</span>
          </div>
        )}
      </div>

      {!inLineup && (
        <p style={{ color: '#64748b' }}>
          You&rsquo;re not in this lineup right now. If that looks wrong, check with your captain.
        </p>
      )}

      {inLineup && !done && (
        <button
          onClick={confirm}
          disabled={busy}
          style={{
            width: '100%',
            padding: '16px 20px',
            borderRadius: 12,
            border: 'none',
            background: '#D3FB52',
            color: '#0f172a',
            fontWeight: 700,
            fontSize: 17,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Confirming…' : "✓ I'll be there"}
        </button>
      )}

      {done && (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            padding: 16,
            borderRadius: 12,
          }}
        >
          <strong>Thanks — your captain knows you&rsquo;re in.</strong>
          <div style={{ marginTop: 4, fontSize: 14 }}>
            You&rsquo;ll get a reminder the day before.
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          style={{
            background: '#fef2f2',
            color: '#991b1b',
            padding: '10px 12px',
            borderRadius: 8,
            fontSize: 14,
            marginTop: 12,
          }}
        >
          {error}
        </p>
      )}
    </main>
  );
}
