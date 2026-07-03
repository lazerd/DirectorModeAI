'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, X, Loader2, ArrowRight } from 'lucide-react';

/**
 * Slim global banner for billing owners who aren't yet paying: nudges free
 * users and trial users toward Pro, with one-click checkout. Hidden for
 * members/coaches (they inherit the club plan), active subscribers, and guests.
 * Dismissible for the session.
 */
export default function TrialBanner() {
  const pathname = usePathname() || '';
  const [state, setState] = useState<null | { onTrial: boolean; days: number | null; tier: string }>(null);
  const [dismissed, setDismissed] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Don't show on marketing/auth/pricing pages.
    if (pathname === '/' || pathname.startsWith('/login') || pathname.startsWith('/register') || pathname.startsWith('/pricing') || pathname.startsWith('/join')) return;
    (async () => {
      try {
        const res = await fetch('/api/me/plan');
        const j = await res.json();
        if (!j.signedIn || !j.isBillingOwner) return; // members/guests: nothing
        if (j.subscriptionStatus === 'active' || j.subscriptionStatus === 'trialing') return; // paying
        if (j.effectiveTier === 'free' || j.onTrial) {
          setState({ onTrial: !!j.onTrial, days: j.trialDaysRemaining ?? null, tier: j.effectiveTier });
          setDismissed(sessionStorage.getItem('trialbanner-dismissed') === '1');
        }
      } catch { /* ignore */ }
    })();
  }, [pathname]);

  if (!state || dismissed) return null;

  const goPro = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/create-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priceKey: 'pro_monthly' }) });
      const j = await res.json();
      if (j.url) window.location.href = j.url; else setLoading(false);
    } catch { setLoading(false); }
  };

  const msg = state.onTrial
    ? `${state.days} day${state.days === 1 ? '' : 's'} left on your free Pro trial`
    : `You're on the Free plan`;

  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-[72px] z-[55] bg-[#002838] border-t border-yellow-300/30 px-4 py-2.5 flex items-center justify-center gap-3 text-sm">
      <Sparkles size={15} className="text-yellow-300 shrink-0" />
      <span className="text-white/80">{msg} — unlock everything for <b className="text-white">$29/mo</b>.</span>
      <button onClick={goPro} disabled={loading} className="px-3 py-1.5 rounded-lg bg-yellow-300 text-[#001820] font-semibold text-xs flex items-center gap-1.5 hover:bg-yellow-200 disabled:opacity-60 shrink-0">
        {loading ? <Loader2 size={13} className="animate-spin" /> : <>Go Pro <ArrowRight size={13} /></>}
      </button>
      <button onClick={() => { setDismissed(true); sessionStorage.setItem('trialbanner-dismissed', '1'); }} aria-label="Dismiss" className="text-white/40 hover:text-white shrink-0">
        <X size={16} />
      </button>
    </div>
  );
}
