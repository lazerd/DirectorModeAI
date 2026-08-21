'use client';

import { useState } from 'react';

/**
 * Player-facing, so it paints its own light background: the app shell sets a
 * dark navy body in globals.css and a page that leaves it alone renders
 * near-black text on navy on a phone.
 */
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
  alreadyDeclined,
  openPanel,
  googleUrl,
  icsUrl,
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
  alreadyDeclined: boolean;
  openPanel: 'out' | null;
  googleUrl: string | null;
  icsUrl: string;
}) {
  const [state, setState] = useState<'none' | 'in' | 'out'>(
    alreadyDeclined ? 'out' : alreadyConfirmed ? 'in' : 'none',
  );
  // ?a=out from the email opens the withdraw panel but never submits it.
  const [withdrawing, setWithdrawing] = useState(openPanel === 'out' && !alreadyDeclined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'in' | 'out' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: 'in' | 'out') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/captain/confirm/${token}/${matchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: action === 'out' ? note : undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not save that. Try again.');
      } else {
        setState(action);
        setWithdrawing(false);
      }
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ colorScheme: 'light', background: '#f1f5f9', minHeight: '100vh' }}>
      <main
        style={{
          fontFamily: 'system-ui, sans-serif',
          maxWidth: 520,
          margin: '0 auto',
          padding: '40px 20px 60px',
          color: '#0f172a',
        }}
      >
        <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>{teamName}</p>
        <h1 style={{ fontSize: 24, margin: '4px 0 12px' }}>
          {state === 'in'
            ? "You're confirmed"
            : state === 'out'
              ? "You're out of this lineup"
              : `${playerName}, can you play?`}
        </h1>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 16 }}>{when}</div>
          {detail && <div style={{ color: '#64748b', fontSize: 14, marginTop: 2 }}>{detail}</div>}
          {court && (
            <div style={{ marginTop: 8, fontWeight: 600 }}>
              You&rsquo;re on <span style={{ color: '#0369a1' }}>{court}</span>
            </div>
          )}
        </div>

        {!inLineup && (
          <p style={{ color: '#475569' }}>
            You&rsquo;re not in this lineup right now. If that looks wrong, check with your captain.
          </p>
        )}

        {inLineup && state === 'none' && !withdrawing && (
          <>
            <button
              onClick={() => submit('in')}
              disabled={!!busy}
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
              {busy === 'in' ? 'Confirming…' : "✓ Yes — I'll be there"}
            </button>
            <button
              onClick={() => setWithdrawing(true)}
              style={{
                width: '100%',
                marginTop: 10,
                padding: '14px 20px',
                borderRadius: 12,
                border: '1px solid #fecaca',
                background: '#fff1f2',
                color: '#991b1b',
                fontWeight: 600,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              ✗ Sorry — I can&rsquo;t play
            </button>
          </>
        )}

        {inLineup && withdrawing && (
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #fecaca',
              borderRadius: 12,
              padding: 16,
            }}
          >
            <strong style={{ fontSize: 16 }}>Pull out of this match?</strong>
            <p style={{ color: '#475569', fontSize: 14, margin: '6px 0 12px' }}>
              Your captain gets an email right away so they can find a sub. Totally fine — just
              please don&rsquo;t leave it to match morning.
            </p>
            <label
              htmlFor="withdraw-note"
              style={{ display: 'block', fontSize: 13, color: '#475569', marginBottom: 4 }}
            >
              Anything you want to tell your captain? (optional)
            </label>
            <textarea
              id="withdraw-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. shoulder is acting up, back for the next one"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: 15,
                fontFamily: 'inherit',
                // Tailwind's layered base loses to nothing here, but the app's
                // dark inputs elsewhere go white-on-white — set both by hand.
                background: '#ffffff',
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={() => submit('out')}
              disabled={!!busy}
              style={{
                width: '100%',
                marginTop: 12,
                padding: '15px 20px',
                borderRadius: 12,
                border: 'none',
                background: '#dc2626',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: 16,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy === 'out' ? 'Letting them know…' : 'Yes, take me out of this lineup'}
            </button>
            <button
              onClick={() => setWithdrawing(false)}
              style={{
                width: '100%',
                marginTop: 8,
                padding: '12px 20px',
                borderRadius: 12,
                border: 'none',
                background: 'transparent',
                color: '#475569',
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Never mind — I can play
            </button>
          </div>
        )}

        {state === 'in' && (
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
            <button
              onClick={() => setWithdrawing(true)}
              style={{
                marginTop: 10,
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: '#b91c1c',
                fontSize: 14,
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Something changed — I can&rsquo;t play after all
            </button>
          </div>
        )}

        {state === 'out' && !withdrawing && (
          <div
            style={{
              background: '#fff1f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: 16,
              borderRadius: 12,
            }}
          >
            <strong>Got it — your captain has been told.</strong>
            <div style={{ marginTop: 4, fontSize: 14 }}>
              You&rsquo;re marked unavailable for this match. Thanks for the heads-up.
            </div>
            <button
              onClick={() => submit('in')}
              disabled={!!busy}
              style={{
                marginTop: 10,
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: '#166534',
                fontSize: 14,
                textDecoration: 'underline',
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              {busy === 'in' ? 'Saving…' : 'Actually, I can play — put me back'}
            </button>
          </div>
        )}

        {/* Only worth offering while they're still in it. */}
        {inLineup && state !== 'out' && (
          <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
            <p
              style={{
                fontSize: 12,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: '#64748b',
                margin: '0 0 10px',
              }}
            >
              Put it on your calendar
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {googleUrl && (
                <a
                  href={googleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={calBtn}
                >
                  📅 Google Calendar
                </a>
              )}
              <a href={icsUrl} style={calBtn}>
                📅 Apple / Outlook
              </a>
            </div>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '10px 0 0' }}>
              Includes your court, the address and the arrival time, with reminders the night
              before and an hour out.
            </p>
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
    </div>
  );
}

const calBtn: React.CSSProperties = {
  flex: '1 1 46%',
  textAlign: 'center',
  padding: '13px 16px',
  borderRadius: 10,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#0f172a',
  fontWeight: 600,
  fontSize: 15,
  textDecoration: 'none',
};
