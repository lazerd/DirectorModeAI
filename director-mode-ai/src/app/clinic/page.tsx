'use client';

/**
 * clubmode.ai/clinic: say "I'm in" (or "can't make it") for one clinic date.
 * Reached from a reminder / spots-left email (?t=signed link) or a link the club posts
 * (?p=<class>&d=<date>). One confirm tap; nothing is saved just by opening the page.
 */
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Info = {
  club: string; title: string; coach: string | null; day: string; time: string;
  spots: number | null; spotsLeft: number | null; inCount: number;
  me: { name: string; email: string; status: 'in' | 'out' | null } | null;
};

function ClinicInner() {
  const sp = useSearchParams();
  const t = sp.get('t'), p = sp.get('p'), d = sp.get('d');
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'in' | 'out' | null>(null);

  const q = t ? `t=${encodeURIComponent(t)}` : `p=${encodeURIComponent(p || '')}&d=${encodeURIComponent(d || '')}`;
  useEffect(() => {
    fetch(`/api/clinic?${q}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) setErr(j.error || 'Something went wrong.'); else setInfo(j);
    }).catch(() => setErr('Something went wrong.'));
  }, [q]);

  async function answer(status: 'in' | 'out') {
    setBusy(true); setErr('');
    const body = t ? { t, status } : { p, d, name, email, status };
    const r = await fetch('/api/clinic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || "Couldn't save that."); return; }
    setDone(status);
    setInfo((i) => (i ? { ...i, spotsLeft: j.spotsLeft ?? i.spotsLeft } : i));
  }

  const card: React.CSSProperties = { maxWidth: 460, margin: '48px auto', background: '#FFFDF8', border: '2px solid #D7F25A', borderRadius: 22, padding: 26, fontFamily: 'system-ui, sans-serif', color: '#17301F' };
  const yes: React.CSSProperties = { background: '#1F4D3A', color: '#fff', border: 0, borderRadius: 999, padding: '14px 22px', fontWeight: 800, fontSize: 16, cursor: 'pointer', width: '100%' };
  const no: React.CSSProperties = { background: 'none', border: 0, color: '#5A6657', textDecoration: 'underline', cursor: 'pointer', marginTop: 12, fontSize: 14 };
  const input: React.CSSProperties = { width: '100%', border: '1.5px solid #E2D8C4', borderRadius: 12, padding: '12px 14px', fontSize: 16, marginBottom: 10, boxSizing: 'border-box' };

  if (err && !info) return <main style={card}><p>{err}</p></main>;
  if (!info) return <main style={card}><p>Loading…</p></main>;
  const full = info.spotsLeft === 0 && info.me?.status !== 'in';
  const status = done ?? info.me?.status ?? null;

  return (
    <main style={{ background: '#F4EEE2', minHeight: '100vh', padding: 12 }}>
      <section style={card}>
        <p style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, color: '#5A6657', margin: 0 }}>{info.club}</p>
        <h1 style={{ fontSize: 26, margin: '6px 0 4px' }}>{info.title}</h1>
        <p style={{ margin: '0 0 4px', fontSize: 17 }}><strong>{info.day}</strong> · {info.time}</p>
        {info.coach && <p style={{ margin: 0, color: '#5A6657' }}>with {info.coach}</p>}
        <p style={{ margin: '14px 0 18px', fontWeight: 700, color: info.spotsLeft === 0 ? '#9a3412' : '#1E7A3C' }}>
          {info.spotsLeft == null ? `${info.inCount} in so far` : info.spotsLeft === 0 ? 'Full' : `${info.spotsLeft} of ${info.spots} spots left`}
        </p>

        {status === 'in' ? (
          <>
            <p style={{ fontSize: 18, fontWeight: 800 }}>You're in. See you on the court!</p>
            <button style={no} disabled={busy} onClick={() => answer('out')}>Can't make it after all</button>
          </>
        ) : status === 'out' ? (
          <>
            <p style={{ fontSize: 17 }}>Got it, you're out for this one.</p>
            {!full && <button style={yes} disabled={busy} onClick={() => answer('in')}>Actually, count me in</button>}
          </>
        ) : full ? (
          <p>This one is full. Watch for the next date!</p>
        ) : (
          <>
            {!info.me && (
              <>
                <input style={input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                <input style={input} placeholder="Your email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </>
            )}
            <button style={yes} disabled={busy} onClick={() => answer('in')}>{info.me ? `Count me in, ${info.me.name.split(' ')[0]}` : 'Count me in'}</button>
            {info.me && <button style={no} disabled={busy} onClick={() => answer('out')}>Can't make this one</button>}
          </>
        )}
        {err && <p style={{ color: '#9a3412', marginTop: 12 }}>{err}</p>}
      </section>
    </main>
  );
}

export default function ClinicPage() {
  return <Suspense fallback={null}><ClinicInner /></Suspense>;
}
