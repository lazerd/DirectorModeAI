'use client';

/**
 * clubmode.ai/text: connect your phone to your staff.
 * Two ways: real text messages (tick the consent box, then text the JOIN code from
 * your phone) or Telegram (one tap opens the bot already linked). After that the staff
 * text a morning huddle and an evening recap, and answer anything you send.
 */
import { useCallback, useEffect, useState } from 'react';

type LineOut = { channel: 'sms' | 'telegram'; status: 'pending' | 'active' | 'stopped'; to: string | null; morning: boolean; evening: boolean; otherClub: boolean };
type State = { club: string; smsNumber: string; telegram: string | null; consent: string; lines: LineOut[] };

const C = { bg: '#F4EEE2', card: '#FFFDF8', ink: '#17301F', mute: '#5A6657', line: '#E2D8C4', green: '#1F4D3A', ball: '#D7F25A' };
const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 20, marginBottom: 16 };
const btn: React.CSSProperties = { display: 'inline-block', background: C.green, color: '#fff', border: 0, borderRadius: 999, padding: '12px 20px', fontWeight: 800, cursor: 'pointer', textDecoration: 'none', fontSize: 16 };
const ghost: React.CSSProperties = { background: 'none', border: `1px solid ${C.line}`, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', color: C.ink, fontWeight: 700 };

export default function TextPage() {
  const [s, setS] = useState<State | null>(null);
  const [signin, setSignin] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [join, setJoin] = useState<{ channel: 'sms' | 'telegram'; code: string; href: string } | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/text/link', { cache: 'no-store' });
    if (r.status === 401) { setSignin(true); return; }
    const j = await r.json();
    if (!r.ok) { setErr(j.error || 'Could not load.'); return; }
    setS(j);
  }, []);
  useEffect(() => { load(); }, [load]);
  // While a code is out, look for the phone to connect.
  useEffect(() => {
    if (!join) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [join, load]);

  const line = (ch: 'sms' | 'telegram') => s?.lines.find((l) => l.channel === ch);
  const active = (ch: 'sms' | 'telegram') => line(ch)?.status === 'active' && !!line(ch)?.to;
  useEffect(() => { if (join && active(join.channel)) setJoin(null); }); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(channel: 'sms' | 'telegram') {
    setErr('');
    const r = await fetch('/api/text/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel, agreed }) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error || 'Could not start.'); return; }
    setJoin({ channel, code: j.code, href: j.href });
    if (channel === 'telegram') window.open(j.href, '_blank');
  }
  async function patch(channel: string, body: Record<string, unknown>) {
    await fetch('/api/text/link', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel, ...body }) });
    load();
  }
  async function disconnect(channel: string) {
    await fetch(`/api/text/link?channel=${channel}`, { method: 'DELETE' });
    load();
  }

  const wrap = (kids: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: 'Nunito, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 18px 60px' }}>
        <h1 style={{ fontSize: 30, fontWeight: 900, margin: '0 0 6px' }}>Your staff, by text</h1>
        <p style={{ color: C.mute, margin: '0 0 22px', fontSize: 16 }}>
          Every morning your staff texts you what needs you. Reply with a number, then YES. Text them anything, any time.
        </p>
        {kids}
      </div>
    </div>
  );

  if (signin) return wrap(<div style={card}><p style={{ marginTop: 0 }}>Sign in to ClubMode to connect your phone.</p><a style={btn} href="/login?next=/text">Sign in</a></div>);
  if (!s) return wrap(<p style={{ color: C.mute }}>{err || 'Loading…'}</p>);

  const lineCard = (ch: 'sms' | 'telegram', l: LineOut) => (
    <div style={card} key={ch}>
      <div style={{ fontWeight: 900, fontSize: 18 }}>{ch === 'sms' ? 'Text messages' : 'Telegram'}: connected</div>
      <p style={{ color: C.mute, margin: '4px 0 12px' }}>
        {s.club} staff → {l.to}
        {l.otherClub ? ' (a different club than the one you have open now)' : ''}
      </p>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <input type="checkbox" checked={l.morning} onChange={(e) => patch(ch, { morning: e.target.checked })} /> Morning huddle, 7am
      </label>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <input type="checkbox" checked={l.evening} onChange={(e) => patch(ch, { evening: e.target.checked })} /> Evening recap, 6pm (only when something happened)
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {l.otherClub && <button style={ghost} onClick={() => patch(ch, { club: 'this' })}>Use {s.club} instead</button>}
        <button style={ghost} onClick={() => disconnect(ch)}>Disconnect</button>
      </div>
    </div>
  );

  return wrap(
    <>
      {err && <p style={{ color: '#B23B3B', fontWeight: 700 }}>{err}</p>}

      {active('sms') ? lineCard('sms', line('sms')!) : (
        <div style={card}>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>Text messages</div>
          {join?.channel === 'sms' ? (
            <>
              <p style={{ margin: '0 0 12px' }}>From your phone, text <b>JOIN {join.code}</b> to <b>{s.smsNumber}</b>.</p>
              <a style={btn} href={join.href}>Open my texts</a>
              <p style={{ color: C.mute, fontSize: 14, margin: '12px 0 0' }}>On a computer? Type it into your phone. This page updates once it connects. The code works for 30 minutes.</p>
            </>
          ) : (
            <>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '6px 0 14px', fontSize: 14, color: C.mute, lineHeight: 1.45 }}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
                <span>{s.consent} <a href="/sms" style={{ color: C.green }}>Details</a> · <a href="/privacy" style={{ color: C.green }}>Privacy</a> · <a href="/terms" style={{ color: C.green }}>Terms</a></span>
              </label>
              <button style={{ ...btn, opacity: agreed ? 1 : 0.45 }} disabled={!agreed} onClick={() => start('sms')}>Connect my phone</button>
            </>
          )}
        </div>
      )}

      {s.telegram && (active('telegram') ? lineCard('telegram', line('telegram')!) : (
        <div style={card}>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>Telegram</div>
          <p style={{ color: C.mute, margin: '0 0 12px' }}>Same staff, in the free Telegram app. Works on any phone.</p>
          {join?.channel === 'telegram' ? (
            <>
              <a style={btn} href={join.href} target="_blank" rel="noreferrer">Open Telegram</a>
              <p style={{ color: C.mute, fontSize: 14, margin: '12px 0 0' }}>Tap Start in Telegram. This page updates once it connects.</p>
            </>
          ) : (
            <button style={btn} onClick={() => start('telegram')}>Connect Telegram</button>
          )}
        </div>
      ))}

      <div style={{ ...card, background: 'transparent' }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>What to text</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: C.mute, lineHeight: 1.7 }}>
          <li>MENU: what needs you right now</li>
          <li>1, 2, 3…: open an item from the huddle, then YES or SKIP</li>
          <li>Anything: &ldquo;remind everyone for Friday&rsquo;s clinic&rdquo;</li>
          <li>QUIET / LOUD: scheduled texts off / on</li>
        </ul>
      </div>
    </>,
  );
}
