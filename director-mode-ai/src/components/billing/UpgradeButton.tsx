'use client';

import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PRO_PRICE_USD } from '@/config/pricing';

/**
 * The real Pro purchase path. POSTs to /api/billing/checkout with a subscription
 * price key and sends the user to the hosted LemonSqueezy checkout.
 *
 * The annual button is gone. It advertised "$290/yr" — a price that no longer
 * exists — and sent `pro_annual`, whose buy link resolves to null, so clicking
 * it could only ever produce a failed checkout. The price is read from
 * src/config/pricing.ts so this can't drift from /pricing again.
 */
export default function UpgradeButton({
  changePlan = false,
}: {
  changePlan?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  const go = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceKey: 'pro_monthly' }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) {
        throw new Error(json.message || json.error || 'Could not start checkout');
      }
      window.location.href = json.url;
    } catch (err: any) {
      toast.error(err?.message || 'Could not start checkout. Please try again.');
      setLoading(false);
    }
  };

  return (
    <button
      onClick={go}
      disabled={loading}
      className="px-4 py-2 rounded-lg bg-yellow-300 text-[#001820] hover:bg-yellow-200 font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-60"
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <>
          {changePlan ? 'Switch to monthly' : `Go Pro — $${PRO_PRICE_USD}/mo`}
          <ArrowRight size={14} />
        </>
      )}
    </button>
  );
}
