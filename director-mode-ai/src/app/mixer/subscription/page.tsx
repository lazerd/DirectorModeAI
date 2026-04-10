'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Check, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Profile = {
  billing_status: string | null;
  trial_ends_at: string | null;
};

export default function MixerSubscriptionPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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
        .select('billing_status, trial_ends_at')
        .eq('id', user.id)
        .single();
      setProfile(data ?? null);
      setLoading(false);
    })();
  }, []);

  const status = profile?.billing_status ?? 'trial';
  const trialEnds = profile?.trial_ends_at
    ? new Date(profile.trial_ends_at)
    : null;

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="font-semibold text-2xl sm:text-3xl mb-1 text-gray-900">Subscription</h1>
        <p className="text-gray-500">Manage your MixerMode plan and billing</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border p-6 mb-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
                  <CreditCard size={22} />
                </div>
                <div>
                  <div className="text-sm text-gray-500">Current plan</div>
                  <div className="text-lg font-semibold capitalize text-gray-900">
                    {status === 'trial' ? 'Free trial' : status}
                  </div>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                status === 'active' ? 'bg-green-100 text-green-700'
                : status === 'trial' ? 'bg-orange-100 text-orange-700'
                : 'bg-gray-100 text-gray-700'
              }`}>
                {status}
              </span>
            </div>
            {trialEnds && status === 'trial' && (
              <p className="text-sm text-gray-600">
                Your trial ends on {trialEnds.toLocaleDateString('en-US')}.
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={20} className="text-orange-500" />
              <h2 className="text-lg font-semibold text-gray-900">MixerMode Pro</h2>
            </div>
            <ul className="space-y-2 mb-6">
              {[
                'Unlimited events and players',
                'Round robin and tournament brackets',
                'AI-powered match generation',
                'Email + SMS notifications',
                'Priority support',
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-sm text-gray-700">
                  <Check size={16} className="text-green-500" />
                  {feature}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="px-5 py-2.5 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
              disabled
            >
              Upgrade (coming soon)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
