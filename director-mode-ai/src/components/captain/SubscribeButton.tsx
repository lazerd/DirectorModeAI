'use client';

import { useState } from 'react';

/**
 * Starts a LemonSqueezy hosted checkout for CaptainMode.
 *
 * The price key sent here is only a hint — /api/billing/checkout re-resolves
 * the rate server-side from the club's Pro status, so a tampered request can't
 * buy the $10 plan without a qualifying club.
 */
export default function SubscribeButton({
  priceKey,
  clubId,
  price,
}: {
  priceKey: 'captain_club' | 'captain_solo';
  clubId: string | null;
  price: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceKey, clubId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) {
        setError(
          j.error === 'price_not_configured'
            ? 'Checkout isn’t configured yet — the CaptainMode product needs a LemonSqueezy buy link.'
            : j.message || j.error || 'Could not start checkout.',
        );
        return;
      }
      window.location.href = j.url as string;
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        onClick={start}
        disabled={busy}
        className="px-5 py-3 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
      >
        {busy ? 'Starting checkout…' : `Subscribe — $${price}/month`}
      </button>
      <p className="text-white/30 text-xs mt-3">Cancel any time.</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
