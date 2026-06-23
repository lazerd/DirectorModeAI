'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const wrap: React.CSSProperties = { fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', maxWidth: 520, margin: '0 auto', padding: '32px 18px 80px', color: '#1f2937' };
const input: React.CSSProperties = { width: '100%', padding: '11px 13px', border: '1px solid #d1d5db', borderRadius: 9, fontSize: 16, color: '#111827', background: '#fff', marginTop: 5 };
const label: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#374151', marginTop: 16, display: 'block' };

export default function JoinForm({ token, leagueName, clubName, divisionName }: { token: string; leagueName: string; clubName: string; divisionName: string }) {
  const router = useRouter();
  const [f, setF] = useState({ player_name: '', parent_name: '', parent_email: '', parent_phone: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    setErr('');
    if (!f.player_name.trim()) return setErr("Enter the player's name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.parent_email)) return setErr('Enter a valid parent email.');
    setBusy(true);
    const res = await fetch(`/api/leagues/join/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && j.player_token) router.push(`/leagues/rsvp/${j.player_token}`);
    else setErr(j.error || 'Something went wrong — try again.');
  }

  return (
    <main style={wrap}>
      <div style={{ background: 'linear-gradient(135deg,#1F4FA0,#163670)', color: '#fff', borderRadius: 16, padding: '22px 24px' }}>
        <div style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', opacity: 0.85 }}>{leagueName}</div>
        <h1 style={{ fontSize: 26, margin: '6px 0 2px' }}>Join {clubName}</h1>
        <div style={{ fontSize: 15, opacity: 0.92 }}>{divisionName} team signup</div>
      </div>

      <p style={{ color: '#6b7280', marginTop: 18, lineHeight: 1.5 }}>
        Register your player below. On the next screen you'll mark which match dates they're available, and you can update it anytime.
      </p>

      <label style={label}>Player's name *</label>
      <input style={input} value={f.player_name} onChange={set('player_name')} placeholder="First &amp; last name" />
      <label style={label}>Parent / guardian name</label>
      <input style={input} value={f.parent_name} onChange={set('parent_name')} placeholder="Your name" />
      <label style={label}>Parent email *</label>
      <input style={input} value={f.parent_email} onChange={set('parent_email')} placeholder="you@email.com" type="email" />
      <label style={label}>Parent phone</label>
      <input style={input} value={f.parent_phone} onChange={set('parent_phone')} placeholder="(555) 123-4567" type="tel" />

      {err && <div style={{ color: '#dc2626', fontSize: 14, marginTop: 14 }}>{err}</div>}

      <button type="button" onClick={submit} disabled={busy}
        style={{ width: '100%', marginTop: 22, padding: '14px', borderRadius: 10, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: 17, cursor: 'pointer' }}>
        {busy ? 'Registering…' : 'Register & set availability →'}
      </button>
    </main>
  );
}
