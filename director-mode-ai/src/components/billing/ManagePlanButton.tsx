'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

export default function ManagePlanButton() {
  const [loading, setLoading] = useState(false);
  async function openPortal() {
    setLoading(true);
    const res = await fetch('/api/stripe/portal', { method: 'POST' });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      setLoading(false);
      alert(data.message || 'Could not open billing portal.');
    }
  }
  return (
    <button
      onClick={openPortal}
      disabled={loading}
      className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm flex items-center gap-2 disabled:opacity-50"
    >
      {loading ? 'Opening…' : 'Manage billing'}
      <ExternalLink size={14} />
    </button>
  );
}
