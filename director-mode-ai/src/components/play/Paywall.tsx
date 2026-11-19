'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { C } from './shared';

export type PaywallInfo = { prices: { host: number; club: number }; host: string | null; club: string | null };

/** Shown when a device's free event is used. The draft is already saved; checkout returns to /play/pass. */
export default function Paywall({ info, title = 'You’ve used your free event.' }: { info: PaywallInfo; title?: string }) {
  const [club, setClubName] = useState('');
  const [going, setGoing] = useState('');
  const go = (kind: 'host' | 'club') => {
    let url = kind === 'host' ? info.host : info.club;
    if (!url) return;
    if (kind === 'club' && club.trim()) { const u = new URL(url); u.searchParams.set('checkout[custom][club_name]', club.trim().slice(0, 60)); url = u.toString(); }
    setGoing(kind);
    location.href = url;
  };
  const live = !!(info.host && info.club);
  return (
    <section className="rounded-3xl border-2 bg-white p-5" style={{ borderColor: C.ink, color: C.ink }}>
      <div className="text-[20px] font-semibold leading-tight">{title}</div>
      <p className="mt-1 text-[14px]" style={{ color: C.muted }}>Keep hosting all year for about $2 a month. Your game is saved and posts the moment you&apos;re done.</p>
      <div className="mt-4 grid gap-3">
        <button disabled={!live || !!going} onClick={() => go('host')} className="rounded-2xl p-4 text-left disabled:opacity-60" style={{ background: C.lime }}>
          <div className="flex items-baseline justify-between"><b className="text-[18px]">Host Pass</b><b className="text-[22px]">${info.prices.host}<span className="text-[13px] font-normal">/yr</span></b></div>
          <ul className="mt-2 grid gap-1 text-[14px]">
            {['Unlimited games and socials', 'Live courts, scores, recaps, King of the Court', 'Run it back every week'].map((x) => <li key={x} className="flex gap-2"><Check className="h-4 w-4 shrink-0" />{x}</li>)}
          </ul>
          {going === 'host' && <Loader2 className="mt-2 h-4 w-4 animate-spin" />}
        </button>
        <div className="rounded-2xl p-4" style={{ background: '#eef1e8' }}>
          <div className="flex items-baseline justify-between"><b className="text-[18px]">Club Pass</b><b className="text-[22px]">${info.prices.club}<span className="text-[13px] font-normal">/yr</span></b></div>
          <p className="mt-1 text-[14px]">Activate your players: every member can host, free. You get one link to send your club.</p>
          <div className="mt-3 flex gap-2">
            <input value={club} onChange={(e) => setClubName(e.target.value)} placeholder="Club name" aria-label="Club name" className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2.5 text-[16px] outline-none" style={{ borderColor: C.line }} />
            <button disabled={!live || !!going} onClick={() => go('club')} className="rounded-xl px-4 text-[15px] font-semibold text-white disabled:opacity-60" style={{ background: C.ink }}>
              {going === 'club' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Get it'}
            </button>
          </div>
        </div>
      </div>
      {!live && <p className="mt-3 text-[13px] text-[#9c3a25]">Passes open shortly. Your game is saved on this phone.</p>}
      <p className="mt-3 text-center text-[12px]" style={{ color: C.muted }}>Secure checkout by Lemon Squeezy. Cancel anytime.</p>
    </section>
  );
}
