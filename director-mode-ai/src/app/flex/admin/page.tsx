'use client';
import { useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

type DivisionState = {
  id: string;
  name: string;
  matchesTotal: number;
  matchesCompleted: number;
  playablePending: number;
  behind: { name: string; played: number; outstanding: number }[];
};
type FlexState = {
  divisions: DivisionState[];
  totalPlayers: number;
  totalMatchesCompleted: number;
  totalPlayablePending: number;
};
type Round = { n: number; label: string; start: string; end: string };

const card: React.CSSProperties = { background: '#fff', border: '1px solid #DCE1EA', borderRadius: 14, padding: '20px 22px', boxShadow: '0 6px 18px rgba(16,38,80,.07)' };

export default function FlexAdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [state, setState] = useState<FlexState | null>(null);
  const [round, setRound] = useState<Round | null>(null);

  // Always require a password entry this session — the admin token store is
  // in-memory per serverless instance, so we can't trust a cookie across
  // instances. We keep the typed password in state and send it as X-Admin-Key.
  useEffect(() => {
    setAuthed(false);
  }, []);

  useEffect(() => {
    if (authed) loadStatus();
  }, [authed]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (r.ok) setAuthed(true);
    else alert('Wrong password');
  }
  async function loadStatus() {
    const r = await fetch('/api/flex/status', { headers: { 'X-Admin-Key': pw } });
    if (r.ok) {
      const d = await r.json();
      setState(d.state);
      setRound(d.round);
    }
  }

  if (authed === null) return <Shell><p>Loading…</p></Shell>;
  if (!authed)
    return (
      <Shell>
        <form onSubmit={login} style={{ ...card, maxWidth: 360, margin: '40px auto' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>Flex League Admin</h2>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Admin password"
            style={{ width: '100%', padding: '11px 12px', border: '1px solid #cbd5e1', borderRadius: 8, color: '#0f172a', fontSize: 15 }} />
          <button type="submit" style={{ marginTop: 12, width: '100%', padding: '11px', background: '#1F4FA0', color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Enter</button>
        </form>
      </Shell>
    );

  return (
    <Shell>
      {round && (
        <p style={{ color: '#475569', fontSize: 14, marginTop: 0 }}>
          Current window: <strong>{round.label}</strong> (through {new Date(round.end + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })})
        </p>
      )}

      {state && (
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 6 }}>
            <Stat n={state.totalPlayers} label="players" />
            <Stat n={state.totalMatchesCompleted} label="matches played" />
            <Stat n={state.totalPlayablePending} label="ready but unplayed" />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 10 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                <th style={{ padding: '6px 8px 6px 0' }}>Division</th>
                <th style={{ padding: '6px 8px', textAlign: 'center' }}>Played</th>
                <th style={{ padding: '6px 8px', textAlign: 'center' }}>Ready & waiting</th>
                <th style={{ padding: '6px 8px' }}>Behind</th>
              </tr>
            </thead>
            <tbody>
              {state.divisions.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid #eef1f6' }}>
                  <td style={{ padding: '8px 8px 8px 0', fontWeight: 700 }}>{d.name}</td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>{d.matchesCompleted}/{d.matchesTotal}</td>
                  <td style={{ padding: '8px', textAlign: 'center', color: d.playablePending ? '#c2410c' : '#16a34a', fontWeight: 700 }}>{d.playablePending}</td>
                  <td style={{ padding: '8px', color: '#475569', fontSize: 13 }}>{d.behind.slice(0, 6).map((b) => `${b.name} (${b.played}/4)`).join(', ') || '—'}{d.behind.length > 6 ? ` +${d.behind.length - 6} more` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <ActionCard
          kind="update"
          adminKey={pw}
          title="📣 Mid-Summer Update"
          desc="One warm status email to every player — where the season stands, standings are live, and a reminder they can play ahead. Goes to all players."
          confirmVerb="Send the mid-summer update to ALL players"
        />
        <ActionCard
          kind="nudge"
          adminKey={pw}
          title="🎾 Gentle Nudge"
          desc="Personalized reminder to only the players who still have matches ready to play — lists each outstanding opponent + their contact info. Reusable any week to stay on track."
          confirmVerb="Send the gentle nudge to players who owe matches"
        />
      </div>
    </Shell>
  );
}

function ActionCard({ kind, adminKey, title, desc, confirmVerb }: { kind: 'update' | 'nudge'; adminKey: string; title: string; desc: string; confirmVerb: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; subject?: string; sampleHtml?: string; recipients: unknown[] } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function call(mode: 'preview' | 'test' | 'live') {
    if (mode === 'live' && !confirm(`${confirmVerb}?\n\nThis sends real emails and cannot be undone.`)) return;
    setBusy(mode);
    setResult(null);
    try {
      const r = await fetch('/api/flex/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey }, body: JSON.stringify({ kind, mode }) });
      const d = await r.json();
      if (mode === 'preview') setPreview(d);
      else if (mode === 'test') setResult(d?.result?.sent ? `Test sent to darrinjco@gmail.com${d.sampleFor ? ` (sample for ${d.sampleFor})` : ''}.` : `Test: ${JSON.stringify(d)}`);
      else setResult(`Sent ${d.sent}/${d.attempted}.${d.failures?.length ? ` Skipped/failed: ${d.failures.length}` : ''}`);
    } catch (e) {
      setResult('Error: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const btn = (bg: string): React.CSSProperties => ({ padding: '9px 14px', background: bg, color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: busy ? 0.6 : 1 });

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>{title}</h3>
      <p style={{ color: '#475569', fontSize: 14, marginTop: 0 }}>{desc}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button disabled={!!busy} onClick={() => call('preview')} style={btn('#64748b')}>{busy === 'preview' ? '…' : 'Preview'}</button>
        <button disabled={!!busy} onClick={() => call('test')} style={btn('#0C7B8C')}>{busy === 'test' ? '…' : 'Send test to me'}</button>
        <button disabled={!!busy} onClick={() => call('live')} style={btn('#16a34a')}>{busy === 'live' ? 'Sending…' : 'Send to all'}</button>
      </div>
      {result && <p style={{ marginTop: 12, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 14, color: '#166534' }}>{result}</p>}
      {preview && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 14, color: '#0f172a', margin: '0 0 6px' }}>
            <strong>{preview.count}</strong> recipient{preview.count === 1 ? '' : 's'}{preview.subject ? ` · Subject: “${preview.subject}”` : ''}
          </p>
          {preview.sampleHtml ? (
            <iframe title="preview" srcDoc={preview.sampleHtml} style={{ width: '100%', height: 460, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }} />
          ) : (
            <p style={{ fontSize: 14, color: '#64748b' }}>No recipients right now — nobody owes a playable match. 🎉</p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#1F4FA0', lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', background: '#ECEFF4', minHeight: '100vh', padding: '28px 16px 80px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>Summer Flex League — Director Tools</h1>
        {children}
      </div>
    </main>
  );
}
