'use client';

/**
 * clubmode.ai/ for anyone without a code (Darrin, 11/25/26): "members only, super
 * exclusive, nobody else gets to see what's happening." Almost nothing on the page on
 * purpose: the room behind the glass, one line, one box for a code, and a way in for
 * members who already have an account.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MembersGate() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/members/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { router.refresh(); return; }
      setErr(j.error || 'That code is not recognized.');
      setShake(true); setTimeout(() => setShake(false), 500);
    } catch {
      setErr('Something went wrong. Try again.');
    }
    setBusy(false);
  }

  return (
    <main className="mg">
      <style>{CSS}</style>
      <div className="mg-bg" aria-hidden="true" />
      <div className="mg-veil" aria-hidden="true" />
      <div className="mg-card">
        <div className="mg-crest" aria-hidden="true">CM</div>
        <div className="mg-word">CLUBMODE</div>
        <h1 className="mg-h">Members only.</h1>
        <p className="mg-p">A private club for the people who run racquet clubs. By invitation.</p>
        <form onSubmit={enter} className={`mg-form${shake ? ' mg-shake' : ''}`}>
          <label htmlFor="mg-code" className="mg-sr">Member code</label>
          <input
            id="mg-code" className="mg-in" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Member code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={32}
          />
          <button className="mg-go" disabled={busy || !code.trim()} aria-label="Enter">{busy ? '…' : 'Enter'}</button>
        </form>
        <p className="mg-err" role="status">{err}</p>
        <a className="mg-link" href="/login">Members, sign in</a>
      </div>
      <footer className="mg-foot">
        <a href="https://racquetsirl.com">Looking for a game? Racquets IRL</a>
        <span aria-hidden="true">·</span>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </footer>
    </main>
  );
}

const CSS = `
.mg{position:relative;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;background:#05100c;color:#f1ead9;font-family:Archivo,system-ui,sans-serif;padding:24px}
.mg-bg{position:absolute;inset:-40px;background:url(/proshop/scene-night.jpg) center/cover no-repeat;filter:blur(14px) saturate(.8) brightness(.55);transform:scale(1.08);animation:mg-drift 40s ease-in-out infinite alternate}
.mg-veil{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(5,16,12,.35) 0%,rgba(5,16,12,.88) 70%,#05100c 100%)}
@keyframes mg-drift{from{transform:scale(1.08) translate(0,0)}to{transform:scale(1.14) translate(-1.5%,-1%)}}
.mg-card{position:relative;width:min(420px,100%);text-align:center;padding:44px 30px 30px;border:1px solid rgba(214,190,130,.28);border-radius:22px;background:rgba(8,20,15,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 30px 80px rgba(0,0,0,.5)}
.mg-crest{width:58px;height:58px;margin:0 auto 18px;border-radius:50%;border:1.5px solid #c9ac6a;color:#d9bd7c;display:grid;place-items:center;font:600 18px/1 Georgia,'Times New Roman',serif;letter-spacing:.06em}
.mg-word{font-size:12px;letter-spacing:.42em;color:#c9ac6a;margin-bottom:22px;padding-left:.42em}
.mg-h{font:400 40px/1.1 Georgia,'Times New Roman',serif;margin:0 0 10px;color:#f6efdf}
.mg-p{margin:0 0 26px;color:rgba(241,234,217,.66);font-size:15px;line-height:1.5}
.mg-form{display:flex;gap:8px}
.mg-in{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(214,190,130,.35);border-radius:12px;padding:14px 14px;color:#f6efdf;font:600 16px Archivo,system-ui;letter-spacing:.18em;text-align:center;outline:none}
.mg-in::placeholder{color:rgba(241,234,217,.35);letter-spacing:.08em;font-weight:500}
.mg-in:focus{border-color:#d9bd7c;box-shadow:0 0 0 3px rgba(217,189,124,.18)}
.mg-go{border:0;border-radius:12px;padding:0 20px;background:#d9bd7c;color:#14100a;font:700 15px Archivo,system-ui;cursor:pointer}
.mg-go:disabled{opacity:.45;cursor:default}
.mg-err{min-height:20px;margin:10px 0 6px;color:#e9a3a3;font-size:14px}
.mg-link{color:rgba(241,234,217,.7);font-size:14px;text-decoration:none;border-bottom:1px solid rgba(214,190,130,.35);padding-bottom:2px}
.mg-link:hover{color:#f6efdf}
.mg-foot{position:absolute;bottom:18px;left:0;right:0;display:flex;gap:14px;justify-content:center;flex-wrap:wrap;font-size:12px;color:rgba(241,234,217,.4)}
.mg-foot a{color:rgba(241,234,217,.45);text-decoration:none}.mg-foot a:hover{color:#f1ead9}
.mg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.mg-shake{animation:mg-shake .45s}
@keyframes mg-shake{20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}
@media (prefers-reduced-motion:reduce){.mg-bg{animation:none}.mg-shake{animation:none}}
`;
