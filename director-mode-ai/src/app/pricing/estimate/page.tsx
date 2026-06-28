'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Sparkles, ArrowLeft, Plus, Minus, Gauge, Eye, EyeOff } from 'lucide-react';

/**
 * Usage estimator for ClubMode AI's metered ("taxi meter") pricing.
 *
 * Clubs pay only for the AI actions they actually use. This page lets a
 * director (or the owner, in Owner view) plug in how often each kind of
 * action happens and see the estimated monthly cost — no fixed subscription.
 *
 * Per-action PRICE (what the club pays) and per-action COST (our raw Claude
 * cost) live in Owner view so prospects see a clean estimate, while the owner
 * can tune the numbers and watch the margin.
 */

type Activity = {
  key: string;
  label: string;
  hint: string;
  perMonth: number;
};

// Defaults describe a "typical" club. They sum to ~120 actions/month, which at
// the default $0.22/action lands near the ~$26/month headline.
const DEFAULT_ACTIVITIES: Activity[] = [
  { key: 'scores', label: 'Logging match & league scores', hint: 'JTT lines, results, standings', perMonth: 40 },
  { key: 'lessons', label: 'Booking & managing lessons', hint: 'scheduling, reschedules, reminders', perMonth: 30 },
  { key: 'lookups', label: 'Member questions & lookups', hint: 'rosters, schedules, "who\'s playing"', perMonth: 20 },
  { key: 'stringing', label: 'Stringing orders', hint: 'intake, status, pickup', perMonth: 15 },
  { key: 'mixers', label: 'Scheduling mixers & events', hint: 'setup, lineups, blasts', perMonth: 8 },
  { key: 'admin', label: 'Board report & admin', hint: 'monthly report, NPS, exports', perMonth: 7 },
];

