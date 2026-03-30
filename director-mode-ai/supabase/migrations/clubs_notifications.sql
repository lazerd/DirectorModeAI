-- ============================================
-- Clubs + Notifications Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- Public Club Profiles
CREATE TABLE IF NOT EXISTS cc_clubs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  logo_url TEXT,
  cover_image_url TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  sports TEXT[] DEFAULT '{tennis}',
  is_public BOOLEAN DEFAULT true,
  accept_join_requests BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification Preferences
CREATE TABLE IF NOT EXISTS cc_notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_invites BOOLEAN DEFAULT true,
  event_reminders BOOLEAN DEFAULT true,
  waitlist_updates BOOLEAN DEFAULT true,
  organizer_messages BOOLEAN DEFAULT true,
  club_announcements BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id)
);

-- Notification Log
CREATE TABLE IF NOT EXISTS cc_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('event_invite', 'event_reminder', 'rsvp_update', 'waitlist_promotion', 'message', 'club_join', 'general')),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cc_clubs_owner ON cc_clubs(owner_id);
CREATE INDEX IF NOT EXISTS idx_cc_clubs_slug ON cc_clubs(slug);
CREATE INDEX IF NOT EXISTS idx_cc_notif_prefs_profile ON cc_notification_preferences(profile_id);
CREATE INDEX IF NOT EXISTS idx_cc_notifications_profile ON cc_notifications(profile_id);
CREATE INDEX IF NOT EXISTS idx_cc_notifications_read ON cc_notifications(profile_id, read);

-- RLS
ALTER TABLE cc_clubs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can manage own clubs" ON cc_clubs
  FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "Public can view public clubs" ON cc_clubs
  FOR SELECT USING (is_public = true);

ALTER TABLE cc_notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notification prefs" ON cc_notification_preferences
  FOR ALL USING (profile_id = auth.uid());

ALTER TABLE cc_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own notifications" ON cc_notifications
  FOR SELECT USING (profile_id = auth.uid());
CREATE POLICY "Users can update own notifications" ON cc_notifications
  FOR UPDATE USING (profile_id = auth.uid());
CREATE POLICY "System can insert notifications" ON cc_notifications
  FOR INSERT WITH CHECK (true);

-- Triggers
CREATE TRIGGER update_cc_clubs_updated_at BEFORE UPDATE ON cc_clubs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_cc_notif_prefs_updated_at BEFORE UPDATE ON cc_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
