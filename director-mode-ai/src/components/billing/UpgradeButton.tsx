'use client';

import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The real Pro purchase path. POSTs to /api/billing/checkout with a
 * subscription price key and sends the user to Stripe Checkout. Replaces the
 * old dead-end "Upgrade" link that only went to /pricing.
 */
export default function UpgradeButton({
  changePlan = false,
}: {
  changePlan?: boolean;
}) {
  const [loading, setLoading] = useState<'pro_monthly' | 'pro_annual' | null>(null);

  const go = async (priceKey: 'pro_monthly' | 'pro_annual') => {
    setLoading(priceKey);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceKey }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) {
        throw new Error(json.message || json.error || 'Could not start checkout');
      }
      window.location.href = json.url;
    } catch (err: any) {
      toast.error(err?.message || 'Could not start checkout. Please try again.');
      setLoading(null);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <button
        onClick={() => go('pro_monthly')}
        disabled={loading !== null}
        className="px-4 py-2 rounded-lg bg-yellow-300 text-[#001820] hover:bg-yellow-200 font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {loading === 'pro_monthly' ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <>
            {changePlan ? 'Switch to monthly' : 'Go Pro — $29/mo'}
            <ArrowRight size={14} />
          </>
        )}
      </button>
      <button
        onClick={() => go('pro_annual')}
        disabled={loading !== null}
        className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {loading === 'pro_annual' ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <>Annual — $290/yr</>
        )}
      </button>
    </div>
  );
}