// Multipliers for the quick club-size presets.
const PRESETS: { key: string; label: string; factor: number }[] = [
  { key: 'small', label: 'Small club', factor: 0.5 },
  { key: 'typical', label: 'Typical club', factor: 1 },
  { key: 'large', label: 'Large club', factor: 2 },
];

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const usd0 = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function EstimatePage() {
  const [activities, setActivities] = useState<Activity[]>(DEFAULT_ACTIVITIES);
  const [ownerView, setOwnerView] = useState(false);

  // Owner-tunable assumptions.
  const [pricePerAction, setPricePerAction] = useState(0.22); // what the club pays
  const [costPerAction, setCostPerAction] = useState(0.03); // our raw Claude cost

  const totalActions = useMemo(
    () => activities.reduce((sum, a) => sum + Math.max(0, Math.round(a.perMonth)), 0),
    [activities],
  );

  const clubPays = totalActions * pricePerAction;
  const ourCost = totalActions * costPerAction;
  const profit = clubPays - ourCost;
  const margin = clubPays > 0 ? (profit / clubPays) * 100 : 0;

  function setCount(key: string, value: number) {
    setActivities((prev) => prev.map((a) => (a.key === key ? { ...a, perMonth: Math.max(0, value) } : a)));
  }

  function applyPreset(factor: number) {
    setActivities(DEFAULT_ACTIVITIES.map((a) => ({ ...a, perMonth: Math.round(a.perMonth * factor) })));
  }

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      {/* Header */}
      <header className="border-b border-white/[0.06] sticky top-0 z-30 bg-[#001820]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-yellow-300/20 flex items-center justify-center">
              <Sparkles size={16} className="text-yellow-300" />
            </div>
            <span className="font-display text-base">ClubMode</span>
          </Link>
          <Link href="/pricing" className="text-sm text-white/70 hover:text-white flex items-center gap-1.5">
            <ArrowLeft size={14} /> Pricing
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-14 pb-6 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-yellow-300/90 bg-yellow-300/10 border border-yellow-300/20 rounded-full px-3 py-1">
          <Gauge size={13} /> Pay only for what you use
        </div>
        <h1 className="mt-5 font-display text-4xl md:text-5xl tracking-tight">
          What will ClubMode cost <span className="text-yellow-300">your club?</span>
        </h1>
        <p className="mt-4 text-white/60 max-w-xl mx-auto">
          No fixed subscription. You talk to ClubMode in plain English and it does the work — and you only
          pay for the actions it actually runs. Set how busy your club is and see the estimate.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-20">
        {/* Presets */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          <span className="text-sm text-white/40 mr-1">Quick start:</span>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.factor)}
              className="px-4 py-2 rounded-xl text-sm font-medium border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Activity breakdown */}
          <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="text-sm font-medium text-white/80 mb-1">How often does each happen?</div>
            <div className="text-xs text-white/40 mb-5">Per month. Adjust to match your club — these are typical numbers.</div>

            <div className="divide-y divide-white/[0.06]">
              {activities.map((a) => (
                <div key={a.key} className="py-3.5 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white/90 truncate">{a.label}</div>
                    <div className="text-xs text-white/40 truncate">{a.hint}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      aria-label={`Fewer ${a.label}`}
                      onClick={() => setCount(a.key, Math.max(0, Math.round(a.perMonth) - 5))}
                      className="w-8 h-8 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={a.perMonth}
                      onChange={(e) => setCount(a.key, Number(e.target.value))}
                      className="w-16 text-center bg-white/5 border border-white/10 rounded-lg py-1.5 text-sm focus:outline-none focus:border-yellow-300/40"
                    />
                    <button
                      aria-label={`More ${a.label}`}
                      onClick={() => setCount(a.key, Math.round(a.perMonth) + 5)}
                      className="w-8 h-8 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between">
              <span className="text-sm text-white/60">Total AI actions / month</span>
              <span className="font-display text-2xl">{totalActions.toLocaleString('en-US')}</span>
            </div>
          </div>

          {/* Result */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-yellow-300/40 bg-yellow-300/5 ring-2 ring-yellow-300/30 p-7 sticky top-24">
              <div className="text-sm text-white/60">Estimated monthly cost</div>
              <div className="mt-1 font-display text-5xl text-yellow-300">{usd(clubPays)}</div>
              <div className="mt-2 text-xs text-white/50">
                {totalActions.toLocaleString('en-US')} actions × {usd(pricePerAction)} each. A typical club lands
                around <span className="text-white/80">{usd0(26)}/mo</span>.
              </div>

              <div className="mt-5 rounded-xl bg-white/5 border border-white/10 p-4 text-xs text-white/60 leading-relaxed">
                Quiet month? You pay less. Busy summer? You pay a bit more. There&apos;s never a bill for AI work
                you didn&apos;t use.
              </div>

              {/* Owner view toggle */}
              <button
                onClick={() => setOwnerView((v) => !v)}
                className="mt-5 w-full text-xs text-white/40 hover:text-white/70 flex items-center justify-center gap-1.5"
              >
                {ownerView ? <EyeOff size={13} /> : <Eye size={13} />}
                {ownerView ? 'Hide owner view' : 'Owner view'}
              </button>

              {ownerView && (
                <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
                  <Tunable
                    label="Price per action (club pays)"
                    value={pricePerAction}
                    min={0.05}
                    max={0.5}
                    step={0.01}
                    onChange={setPricePerAction}
                  />
                  <Tunable
                    label="Our cost per action (Claude)"
                    value={costPerAction}
                    min={0.005}
                    max={0.15}
                    step={0.005}
                    onChange={setCostPerAction}
                  />

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <Stat label="Club pays" value={usd(clubPays)} />
                    <Stat label="Our cost" value={usd(ourCost)} />
                    <Stat label="Profit" value={usd(profit)} accent />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/50">Gross margin</span>
                    <span className="text-emerald-400 font-medium">{margin.toFixed(0)}%</span>
                  </div>
                  <p className="text-[11px] text-white/30 leading-relaxed">
                    Internal only — don&apos;t show prospects. Cost is an estimate of raw Claude usage and varies
                    by how much page data each action sends. Price it well above worst-case cost so heavy
                    actions stay inside the margin.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-white/30 max-w-2xl mx-auto">
          Estimate only, based on typical usage. Your real bill is always your actual usage for the month.
        </p>
      </section>
    </div>
  );
}

function Tunable({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-white/60">{label}</span>
        <span className="text-xs font-medium text-white/90">{usd(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-yellow-300"
      />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 p-2.5 text-center">
      <div className="text-[10px] text-white/40 uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${accent ? 'text-emerald-400' : 'text-white/90'}`}>{value}</div>
    </div>
  );
}
