'use client';

import { useState, useEffect } from 'react';
import { Settings, User, Mail, Bell, Save } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    display_name: '',
    reply_to_email: '',
    default_location: '',
    notification_enabled: true,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: coach } = await supabase
      .from('lesson_coaches')
      .select('*')
      .eq('profile_id', user.id)
      .single();

    if (coach) {
      setSettings({
        display_name: coach.display_name || user.email?.split('@')[0] || '',
        reply_to_email: user.email || '',
        default_location: '',
        notification_enabled: true,
      });
    }
    setLoading(false);
  };

  const saveSettings = async () => {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('lesson_coaches')
      .update({ display_name: settings.display_name })
      .eq('profile_id', user.id);

    setSaving(false);
    alert('Settings saved!');
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="font-semibold text-2xl">Settings</h1>
        <p className="text-gray-500 text-sm">Manage your Last Minute Lesson preferences</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Profile Settings */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-3 mb-4">
            <User size={20} className="text-blue-600" />
            <h2 className="font-semibold text-lg">Profile</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={settings.display_name}
                onChange={(e) => setSettings({ ...settings, display_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Coach John"
              />
              <p className="text-xs text-gray-500 mt-1">This name will appear in your email blasts</p>
            </div>
          </div>
        </div>

        {/* Email Settings */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-3 mb-4">
            <Mail size={20} className="text-green-600" />
            <h2 className="font-semibold text-lg">Email Settings</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reply-to Email
              </label>
              <input
                type="email"
                value={settings.reply_to_email}
                disabled
                className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-500"
              />
              <p className="text-xs text-gray-500 mt-1">Clients will reply to this email address</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Location
              </label>
              <input
                type="text"
                value={settings.default_location}
                onChange={(e) => setSettings({ ...settings, default_location: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Court 1, Tennis Club"
              />
              <p className="text-xs text-gray-500 mt-1">Pre-fill this location when adding new slots</p>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-3 mb-4">
            <Bell size={20} className="text-orange-500" />
            <h2 className="font-semibold text-lg">Notifications</h2>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Email confirmations</p>
              <p className="text-sm text-gray-500">Receive a copy when blasts are sent</p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, notification_enabled: !settings.notification_enabled })}
              className={`w-12 h-6 rounded-full transition-colors ${
                settings.notification_enabled ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                settings.notification_enabled ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={saveSettings}
          disabled={saving}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
              Saving...
            </>
          ) : (
            <>
              <Save size={20} />
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  );
}
