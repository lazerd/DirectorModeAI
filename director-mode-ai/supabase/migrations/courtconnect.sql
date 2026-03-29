-- ============================================
-- CourtConnect Migration
-- Run this against your Supabase project to create CourtConnect tables
-- ============================================

-- Players
CREATE TABLE IF NOT EXISTS cc_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT,
  phone TEXT,
  primary_sport TEXT DEFAULT 'tennis' CHECK (primary_sport IN ('tennis', 'pickleball', 'padel', 'squash', 'badminton', 'racquetball', 'table_tennis')),
  preferred_days TEXT[],
  preferred_times TEXT[] DEFAULT '{}',
  organization_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Player sport ratings
CREATE TABLE IF NOT EXISTS cc_player_sports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID NOT NULL REFERENCES cc_players(id) ON DELETE CASCADE,
  sport TEXT NOT NULL CHECK (sport IN ('tennis', 'pickleball', 'padel', 'squash', 'badminton', 'racquetball', 'table_tennis')),
  ntrp_rating NUMERIC(2,1) CHECK (ntrp_rating >= 1.0 AND ntrp_rating <= 7.0),
  utr_rating NUMERIC(4,2) CHECK (utr_rating >= 1.00 AND utr_rating <= 16.50),
  is_self_rated BOOLEAN DEFAULT true,
  admin_override BOOLEAN DEFAULT false,
  admin_override_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  admin_override_at TIMESTAMPTZ,
  level_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, sport)
);

-- Events
CREATE TABLE IF NOT EXISTS cc_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('doubles', 'singles', 'clinic', 'social', 'practice', 'tournament', 'open_play')),
  sport TEXT NOT NULL CHECK (sport IN ('tennis', 'pickleball', 'padel', 'squash', 'badminton', 'racquetball', 'table_tennis')),
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  timezone TEXT DEFAULT 'America/New_York',
  location TEXT,
  court_count INTEGER DEFAULT 1,
  max_players INTEGER NOT NULL,
  auto_close BOOLEAN DEFAULT true,
  skill_min NUMERIC(2,1),
  skill_max NUMERIC(2,1),
  is_public BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled', 'completed')),
  organization_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event players (RSVPs)
CREATE TABLE IF NOT EXISTS cc_event_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES cc_events(id) ON DELETE CASCADE,
  player_id UUID REFERENCES cc_players(id) ON DELETE SET NULL,
  guest_name TEXT,
  guest_email TEXT,
  status TEXT DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'waitlisted', 'declined', 'removed')),
  response_order INTEGER,
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, player_id)
);

-- Email invitations
CREATE TABLE IF NOT EXISTS cc_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES cc_events(id) ON DELETE CASCADE,
  player_id UUID REFERENCES cc_players(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'opened', 'bounced', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cc_players_profile ON cc_players(profile_id);
CREATE INDEX IF NOT EXISTS idx_cc_players_sport ON cc_players(primary_sport);
CREATE INDEX IF NOT EXISTS idx_cc_player_sports_player ON cc_player_sports(player_id);
CREATE INDEX IF NOT EXISTS idx_cc_player_sports_sport ON cc_player_sports(sport);
CREATE INDEX IF NOT EXISTS idx_cc_events_created_by ON cc_events(created_by);
CREATE INDEX IF NOT EXISTS idx_cc_events_sport ON cc_events(sport);
CREATE INDEX IF NOT EXISTS idx_cc_events_date ON cc_events(event_date);
CREATE INDEX IF NOT EXISTS idx_cc_events_status ON cc_events(status);
CREATE INDEX IF NOT EXISTS idx_cc_event_players_event ON cc_event_players(event_id);
CREATE INDEX IF NOT EXISTS idx_cc_event_players_player ON cc_event_players(player_id);
CREATE INDEX IF NOT EXISTS idx_cc_event_players_status ON cc_event_players(status);
CREATE INDEX IF NOT EXISTS idx_cc_invitations_event ON cc_invitations(event_id);
CREATE INDEX IF NOT EXISTS idx_cc_invitations_email ON cc_invitations(email);

-- RLS
ALTER TABLE cc_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_player_sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_event_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own player profile" ON cc_players
  FOR ALL USING (profile_id = auth.uid());
CREATE POLICY "Auth users can view all players" ON cc_players
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can manage own sport ratings" ON cc_player_sports
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_players WHERE id = player_id AND profile_id = auth.uid())
  );
CREATE POLICY "Auth users can view sport ratings" ON cc_player_sports
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can manage own events" ON cc_events
  FOR ALL USING (created_by = auth.uid());
CREATE POLICY "Public can view public events" ON cc_events
  FOR SELECT USING (is_public = true);

CREATE POLICY "Event creators can manage event players" ON cc_event_players
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_events WHERE id = event_id AND created_by = auth.uid())
  );
CREATE POLICY "Players can manage own RSVPs" ON cc_event_players
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM cc_players WHERE id = player_id AND profile_id = auth.uid())
  );
CREATE POLICY "Public can view event players" ON cc_event_players
  FOR SELECT USING (true);

CREATE POLICY "Auth users can manage invitations" ON cc_invitations
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================
-- PLAYERVAULT: Director Club Roster CRM
-- ============================================

CREATE TABLE IF NOT EXISTS cc_vault_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  director_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  gender TEXT CHECK (gender IN ('male', 'female', 'non_binary', 'prefer_not_to_say')),
  date_of_birth DATE,
  age INTEGER,
  usta_rating NUMERIC(2,1) CHECK (usta_rating >= 1.0 AND usta_rating <= 7.0),
  utr_rating NUMERIC(4,2) CHECK (utr_rating >= 1.00 AND utr_rating <= 16.50),
  utr_id TEXT,
  rating_source TEXT DEFAULT 'manual' CHECK (rating_source IN ('manual', 'utr_api', 'usta_api')),
  primary_sport TEXT DEFAULT 'tennis' CHECK (primary_sport IN ('tennis', 'pickleball', 'padel', 'squash', 'badminton', 'racquetball', 'table_tennis')),
  sports TEXT[] DEFAULT '{}',
  organization_id UUID,
  membership_status TEXT DEFAULT 'active' CHECK (membership_status IN ('active', 'inactive', 'guest')),
  cc_player_id UUID REFERENCES cc_players(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_vault_director ON cc_vault_players(director_id);
CREATE INDEX IF NOT EXISTS idx_cc_vault_email ON cc_vault_players(email);
CREATE INDEX IF NOT EXISTS idx_cc_vault_sport ON cc_vault_players(primary_sport);
CREATE INDEX IF NOT EXISTS idx_cc_vault_membership ON cc_vault_players(membership_status);
CREATE INDEX IF NOT EXISTS idx_cc_vault_cc_link ON cc_vault_players(cc_player_id);

ALTER TABLE cc_vault_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Directors can manage own vault" ON cc_vault_players
  FOR ALL USING (director_id = auth.uid());

-- Updated_at triggers
CREATE TRIGGER update_cc_players_updated_at BEFORE UPDATE ON cc_players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_cc_player_sports_updated_at BEFORE UPDATE ON cc_player_sports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_cc_events_updated_at BEFORE UPDATE ON cc_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_cc_vault_players_updated_at BEFORE UPDATE ON cc_vault_players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
