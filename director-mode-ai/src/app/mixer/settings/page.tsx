'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Settings as SettingsIcon,
  Save,
  User,
  Mail,
  Building2,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Profile = {
  full_name: string | null;
  email: string | null;
  organization_name: string | null;
  timezone: string | null;
};

type StripeStatus = {
  stripe_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};

export default function MixerSettingsPage() {
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stripe, setStripe] = useState<StripeStatus | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('full_name, email, organization_name, timezone')
        .eq('id', user.id)
        .single();
      setProfile(data ?? { full_name: '', email: user.email ?? '', organization_name: '', timezone: 'America/New_York' });
      setLoading(false);
    })();
  }, []);

  // Fetch Stripe Connect status (and refresh when returning from Stripe).
  useEffect(() => {
    const refresh = async () => {
      try {
        const res = await fetch('/api/stripe/connect/status');
        if (res.ok) setStripe(await res.json());
      } catch {
        /* swallow */
      }
    };
    refresh();
    if (searchParams.get('stripe_return') === '1') {
      // Slight delay so Stripe's account propagation completes
      setTimeout(refresh, 1500);
    }
  }, [searchParams]);

  const startStripeConnect = async () => {
    setStripeLoading(true);
    try {
      const res = await fetch('/api/stripe/connect/start', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Could not start Stripe onboarding.');
        setStripeLoading(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Stripe error');
      setStripeLoading(false);
    }
  };

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Not signed in.');
      setSaving(false);
      return;
    }
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        full_name: profile.full_name,
        organization_name: profile.organization_name,
        timezone: profile.timezone,
      })
      .eq('id', user.id);

    if (updateErr) {
      setError(updateErr.message);
    } else {
      setSavedAt(Date.now());
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
          <SettingsIcon size={22} />
        </div>
        <div>
          <h1 className="font-semibold text-2xl sm:text-3xl text-gray-900">Settings</h1>
          <p className="text-gray-500">Manage your MixerMode account</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">
            <span className="inline-flex items-center gap-1.5"><User size={14} /> Full name</span>
          </label>
          <input
            type="text"
            value={profile?.full_name ?? ''}
            onChange={(e) => setProfile(p => p ? { ...p, full_name: e.target.value } : p)}
            className="w-full px-3 py-2 border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder="Your name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">
            <span className="inline-flex items-center gap-1.5"><Mail size={14} /> Email</span>
          </label>
          <input
            type="email"
            value={profile?.email ?? ''}
            disabled
            className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-500"
          />
          <p className="text-xs text-gray-400 mt-1">Email is managed in your account.</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">
            <span className="inline-flex items-center gap-1.5"><Building2 size={14} /> Club / organization</span>
          </label>
          <input
            type="text"
            value={profile?.organization_name ?? ''}
            onChange={(e) => setProfile(p => p ? { ...p, organization_name: e.target.value } : p)}
            className="w-full px-3 py-2 border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder="My Tennis Club"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">Timezone</label>
          <select
            value={profile?.timezone ?? 'America/New_York'}
            onChange={(e) => setProfile(p => p ? { ...p, timezone: e.target.value } : p)}
            className="w-full px-3 py-2 border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="America/New_York">Eastern (New York)</option>
            <option value="America/Chicago">Central (Chicago)</option>
            <option value="America/Denver">Mountain (Denver)</option>
            <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
            <option value="America/Phoenix">Arizona (Phoenix)</option>
          </select>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {savedAt && (
            <span className="text-sm text-green-600">Saved.</span>
          )}
        </div>
      </div>

      {/* Stripe Connect — Payouts */}
      <div className="bg-white rounded-xl border p-6 mt-6 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard size={18} className="text-emerald-600" />
          <h2 className="font-semibold text-lg text-gray-900">Payouts (Stripe)</h2>
        </div>
        <p className="text-sm text-gray-600">
          Connect your Stripe account to accept entry fees for paid Quads tournaments. Money
          goes directly to your account; CoachMode never holds funds.
        </p>

        {!stripe?.stripe_account_id && (
          <button
            onClick={startStripeConnect}
            disabled={stripeLoading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            <ExternalLink size={16} />
            {stripeLoading ? 'Opening Stripe…' : 'Connect Stripe'}
          </button>
        )}

        {stripe?.stripe_account_id && stripe.charges_enabled && stripe.payouts_enabled && (
          <div className="flex items-start gap-2 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3">
            <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Stripe connected and ready.</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                Account ID: {stripe.stripe_account_id}
              </p>
            </div>
          </div>
        )}

        {stripe?.stripe_account_id && (!stripe.charges_enabled || !stripe.payouts_enabled) && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
              <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Stripe onboarding incomplete.</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Charges enabled: {stripe.charges_enabled ? 'yes' : 'no'} · Payouts enabled:{' '}
                  {stripe.payouts_enabled ? 'yes' : 'no'} · Details submitted:{' '}
                  {stripe.details_submitted ? 'yes' : 'no'}
                </p>
              </div>
            </div>
            <button
              onClick={startStripeConnect}
              disabled={stripeLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              <ExternalLink size={16} />
              {stripeLoading ? 'Opening Stripe…' : 'Continue Stripe onboarding'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
