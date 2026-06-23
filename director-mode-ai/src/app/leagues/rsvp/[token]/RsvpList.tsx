'use client';
import { useState } from 'react';

export type RsvpMatch = {
  matchup_id: string;
  date: string;
  start_time: string | null;
  home: boolean;
  opponent: string;
  cancelled: boolean;
  status: 'yes' | 'no' | null;
};

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const fmtTime = (t: string | null) => {
  if (!t) return '';
  const [h, mi] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am'; const h12 = ((h + 11) % 12) + 1;
  return ` · ${h12}${mi ? ':' + String(mi).padStart(2, '0') : ''}${ap}`;
};

export default function RsvpList({ token, playerName, leagueName, clubName, divisionName, matches }: {
  token: string; playerName: string; leagueName: string; clubName: string; divisionName: string; matches: RsvpMatch[];
}) {
  return (
    <main style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', maxWidth: 560, margin: '0 auto', padding: '28px 16px 90px', color: '#1f2937' }}>
      <div style={{ background: 'linear-gradient(135deg,#1F4FA0,#163670)', color: '#fff', borderRadius: 16, padding: '22px 24px' }}>
        <div style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', opacity: 0.85 }}>{leagueName}</div>
        <h1 style={{ fontSize: 25, margin: '6px 0 2px' }}>{playerName}</h1>
        <div style={{ fontSize: 15, opacity: 0.92 }}>{clubName} · {divisionName}</div>
      </div>

      <p style={{ color: '#6b7280', marginTop: 18, lineHeight: 1.5 }}>
        Tap <strong>Yes</strong> or <strong>No</strong> for each match date. You can change it anytime — just reopen this link. We'll email the team a confirmation before each match.
      </p>

      {matches.length === 0 && <p style={{ color: '#6b7280', marginTop: 20 }}>No matches scheduled yet — check back soon.</p>}

      <div style={{ marginTop: 12 }}>
        {matches.map((m) => <Row key={m.matchup_id} token={token} m={m} />)}
      </div>

      <p style={{ color: '#9ca3af', fontSize: 12.5, marginTop: 24, textAlign: 'center' }}>Bookmark this page to update availability all season.</p>
    </main>
  );
}

function Row({ token, m }: { token: string; m: RsvpMatch }) {
  const [status, setStatus] = useState<'yes' | 'no' | null>(m.status);
  const [saving, setSaving] = useState<'yes' | 'no' | null>(null);

  async function set(next: 'yes' | 'no') {
    if (m.cancelled) return;
    setSaving(next);
    const res = await fetch(`/api/leagues/rsvp/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchup_id: m.matchup_id, status: next }),
    });
    setSaving(null);
    if (res.ok) setStatus(next);
  }

  const btn = (val: 'yes' | 'no', label: string, color: string, bg: string) => (
    <button type="button" disabled={m.cancelled || saving !== null} onClick={() => set(val)}
      style={{
        flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 15, fontWeight: 700, cursor: m.cancelled ? 'default' : 'pointer',
        border: status === val ? `2px solid ${color}` : '1px solid #d1d5db',
        background: status === val ? bg : '#fff', color: status === val ? color : '#6b7280',
      }}>
      {saving === val ? '…' : (status === val ? '✓ ' : '') + label}
    </button>
  );

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 13, marginBottom: 10, background: m.cancelled ? '#f9fafb' : '#fff', opacity: m.cancelled ? 0.6 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtDate(m.date)}<span style={{ color: '#9ca3af', fontWeight: 500 }}>{fmtTime(m.start_time)}</span></div>
        <div style={{ fontSize: 13.5, color: '#6b7280' }}>{m.home ? 'vs' : '@'} {m.opponent}{m.cancelled ? ' · cancelled' : ''}</div>
      </div>
      {m.cancelled ? (
        <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>This match was cancelled.</div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          {btn('yes', 'Yes', '#16a34a', '#dcfce7')}
          {btn('no', 'No', '#dc2626', '#fee2e2')}
        </div>
      )}
    </div>
  );
}
