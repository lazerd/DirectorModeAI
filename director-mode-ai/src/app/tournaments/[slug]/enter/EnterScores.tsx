'use client';
import { useState } from 'react';

type Row = {
  token: string;
  a: string;
  b: string;
  score: string;
  winner_side: 'a' | 'b' | null;
  status: string;
};

export default function EnterScores({
  eventName,
  notes,
  matches,
}: {
  eventName: string;
  notes: string;
  matches: Row[];
}) {
  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        maxWidth: 720,
        margin: '0 auto',
        padding: '28px 18px 90px',
        color: '#1f2937',
      }}
    >
      <h1 style={{ fontSize: 26, margin: '0 0 6px', color: '#0f172a' }}>{eventName}</h1>
      <p style={{ color: '#6b7280', margin: '0 0 10px', lineHeight: 1.5 }}>
        Enter your match scores below. Find your match, tap the <strong>winner</strong>, type the{' '}
        <strong>score</strong>, add your name, and hit Submit. Already played? You can update a score anytime.
      </p>
      {notes && (
        <p
          style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 14,
            color: '#1e3a5f',
          }}
        >
          <strong>Scoring:</strong> {notes}
        </p>
      )}
      <div style={{ marginTop: 16 }}>
        {matches.map((m) => (
          <MatchCard key={m.token} m={m} />
        ))}
      </div>
    </main>
  );
}

function MatchCard({ m }: { m: Row }) {
  const [winner, setWinner] = useState<'a' | 'b' | ''>(m.winner_side || '');
  const [score, setScore] = useState(m.score || '');
  const [name, setName] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>(
    m.status === 'completed' ? 'saved' : 'idle'
  );
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    if (winner !== 'a' && winner !== 'b') return setErr('Tap the winner.');
    if (!score.trim()) return setErr('Enter the score (e.g. 6-4, 3-6, 10-7).');
    setState('saving');
    const res = await fetch(`/api/tournaments/match/${m.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner_side: winner, score: score.trim(), reported_by_name: name.trim() }),
    });
    if (res.ok) {
      setState('saved');
    } else {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || 'Could not save — try again.');
      setState('idle');
    }
  }

  const sideBtn = (side: 'a' | 'b', label: string) => (
    <button
      type="button"
      onClick={() => setWinner(side)}
      style={{
        flex: 1,
        padding: '11px 8px',
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: 15,
        fontWeight: 600,
        textAlign: 'left',
        border: winner === side ? '2px solid #16a34a' : '1px solid #d1d5db',
        background: winner === side ? '#dcfce7' : '#fff',
        color: '#111827',
      }}
    >
      {winner === side ? '✓ ' : ''}
      {label}
    </button>
  );

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
        background: state === 'saved' ? '#f6fefb' : '#fff',
      }}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {sideBtn('a', m.a)}
        <span style={{ alignSelf: 'center', color: '#9ca3af', fontWeight: 700, fontSize: 12 }}>vs</span>
        {sideBtn('b', m.b)}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={score}
          onChange={(e) => setScore(e.target.value)}
          placeholder="Score e.g. 6-4, 3-6, 10-7"
          style={{
            flex: '2 1 180px',
            padding: '10px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontSize: 15,
            color: '#111827',
            background: '#fff',
          }}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          style={{
            flex: '1 1 110px',
            padding: '10px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontSize: 15,
            color: '#111827',
            background: '#fff',
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={state === 'saving'}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#1d4ed8',
            color: '#fff',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Update' : 'Submit'}
        </button>
      </div>
      {state === 'saved' && !err && (
        <div style={{ color: '#15803d', fontSize: 13, marginTop: 8 }}>
          {'✓'} Saved — {m.a} vs {m.b}. Update anytime if it changes.
        </div>
      )}
      {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
