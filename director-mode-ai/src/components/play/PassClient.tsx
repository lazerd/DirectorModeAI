'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Loader2 } from 'lucide-react';
import { C, PlayHeader, getClub, getHostId, peekPending, setClub } from './shared';
import Paywall, { type PaywallInfo } from './Paywall';

type Status = {
  pass: { kind: 'host' | 'club'; club_code: string | null; club_name: string | null; ends_at: string | null } | null;
  freeUsed: boolean;
  prices: { host: number; club: number };
  checkout: { host: string | null; club: string | null } | null;
};

/** Where LemonSqueezy returns after checkout, and "my hosting" for anyone. */
export default function PassClient() {
  const [st, setSt] = useState<Status | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPending(peekPending());
    const id = getHostId();
    let tries = 0, stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(`/api/p/pass?host_id=${id}&club=${getClub()}`, { cache: 'no-store' });
        const j = (await r.json()) as Status;
        setSt(j);
        if (j.pass) { if (j.pass.club_code) setClub(j.pass.club_code); setWaiting(false); return; }
      } catch { /* retry */ }
      // just back from checkout: the webhook can take a few seconds
      if (++tries < 40 && new URLSearchParams(location.search).has('paid')) setTimeout(tick, 3000);
      else setWaiting(false);
    };
    tick();
    return () => { stop = true; };
  }, []);

  const clubLink = st?.pass?.club_code ? `${location.origin}/play?club=${st.pass.club_code}` : '';
  return (
    <div className="min-h-screen pb-16" style={{ background: C.paper, color: C.ink }}>
      <PlayHeader />
      <main className="mx-auto w-full max-w-xl px-5 pt-4">
        {!st || (waiting && !st.pass) ? (
          <div className="mt-16 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin" /><p className="mt-3">Confirming your pass…</p></div>
        ) : st.pass ? (
          <section className="rounded-3xl p-6 shadow-sm" style={{ background: C.lime }}>
            <Check className="h-8 w-8" />
            <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-tight">{st.pass.kind === 'club' ? `${st.pass.club_name ?? 'Your club'} is on Racquets IRL.` : 'You’re a host. Go fill some courts.'}</h1>
            <p className="mt-2 text-[15px]">{st.pass.kind === 'club' ? 'Send this link to your members. Anyone who opens it can host games and socials, free.' : 'Unlimited games and socials, all year, on this phone.'}</p>
            {clubLink && (
              <button onClick={async () => { await navigator.clipboard?.writeText(clubLink); setCopied(true); }} className="mt-4 flex w-full items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 text-left text-[14px]">
                <span className="truncate">{clubLink.replace(/^https?:\/\//, '')}</span>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            )}
            <Link href={pending ? '/play/new?resume=1' : '/play/new'} className="mt-4 flex h-14 items-center justify-center rounded-2xl text-[17px] font-semibold text-white" style={{ background: C.ink }}>
              {pending ? 'Post my game now' : 'Host a game'}
            </Link>
          </section>
        ) : (
          <Paywall info={{ prices: st.prices, host: st.checkout?.host ?? null, club: st.checkout?.club ?? null } as PaywallInfo}
            title={st.freeUsed ? 'You’ve used your free event.' : 'Your first event is free. After that:'} />
        )}
        {st && !st.pass && <Restore onDone={() => location.reload()} />}
      </main>
    </div>
  );
}

/** Bought a pass on another phone: email code → this phone hosts too. */
function Restore({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const post = async (body: Record<string, string>) => {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/p/pass/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, hostId: getHostId() }) });
      return (await r.json()) as { ok?: boolean; sent?: boolean; error?: string };
    } finally { setBusy(false); }
  };
  return (
    <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm">
      <div className="text-[16px] font-semibold">Already have a pass on another phone?</div>
      {step === 'email' ? (
        <form className="mt-2 flex gap-2" onSubmit={async (x) => { x.preventDefault(); const j = await post({ email }); if (j.sent) setStep('code'); else setMsg(j.error || 'No active pass for that email.'); }}>
          <input type="email" required value={email} onChange={(x) => setEmail(x.target.value)} placeholder="Email you bought it with" aria-label="Email" className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2.5 text-[16px] outline-none" style={{ borderColor: C.line }} />
          <button disabled={busy} className="rounded-xl px-4 font-semibold text-white disabled:opacity-60" style={{ background: C.ink }}>Send code</button>
        </form>
      ) : (
        <form className="mt-2 flex gap-2" onSubmit={async (x) => { x.preventDefault(); const j = await post({ email, code }); if (j.ok) onDone(); else setMsg('That code didn’t work. Check the email and try again.'); }}>
          <input inputMode="numeric" required value={code} onChange={(x) => setCode(x.target.value)} placeholder="6-digit code" aria-label="Code" className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2.5 text-[16px] tracking-[4px] outline-none" style={{ borderColor: C.line }} />
          <button disabled={busy} className="rounded-xl px-4 font-semibold" style={{ background: C.lime, color: C.ink }}>Move it here</button>
        </form>
      )}
      {step === 'code' && <p className="mt-2 text-[13px]" style={{ color: C.muted }}>If {email} has a pass, we just emailed it a code. It works for 15 minutes.</p>}
      {msg && <p className="mt-2 text-[13px] text-[#9c3a25]">{msg}</p>}
    </section>
  );
}
