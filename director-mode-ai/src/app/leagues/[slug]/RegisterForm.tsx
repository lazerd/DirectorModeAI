'use client';

import { useMemo, useState } from 'react';
import { Loader2, CheckCircle, AlertCircle, DollarSign } from 'lucide-react';
import type { CategoryKey } from '@/lib/leagueUtils';

type Category = {
  id: string;
  key: CategoryKey;
  label: string;
  feeCents: number;
  feeLabel: string;
};

type PaymentRails = {
  venmo: string | null;
  zelle: string | null;
  stripe: string | null;
};

type Props = {
  leagueSlug: string;
  leagueName: string;
  categories: Category[];
  paymentRails: PaymentRails;
};

const NTRP_OPTIONS = ['2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0'];

export default function RegisterForm({ leagueSlug, leagueName, categories, paymentRails }: Props) {
  const [selectedCategoryId, setSelectedCategoryId] = useState(categories[0]?.id || '');
  const [captainName, setCaptainName] = useState('');
  const [captainEmail, setCaptainEmail] = useState('');
  const [captainPhone, setCaptainPhone] = useState('');
  const [captainNtrp, setCaptainNtrp] = useState('');
  const [captainWtn, setCaptainWtn] = useState('');

  const [partnerName, setPartnerName] = useState('');
  const [partnerEmail, setPartnerEmail] = useState('');
  const [partnerPhone, setPartnerPhone] = useState('');
  const [partnerNtrp, setPartnerNtrp] = useState('');
  const [partnerWtn, setPartnerWtn] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ doubles: boolean } | null>(null);

  const selected = useMemo(
    () => categories.find(c => c.id === selectedCategoryId),
    [categories, selectedCategoryId]
  );
  const isDoubles = selected?.key === 'men_doubles' || selected?.key === 'women_doubles';

  const hasAnyPayment = !!(paymentRails.venmo || paymentRails.zelle || paymentRails.stripe);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selected) { setError('Please pick a category.'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/leagues/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueSlug,
          categoryKey: selected.key,
          captainName,
          captainEmail,
          captainPhone: captainPhone || null,
          captainNtrp: parseFloat(captainNtrp),
          captainWtn: captainWtn ? parseFloat(captainWtn) : null,
          partnerName: isDoubles ? partnerName : null,
          partnerEmail: isDoubles ? partnerEmail : null,
          partnerPhone: isDoubles ? partnerPhone || null : null,
          partnerNtrp: isDoubles ? parseFloat(partnerNtrp) : null,
          partnerWtn: isDoubles && partnerWtn ? parseFloat(partnerWtn) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSuccess({ doubles: isDoubles });
    } catch (err: any) {
      setError(err.message || 'Failed to submit entry');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <CheckCircle size={24} className="text-green-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-lg text-green-200">Entry received</h3>
            <p className="text-sm text-green-200/80 mt-1">
              {success.doubles
                ? `Your partner will receive a confirmation email shortly. Your spot is reserved until the director marks your payment as received.`
                : `Your spot is reserved until the director marks your payment as received.`}
            </p>
          </div>
        </div>

        {hasAnyPayment && selected && selected.feeCents > 0 && (
          <div className="mt-4 pt-4 border-t border-green-500/20">
            <div className="text-xs uppercase tracking-wide text-green-300/60 mb-2">Complete your payment</div>
            <PaymentInstructions
              amount={selected.feeLabel}
              leagueName={leagueName}
              payerName={captainName}
              rails={paymentRails}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Category picker */}
      <section className="bg-white/5 border border-white/10 rounded-xl p-4 sm:p-5">
        <h2 className="font-semibold text-base mb-3">Pick a category</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {categories.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategoryId(cat.id)}
              className={`text-left p-3 rounded-lg border transition-colors ${
                selectedCategoryId === cat.id
                  ? 'bg-[#D3FB52]/20 border-[#D3FB52]'
                  : 'bg-white/5 border-white/10 hover:border-white/30'
              }`}
            >
              <div className="font-medium text-sm">{cat.label}</div>
              <div className="text-xs text-white/50 mt-0.5">
                {cat.feeLabel}
                {cat.feeCents > 0 && (
                  <span className="text-white/30 ml-1">
                    / {cat.key === 'men_doubles' || cat.key === 'women_doubles' ? 'team' : 'player'}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Captain info */}
      <section className="bg-white/5 border border-white/10 rounded-xl p-4 sm:p-5">
        <h2 className="font-semibold text-base mb-3">Your info</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">Full name *</label>
            <input
              required
              value={captainName}
              onChange={e => setCaptainName(e.target.value)}
              className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
              placeholder="Jane Smith"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">Email *</label>
            <input
              required
              type="email"
              value={captainEmail}
              onChange={e => setCaptainEmail(e.target.value)}
              className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">Phone</label>
            <input
              type="tel"
              value={captainPhone}
              onChange={e => setCaptainPhone(e.target.value)}
              className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">NTRP *</label>
            <select
              required
              value={captainNtrp}
              onChange={e => setCaptainNtrp(e.target.value)}
              className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
            >
              <option value="" className="bg-[#002838]">Select...</option>
              {NTRP_OPTIONS.map(n => (
                <option key={n} value={n} className="bg-[#002838]">{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">WTN (optional)</label>
            <input
              type="number"
              step="0.1"
              min={1}
              max={40}
              value={captainWtn}
              onChange={e => setCaptainWtn(e.target.value)}
              className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
              placeholder="Find on your USTA account"
            />
          </div>
        </div>
        <p className="text-xs text-white/40 mt-3">
          UTR is auto-looked up from your name. Your composite seeding blends UTR + NTRP + WTN when available.
        </p>
      </section>

      {/* Partner info for doubles */}
      {isDoubles && (
        <section className="bg-white/5 border border-white/10 rounded-xl p-4 sm:p-5">
          <h2 className="font-semibold text-base mb-3">Partner info</h2>
          <p className="text-xs text-white/50 mb-3">
            Your partner will get an email to confirm the partnership.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">Partner name *</label>
              <input
                required
                value={partnerName}
                onChange={e => setPartnerName(e.target.value)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">Partner email *</label>
              <input
                required
                type="email"
                value={partnerEmail}
                onChange={e => setPartnerEmail(e.target.value)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">Partner phone</label>
              <input
                type="tel"
                value={partnerPhone}
                onChange={e => setPartnerPhone(e.target.value)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">Partner NTRP *</label>
              <select
                required
                value={partnerNtrp}
                onChange={e => setPartnerNtrp(e.target.value)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
              >
                <option value="" className="bg-[#002838]">Select...</option>
                {NTRP_OPTIONS.map(n => (
                  <option key={n} value={n} className="bg-[#002838]">{n}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">Partner WTN (optional)</label>
              <input
                type="number"
                step="0.1"
                min={1}
                max={40}
                value={partnerWtn}
                onChange={e => setPartnerWtn(e.target.value)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
              />
            </div>
          </div>
        </section>
      )}

      {/* Payment preview */}
      {selected && selected.feeCents > 0 && hasAnyPayment && (
        <section className="bg-white/5 border border-white/10 rounded-xl p-4 sm:p-5">
          <h2 className="font-semibold text-base mb-2 flex items-center gap-2">
            <DollarSign size={16} className="text-[#D3FB52]" />
            Payment — {selected.feeLabel}
          </h2>
          <p className="text-xs text-white/50 mb-3">
            Your entry will be reserved immediately. Pay using one of the methods below after you register —
            the director will mark you as paid once they receive it.
          </p>
          <PaymentInstructions
            amount={selected.feeLabel}
            leagueName={leagueName}
            payerName={captainName || 'Your name'}
            rails={paymentRails}
          />
        </section>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-200 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 bg-[#D3FB52] text-[#002838] font-semibold rounded-lg hover:bg-[#c5f035] disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 size={16} className="animate-spin" />}
        {submitting ? 'Submitting...' : 'Submit entry'}
      </button>
    </form>
  );
}

function PaymentInstructions({
  amount,
  leagueName,
  payerName,
  rails,
}: {
  amount: string;
  leagueName: string;
  payerName: string;
  rails: PaymentRails;
}) {
  const memo = `${leagueName} entry - ${payerName}`;
  return (
    <div className="space-y-2 text-sm">
      {rails.venmo && (
        <div className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
          <div>
            <div className="text-white/50 text-xs">Venmo</div>
            <div className="text-white font-mono">{rails.venmo}</div>
          </div>
          <a
            href={`https://venmo.com/u/${rails.venmo.replace(/^@/, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#D3FB52] hover:underline"
          >
            Open Venmo →
          </a>
        </div>
      )}
      {rails.zelle && (
        <div className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
          <div>
            <div className="text-white/50 text-xs">Zelle</div>
            <div className="text-white font-mono">{rails.zelle}</div>
          </div>
        </div>
      )}
      {rails.stripe && (
        <a
          href={rails.stripe}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-[#635BFF] hover:bg-[#5547ef] text-white font-medium text-center rounded-lg px-4 py-2.5"
        >
          Pay {amount} with card (Stripe)
        </a>
      )}
      <p className="text-xs text-white/40 pt-1">
        Memo / note suggestion: <span className="font-mono">{memo}</span>
      </p>
    </div>
  );
}
