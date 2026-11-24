'use client';

import { useState } from 'react';
import { C, PlayHeader } from './shared';
import type { AuthorizeParams } from '@/lib/play/mcpAuth';

/** Email → 6-digit code → back to Claude / ChatGPT. */
export default function AuthorizeClient({ params, clientName, problem }: { params: AuthorizeParams; clientName: string; problem: string | null }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const post = async (path: string, body: object) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ params, ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error_description ?? 'Something went wrong. Try again.'); return null; }
      return j;
    } catch { setErr('No connection. Try again.'); return null; } finally { setBusy(false); }
  };
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (await post('/api/oauth/send-code', { email })) setSent(true); };
  const approve = async (e: React.FormEvent) => {
    e.preventDefault();
    const j = await post('/api/oauth/approve', { email, code });
    if (j?.redirect) { setBusy(true); window.location.href = j.redirect; }
  };

  const input = 'mt-2 w-full rounded-xl px-4 py-3 text-[17px] outline-none';
  const button = 'mt-4 h-12 w-full rounded-xl text-[16px] font-semibold disabled:opacity-60';
  return (
    <div className="min-h-screen" style={{ background: C.paper, color: C.ink }}>
      <PlayHeader />
      <main className="mx-auto w-full max-w-md px-5 pb-16">
        {problem ? (
          <>
            <h1 className="mt-6 text-[28px] font-semibold leading-tight">Couldn’t connect</h1>
            <p className="mt-3 text-[16px]" style={{ color: C.muted }}>{problem}</p>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-[30px] font-semibold leading-[1.1] tracking-tight">Connect Racquets IRL to {clientName}</h1>
            <p className="mt-3 text-[16px] leading-relaxed" style={{ color: C.muted }}>
              Sign in once with your email so {clientName} can create and run your games. Your players never need this: they just tap the game link.
            </p>
            <section className="mt-6 rounded-3xl p-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              {!sent ? (
                <form onSubmit={send}>
                  <label className="text-[14px] font-semibold" htmlFor="email">Your email</label>
                  <input id="email" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    className={input} style={{ background: '#eef1e8' }} placeholder="you@example.com" />
                  <button disabled={busy} className={button} style={{ background: C.lime, color: C.ink }}>{busy ? 'Sending…' : 'Email me a code'}</button>
                </form>
              ) : (
                <form onSubmit={approve}>
                  <label className="text-[14px] font-semibold" htmlFor="code">The 6-digit code we sent to {email}</label>
                  <input id="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={7} value={code} onChange={(e) => setCode(e.target.value)}
                    className={`${input} tracking-[0.4em]`} style={{ background: '#eef1e8' }} placeholder="123456" />
                  <button disabled={busy} className={button} style={{ background: C.lime, color: C.ink }}>{busy ? 'Connecting…' : `Connect ${clientName}`}</button>
                  <button type="button" onClick={() => { setSent(false); setCode(''); setErr(null); }} className="mt-3 w-full text-[14px] underline underline-offset-4" style={{ color: C.muted }}>
                    Use a different email or send a new code
                  </button>
                </form>
              )}
              {err && <p className="mt-3 text-[14px] font-medium" style={{ color: '#b42318' }}>{err}</p>}
            </section>
            <p className="mt-4 text-[12px] leading-relaxed" style={{ color: C.muted }}>
              {clientName} will be able to create, change and run games you organize. No password, and we never email your players from this. <a className="underline" href="/privacy">Privacy</a>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
