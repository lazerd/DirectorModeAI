'use client';

import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Save, User, Mail, Building2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Profile = {
  full_name: string | null;
  email: string | null;
  organization_name: string | null;
  timezone: string | null;
};

export default function MixerSettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
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
    </div>
  );
}
