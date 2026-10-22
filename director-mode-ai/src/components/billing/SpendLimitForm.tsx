'use client';

import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';

/**
 * The club owner's monthly spending limit (emails + texts + Ask Claude).
 *
 * mode="add-card": pick a limit (suggested $50), save it, then go to checkout.
 * mode="edit":     change or raise the limit in place; raising it sends any
 *                  emails that were waiting on it.
 */
export default function SpendLimitForm({
  mode,
  initialDollars,
  checkoutUrl,
  onSaved,
}: {
  mode: 'add-card' | 'edit';
  initialDollars: number | null;
  checkoutUrl?: string | null;
  onSaved?: (limitDollars: number | null) => void;
}) {
  const [value, setValue] = useState(initialDollars === null ? '' : String(initialDollars));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const trimmed = value.trim();
      const res = await fetch('/api/billing/limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limitDollars: trimmed === '' ? null : Number(trimmed) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not save the limit.');
        setBusy(false);
        return;
      }
      const dollars = trimmed === '' ? null : Number(trimmed);
      onSaved?.(dollars);
      if (mode === 'add-card' && checkoutUrl) {
        window.location.href = checkoutUrl;
        return;
      }
      setSaved(true);
      setBusy(false);
    } catch {
      setError('Could not save the limit.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm text-white/70">
        Monthly spending limit
        <div className="mt-1 flex items-center gap-2">
          <span className="text-white/60">$</span>
          <input
            type="number"
            min={0}
            step={5}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="No limit"
            className="w-28 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white focus:border-yellow-300/50 focus:outline-none"
          />
          <span className="text-xs text-white/40">a month, emails + texts + Ask Claude</span>
        </div>
      </label>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-yellow-300 px-4 py-2 text-sm font-semibold text-[#001820] hover:bg-yellow-200 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'add-card' ? <CreditCard className="h-4 w-4" /> : null}
          {mode === 'add-card' ? 'Save limit and add a card' : 'Save limit'}
        </button>
        {saved && <span className="text-sm text-emerald-300">Saved. Anything waiting is going out now.</span>}
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <p className="text-xs text-white/40">
        When your club reaches it, emails wait and texts and Ask Claude pause until the 1st, or until you raise it here.
      </p>
    </div>
  );
}
