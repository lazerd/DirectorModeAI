'use client';

import { useState } from 'react';

export default function DayPassButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false);

  async function go() {
    setLoading(true);
    const res = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceKey: 'day_pass', mode: 'one-time', eventId }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else {
      setLoading(false);
      alert(data.message || 'Could not start checkout.');
    }
  }

  return (
    <button
      onClick={go}
      disabled={loading}
      className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium disabled:opacity-50"
    >
      {loading ? 'Redirecting…' : 'Or unlock just this event for $9'}
    </button>
  );
}
