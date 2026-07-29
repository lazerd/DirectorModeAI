'use client';

/**
 * Pre-season intake, filled in by the player on their own phone. No login —
 * the token in the URL is the credential.
 *
 * Deliberately one screen: partners, side, days out, court limit, anything else.
 * Every extra tap loses responses, and a captain chasing 22 people for this is
 * the exact chore CaptainMode exists to delete.
 */

import { useState } from 'react';

type Mate = { id: string; name: string };

export default function IntakeForm({
  token,
  playerName,
  teamName,
  teammates,
  days,
  current,
}: {
  token: string;
  playerName: string;
  teamName: string;
  teammates: Mate[];
  days: string[];
  current: {
    return_side: string | null;
    court_limit: string | null;
    unavailable_days: string[];
    notes: string | null;
    partner_ids: string[];
    completed_at: string | null;
  };
}) {
  const [side, setSide] = useState(current.return_side ?? 'either');
  const [picked, setPicked] = useState<string[]>(current.partner_ids ?? []);
  const [out, setOut] = useState<string[]>(current.unavailable_days ?? []);
  const [limit, setLimit] = useState(current.court_limit ?? '');
  const [notes, setNotes] = useState(current.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(!!current.completed_at);
  const [error, setError] = useState<string | null>(null);

  const MAX = 5;

  function togglePartner(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : prev.length >= MAX ? prev : [...prev, id],
    );
  }
  function toggleDay(d: string) {
    setOut((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= picked.length) return;
    const next = [...picked];
    [next[i], next[j]] = [next[j], next[i]];
    setPicked(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/captain/intake/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          return_side: side,
          court_limit: limit,
          unavailable_days: out,
          partner_ids: picked,
          notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save.');
      setSaved(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? '—';
  const box: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  };
  const input: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 15,
    fontFamily: 'inherit',
  };

  return (
    <form onSubmit={submit}>
      <h1 style={{ fontSize: 24, margin: '4px 0' }}>Hi {playerName}</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>
        A few questions before the season starts, so {teamName} lineups actually suit you. Takes a
        minute. You can come back to this link and change your answers any time.
      </p>

      {saved && (
        <p
          style={{
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            color: '#065f46',
            padding: 12,
            borderRadius: 10,
          }}
        >
          Saved — thank you. Your captain can see this now.
        </p>
      )}
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

      {/* ---------------------------------------------------------- partners */}
      <div style={box}>
        <strong style={{ fontSize: 15 }}>Who do you play best with?</strong>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 12px' }}>
          Tap up to {MAX}. Order matters — your first pick is your top choice. This is a preference,
          not a promise; your captain still has to cover every court.
        </p>

        {picked.length > 0 && (
          <ol style={{ paddingLeft: 20, margin: '0 0 12px' }}>
            {picked.map((id, i) => (
              <li key={id} style={{ marginBottom: 6 }}>
                <span style={{ marginRight: 8 }}>{nameOf(id)}</span>
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  style={{ marginRight: 4 }}
                  aria-label={`Move ${nameOf(id)} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === picked.length - 1}
                  aria-label={`Move ${nameOf(id)} down`}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {teammates.map((t) => {
            const on = picked.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => togglePartner(t.id)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: on ? '2px solid #0f766e' : '1px solid #d1d5db',
                  background: on ? '#ccfbf1' : '#fff',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                {on ? `${picked.indexOf(t.id) + 1}. ` : ''}
                {t.name}
              </button>
            );
          })}
        </div>
        {teammates.length === 0 && (
          <p style={{ color: '#6b7280', fontSize: 13 }}>
            No teammates on the roster yet — your captain is still building it.
          </p>
        )}
      </div>

      {/* -------------------------------------------------------------- side */}
      <div style={box}>
        <strong style={{ fontSize: 15 }}>Which side do you return on?</strong>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {[
            { v: 'deuce', l: 'Deuce (right)' },
            { v: 'ad', l: 'Ad (left)' },
            { v: 'either', l: 'Either' },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setSide(o.v)}
              style={{
                flex: 1,
                padding: '10px 8px',
                borderRadius: 10,
                border: side === o.v ? '2px solid #0f766e' : '1px solid #d1d5db',
                background: side === o.v ? '#ccfbf1' : '#fff',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* -------------------------------------------------------- days out */}
      <div style={box}>
        <strong style={{ fontSize: 15 }}>Any days you can never play?</strong>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 10px' }}>
          Standing commitments — work, another team, school pickup. Leave blank if you&apos;re open.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {days.map((d) => {
            const on = out.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: on ? '2px solid #b45309' : '1px solid #d1d5db',
                  background: on ? '#fef3c7' : '#fff',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------ court limit */}
      <div style={box}>
        <strong style={{ fontSize: 15 }}>Anything about which court you play?</strong>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 10px' }}>
          Optional — e.g. &quot;happy anywhere&quot;, &quot;court 3 or below&quot;, &quot;not court
          1&quot;.
        </p>
        <input
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="Happy anywhere"
          style={input}
        />
      </div>

      {/* ------------------------------------------------------------ notes */}
      <div style={box}>
        <strong style={{ fontSize: 15 }}>Anything else your captain should know?</strong>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 10px' }}>
          Injuries, travel, a partner you&apos;d rather not be paired with. Only your captain sees
          this.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Out the first two weeks of October."
          style={{ ...input, resize: 'vertical' }}
        />
      </div>

      <button
        type="submit"
        disabled={busy}
        style={{
          marginTop: 20,
          width: '100%',
          padding: '14px 16px',
          borderRadius: 12,
          border: 'none',
          background: '#0f766e',
          color: '#fff',
          fontSize: 16,
          fontWeight: 600,
          cursor: 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Saving…' : saved ? 'Update my answers' : 'Send to my captain'}
      </button>

      <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 14, textAlign: 'center' }}>
        This link is yours — no account or password needed.
      </p>
    </form>
  );
}
