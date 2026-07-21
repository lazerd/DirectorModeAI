'use client';

import { useState } from 'react';
import { RefreshCw, X, Loader2, CheckCircle2 } from 'lucide-react';

type Result = {
  marked_paid: number;
  matched_payments?: number;
  total_entries: number;
  unresolved: { division: string; player: string; draw: string }[];
  extra_payments: { division: string; email: string; name: string | null }[];
};

/**
 * "Sync payments from Square" — reconciles every entry in this hub against
 * completed Square payments (match by buyer email + division), marking confident
 * matches paid. Only shown for hub events (Square line items are per-division
 * across the whole hub). Reports who's still unresolved + extra payments.
 */
export default function SquareSyncButton({ hubSlug, eventName }: { hubSlug: string | null; eventName: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!hubSlug) return null; // needs a hub to scope the reconcile

  const run = async () => {
    setBusy(true);
    setErr(null);
    setRes(null);
    setOpen(true);
    try {
      const r = await fetch(`/api/tournaments/hub/${hubSlug}/reconcile`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setRes(d);
    } catch (e: any) {
      setErr(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="relative inline-block flex-shrink-0">
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold disabled:opacity-60"
        title="Sync entry payment status from Square"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        Sync payments
      </button>

      {open && (res || err) && (
        <div className="absolute z-30 mt-1 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-left">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold text-gray-900">Square reconciliation</div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700">
              <X size={14} />
            </button>
          </div>
          {err ? (
            <div className="text-xs text-red-600">{err}</div>
          ) : res ? (
            <div className="space-y-2 text-sm" style={{ color: '#111827' }}>
              <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                <CheckCircle2 size={14} /> Marked {res.marked_paid} paid · {res.total_entries} entries total
              </div>
              {typeof res.matched_payments === 'number' && (
                <div className="text-xs text-gray-600">{res.matched_payments} Square payment{res.matched_payments === 1 ? '' : 's'} matched to players</div>
              )}
              {res.unresolved.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">Still unpaid ({res.unresolved.length})</div>
                  <ul className="mt-0.5 max-h-32 overflow-y-auto text-xs text-gray-700">
                    {res.unresolved.map((u, i) => (
                      <li key={i}>• {u.player} <span className="text-gray-400">({u.division})</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {res.extra_payments.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Extra payments — no player matched ({res.extra_payments.length})</div>
                  <ul className="mt-0.5 max-h-28 overflow-y-auto text-xs text-gray-600">
                    {res.extra_payments.map((x, i) => (
                      <li key={i}>• {x.email || '(no email)'} <span className="text-gray-400">({x.division})</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {res.unresolved.length === 0 && res.extra_payments.length === 0 && (
                <div className="text-xs text-emerald-700">Everyone reconciled cleanly. ✅</div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </span>
  );
}
