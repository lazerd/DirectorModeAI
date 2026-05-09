'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Sparkles, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Billing = 'monthly' | 'annual';

export default function PricingPage() {
  const router = useRouter();
  const [billing, setBilling] = useState<Billing>('monthly');
  const [loading, setLoading] = useState<string | null>(null);

  async function startCheckout(priceKey: string) {
    setLoading(priceKey);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent('/pricing')}`);
      return;
    }
    const res = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceKey, mode: 'subscription' }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      setLoading(null);
      alert(data.message || 'Could not start checkout. Please try again.');
    }
  }

  const proKey = billing === 'monthly' ? 'pro_monthly' : 'pro_annual';
  const proPrice = billing === 'monthly' ? '$29' : '$290';
  const proSuffix = billing === 'monthly' ? '/mo' : '/yr';

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/[0.06] sticky top-0 z-30 bg-[#001820]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-yellow-300/20 flex items-center justify-center">
              <Sparkles size={16} className="text-yellow-300" />
            </div>
            <span className="font-display text-base">ClubMode</span>
          </Link>
          <Link href="/login" className="text-sm text-white/70 hover:text-white">Sign in</Link>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 pt-16 pb-8 text-center">
        <h1 className="font-display text-4xl md:text-5xl tracking-tight">
          Free for the basics. <span className="text-yellow-300">Pro</span> when it's go time.
        </h1>
        <p className="mt-4 text-white/60 max-w-xl mx-auto">
          Start free. Upgrade to Pro when you want the DJ Console for every event, SMS notifications, AI recommendations, custom branding, and unlimited everything.
        </p>

        <div className="mt-8 inline-flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-white/5">
          <button
            onClick={() => setBilling('monthly')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${billing === 'monthly' ? 'bg-white text-[#001820]' : 'text-white/60 hover:text-white'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling('annual')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${billing === 'annual' ? 'bg-white text-[#001820]' : 'text-white/60 hover:text-white'}`}
          >
            Annual <span className="text-emerald-400 ml-1">−17%</span>
          </button>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Free */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col">
            <div className="text-2xl font-display">Free</div>
            <div className="mt-1 text-sm text-white/50">Perfect for trying things out and small events.</div>
            <div className="mt-6 flex items-baseline gap-2">
              <div className="text-5xl font-display">$0</div>
            </div>
            <ul className="mt-6 space-y-2.5 flex-1">
              <Bullet>Unlimited events &amp; players</Bullet>
              <Bullet>Round robin and basic brackets</Bullet>
              <Bullet>Public leaderboards, QR codes, results cards</Bullet>
              <Bullet>Coach booking page</Bullet>
              <Bullet>25 emails per month</Bullet>
              <Bullet>5 photos per event, 25 player vault</Bullet>
              <Bullet><span className="text-yellow-300">DJ Console for 1 event, lifetime</span> — full feature, try it free</Bullet>
              <Bullet muted>SMS not included</Bullet>
              <Bullet muted>AI string recs use standard fallback</Bullet>
            </ul>
            <button
              onClick={() => router.push('/register')}
              className="mt-8 w-full py-3 rounded-xl font-medium bg-white/10 hover:bg-white/15 text-white flex items-center justify-center gap-2"
            >
              Sign up free <ArrowRight size={16} />
            </button>
          </div>

          {/* Pro */}
          <div className="relative rounded-2xl border border-yellow-300/40 bg-yellow-300/5 p-8 flex flex-col ring-2 ring-yellow-300/30">
            <div className="absolute -top-3 left-6 text-[10px] font-semibold tracking-wider uppercase bg-yellow-300 text-[#001820] px-3 py-1 rounded-full">
              Recommended
            </div>
            <div className="text-2xl font-display text-yellow-300">Pro</div>
            <div className="mt-1 text-sm text-white/50">Everything you need to run real events at a real club.</div>
            <div className="mt-6 flex items-baseline gap-2">
              <div className="text-5xl font-display">{proPrice}</div>
              <div className="text-white/40 text-sm">{proSuffix}</div>
            </div>
            {billing === 'annual' && (
              <div className="mt-1 text-emerald-400 text-xs font-medium">Save $58/year</div>
            )}
            <ul className="mt-6 space-y-2.5 flex-1">
              <Bullet>Everything in Free, plus:</Bullet>
              <Bullet><span className="text-yellow-300">DJ Console for unlimited events</span></Bullet>
              <Bullet>200 SMS per month included <span className="text-white/40 text-xs">($0.05 each overage)</span></Bullet>
              <Bullet>1,000 emails per month</Bullet>
              <Bullet>AI string recommendations (real, not fallback)</Bullet>
              <Bullet>Custom event branding (your club logo)</Bullet>
              <Bullet>Tournament bracket optimizer</Bullet>
              <Bullet>Multi-coach club management</Bullet>
              <Bullet>Custom subdomain (whitelabel)</Bullet>
              <Bullet>Multi-day tournaments &amp; advanced analytics</Bullet>
              <Bullet>Unlimited photos &amp; player vault</Bullet>
              <Bullet>Lesson reminder cron + CSV vault import</Bullet>
            </ul>
            <button
              onClick={() => startCheckout(proKey)}
              disabled={loading === proKey}
              className="mt-8 w-full py-3 rounded-xl font-medium bg-yellow-300 text-[#001820] hover:bg-yellow-200 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading === proKey ? 'Redirecting…' : 'Upgrade to Pro'}
              {loading !== proKey && <ArrowRight size={16} />}
            </button>
          </div>
        </div>

        {/* Day Pass */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-[#002838] p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex-1 min-w-[260px]">
            <div className="font-display text-xl">Day Pass — $9 per event</div>
            <div className="text-white/60 text-sm mt-1">
              Running just one event and don't want a subscription? Unlock Pro features (DJ Console, SMS, custom branding, AI) for one specific event.
            </div>
          </div>
          <div className="text-white/50 text-xs">
            Available from inside any event when you click a Pro feature.
          </div>
        </div>
      </section>
    </div>
  );
}

function Bullet({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <li className={`flex items-start gap-2 text-sm ${muted ? 'text-white/40' : 'text-white/80'}`}>
      <Check size={16} className={`mt-0.5 flex-shrink-0 ${muted ? 'text-white/20' : 'text-emerald-400'}`} />
      <span>{children}</span>
    </li>
  );
}
