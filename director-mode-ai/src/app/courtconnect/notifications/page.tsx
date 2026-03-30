'use client';

import { useState, useEffect } from 'react';
import { Bell, Check, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type NotificationPref = {
  event_invites: boolean;
  event_reminders: boolean;
  waitlist_updates: boolean;
  organizer_messages: boolean;
  club_announcements: boolean;
};

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export default function NotificationsPage() {
  const [prefs, setPrefs] = useState<NotificationPref>({
    event_invites: true,
    event_reminders: true,
    waitlist_updates: true,
    organizer_messages: true,
    club_announcements: true,
  });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [activeTab, setActiveTab] = useState<'inbox' | 'settings'>('inbox');

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Fetch preferences
    const { data: prefData } = await supabase
      .from('cc_notification_preferences')
      .select('*')
      .eq('profile_id', user.id)
      .single();

    if (prefData) {
      setPrefs({
        event_invites: prefData.event_invites,
        event_reminders: prefData.event_reminders,
        waitlist_updates: prefData.waitlist_updates,
        organizer_messages: prefData.organizer_messages,
        club_announcements: prefData.club_announcements,
      });
    }

    // Fetch notifications
    const { data: notifData } = await supabase
      .from('cc_notifications')
      .select('*')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (notifData) setNotifications(notifData);
    setLoading(false);
  };

  const updatePref = async (key: keyof NotificationPref, value: boolean) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
    setSavingPrefs(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingPrefs(false); return; }

    const updated = { ...prefs, [key]: value };

    await supabase
      .from('cc_notification_preferences')
      .upsert({
        profile_id: user.id,
        ...updated,
      }, { onConflict: 'profile_id' });

    setSavingPrefs(false);
  };

  const markRead = async (id: string) => {
    const supabase = createClient();
    await supabase.from('cc_notifications').update({ read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('cc_notifications').update({ read: true }).eq('profile_id', user.id).eq('read', false);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const deleteNotification = async (id: string) => {
    const supabase = createClient();
    await supabase.from('cc_notifications').delete().eq('id', id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      event_invite: 'Invite',
      event_reminder: 'Reminder',
      rsvp_update: 'RSVP',
      waitlist_promotion: 'Waitlist',
      message: 'Message',
      club_join: 'Club',
      general: 'General',
    };
    return map[type] || type;
  };

  const typeColor = (type: string) => {
    const map: Record<string, string> = {
      event_invite: 'bg-emerald-400/10 text-emerald-400',
      event_reminder: 'bg-blue-400/10 text-blue-400',
      rsvp_update: 'bg-orange-400/10 text-orange-400',
      waitlist_promotion: 'bg-[#D3FB52]/10 text-[#D3FB52]',
      message: 'bg-violet-400/10 text-violet-400',
      club_join: 'bg-teal-400/10 text-teal-400',
      general: 'bg-white/10 text-white/60',
    };
    return map[type] || 'bg-white/10 text-white/60';
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><div className="spinner" /></div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto page-enter">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display text-white flex items-center gap-2">
            <Bell size={24} className="text-[#D3FB52]" />
            Notifications
          </h1>
          <p className="text-white/50 mt-1">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs mb-6">
        <button className={`tab ${activeTab === 'inbox' ? 'tab-active' : ''}`} onClick={() => setActiveTab('inbox')}>
          Inbox {unreadCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 bg-[#D3FB52] text-[#002838] rounded-full text-xs font-bold">{unreadCount}</span>}
        </button>
        <button className={`tab ${activeTab === 'settings' ? 'tab-active' : ''}`} onClick={() => setActiveTab('settings')}>
          Preferences
        </button>
      </div>

      {activeTab === 'inbox' ? (
        <>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="btn btn-sm bg-white/10 text-white hover:bg-white/20 mb-4">
              <Check size={14} /> Mark all read
            </button>
          )}

          {notifications.length === 0 ? (
            <div className="card p-12 text-center">
              <Bell size={40} className="mx-auto text-white/15 mb-3" />
              <p className="text-white/40">No notifications yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map(notif => (
                <div
                  key={notif.id}
                  className={`card p-4 flex items-start gap-3 ${!notif.read ? 'border-[#D3FB52]/20' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor(notif.type)}`}>
                        {typeLabel(notif.type)}
                      </span>
                      {!notif.read && (
                        <span className="w-2 h-2 bg-[#D3FB52] rounded-full" />
                      )}
                      <span className="text-white/30 text-xs ml-auto">
                        {new Date(notif.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-white font-medium text-sm">{notif.title}</p>
                    {notif.body && <p className="text-white/50 text-sm mt-0.5">{notif.body}</p>}
                    {notif.link && (
                      <a href={notif.link} className="text-[#D3FB52] text-xs hover:underline mt-1 inline-block">View details</a>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!notif.read && (
                      <button onClick={() => markRead(notif.id)} className="p-1.5 hover:bg-white/10 rounded text-white/30 hover:text-emerald-400" title="Mark read">
                        <Check size={14} />
                      </button>
                    )}
                    <button onClick={() => deleteNotification(notif.id)} className="p-1.5 hover:bg-white/10 rounded text-white/30 hover:text-red-400" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="card p-6 space-y-4">
          <p className="text-white/50 text-sm mb-2">Choose which notifications you receive via email.</p>

          {([
            { key: 'event_invites' as const, label: 'Event invitations', desc: 'When someone invites you to an event' },
            { key: 'event_reminders' as const, label: 'Event reminders', desc: 'Day-before reminders for events you\'re attending' },
            { key: 'waitlist_updates' as const, label: 'Waitlist updates', desc: 'When you get promoted from a waitlist' },
            { key: 'organizer_messages' as const, label: 'Organizer messages', desc: 'Messages from event organizers' },
            { key: 'club_announcements' as const, label: 'Club announcements', desc: 'General announcements from your club' },
          ]).map(item => (
            <label key={item.key} className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg cursor-pointer hover:bg-white/[0.05] transition-colors">
              <div>
                <span className="text-white font-medium text-sm">{item.label}</span>
                <p className="text-white/40 text-xs">{item.desc}</p>
              </div>
              <input
                type="checkbox"
                checked={prefs[item.key]}
                onChange={e => updatePref(item.key, e.target.checked)}
                className="w-4 h-4 rounded"
              />
            </label>
          ))}

          {savingPrefs && <p className="text-[#D3FB52] text-xs">Saving...</p>}
        </div>
      )}
    </div>
  );
}
