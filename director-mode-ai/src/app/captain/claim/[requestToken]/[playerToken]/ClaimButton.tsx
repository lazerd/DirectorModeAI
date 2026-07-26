'use client';

import { useState } from 'react';

type Outcome = 'open' | 'mine' | 'taken' | 'error';

export default function ClaimButton({
  requestToken,
  playerToken,
  playerName,
  teamName,
  when,
  detail,
  initialStatus,
  initiallyMine,
}: {
  requestToken: string;
  playerToken: string;
  playerName: string;
  teamName: string;
  when: string;
  detail: string;
  initialStatus: string;
  initiallyMine: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>(
    initiallyMine ? 'mine' : initialStatus === 'open' ? 'open' : 'taken',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/captain/claim/${requestToken}/${playerToken}`, {
        method: 'POST',
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOutcome('error');
        setMessage(j.error || 'Something went wrong.');
      } else if (j.ok) {
        setOutcome('mine');
      } else if (j.claimedByYou) {
        setOutcome('mine');
      } else {
        setOutcome('taken');
      }
    } catch {
      setOutcome('error');
      setMessage('Network problem — try again.');
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
        {outcome === 'mine' ? "You're in — thanks!" : `${playerName}, can you sub?`}
      </h1>

      <div
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 16 }}>{when}</div>
        {detail && <div style={{ color: '#64748b', fontSize: 14, marginTop: 2 }}>{detail}</div>}
      </div>

      {outcome === 'open' && (
        <>
          <button
            onClick={claim}
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
            {busy ? 'Claiming…' : '✓ I can play — claim this spot'}
          </button>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 12 }}>
            First to claim gets the spot.
          </p>
        </>
      )}

      {outcome === 'mine' && (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            padding: 16,
            borderRadius: 12,
          }}
        >
          <strong>You have the spot.</strong>
          <div style={{ marginTop: 4, fontSize: 14 }}>
            Your captain has been notified and the lineup is updated.
          </div>
        </div>
      )}

      {outcome === 'taken' && (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            color: '#475569',
            padding: 16,
            borderRadius: 12,
          }}
        >
          <strong>Already filled.</strong>
          <div style={{ marginTop: 4, fontSize: 14 }}>
            Someone else grabbed this one first — thanks for being quick.
          </div>
        </div>
      )}

      {outcome === 'error' && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: 16,
            borderRadius: 12,
          }}
        >
          {message || 'Something went wrong.'}
        </div>
      )}
    </main>
  );
}
