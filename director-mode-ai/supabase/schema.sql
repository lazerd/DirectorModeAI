-- ============================================
-- Director Mode AI - Unified Database Schema
-- Supports: MixerMode, LastMinuteLesson, StringingMode
-- ============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- SHARED: User Profiles (extends Supabase Auth)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  
  -- Role in the system
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'director', 'coach', 'stringer', 'front_desk', 'user')),
  
  -- Optional club/organization association
  organization_id UUID,
  organization_name TEXT,
  
  -- Preferences
  timezone TEXT DEFAULT 'America/New_York',
  
  -- Billing (for MixerMode)
  billing_status TEXT DEFAULT 'trial' CHECK (billing_status IN ('trial', 'active', 'cancelled', 'none')),
  stripe_customer_id TEXT,
  trial_ends_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================
-- MIXER MODE: Events & Players
-- ============================================

CREATE TABLE IF NOT EXISTS mixer_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  event_code TEXT UNIQUE NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME,
  
  -- Format settings
  num_courts INTEGER DEFAULT 4,
  match_format TEXT DEFAULT 'doubles',
  scoring_format TEXT DEFAULT 'fixed_games' CHECK (scoring_format IN (
    'fixed_games', 'first_to_x', 'timed', 'pro_set', 
    'best_of_3_sets', 'best_of_3_tiebreak', 'flexible'
  )),
  round_length_minutes INTEGER DEFAULT 20,
  target_games INTEGER DEFAULT 6,
  
  -- Notes
  format_notes TEXT,
  
  -- Billing
  is_paid BOOLEAN DEFAULT false,
  created_during_trial BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mixer_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES mixer_events(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  skill_level INTEGER DEFAULT 3 CHECK (skill_level BETWEEN 1 AND 5),
  
  -- Stats for this event
  strength_order INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0,
  games_lost INTEGER DEFAULT 0,
  
  checked_in BOOLEAN DEFAULT false,
  checked_in_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mixer_rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES mixer_events(id) ON DELETE CASCADE,
  
  round_number INTEGER NOT NULL,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'in_progress', 'completed')),
  
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mixer_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id UUID NOT NULL REFERENCES mixer_rounds(id) ON DELETE CASCADE,
  
  court_number INTEGER NOT NULL,
  
  -- Players (supports singles and doubles)
  player1_id UUID REFERENCES mixer_players(id) ON DELETE SET NULL,
  player2_id UUID REFERENCES mixer_players(id) ON DELETE SET NULL,
  player3_id UUID REFERENCES mixer_players(id) ON DELETE SET NULL,
  player4_id UUID REFERENCES mixer_players(id) ON DELETE SET NULL,
  
  -- Scores
  team1_score INTEGER,
  team2_score INTEGER,
  winner_team INTEGER CHECK (winner_team IN (1, 2)),
  tiebreaker_winner INTEGER CHECK (tiebreaker_winner IN (1, 2)),
  
  -- For tournament brackets
  feeds_into_match_id UUID REFERENCES mixer_matches(id),
  bracket_position TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================
-- LESSONS MODE: Coaches, Clients, Slots
-- ============================================

CREATE TABLE IF NOT EXISTS lesson_clubs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  logo_url TEXT,
  
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invite_code TEXT UNIQUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lesson_coaches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  club_id UUID REFERENCES lesson_clubs(id) ON DELETE SET NULL,
  
  -- Coach role within club context
  coach_role TEXT DEFAULT 'independent' CHECK (coach_role IN ('director', 'club_coach', 'independent')),
  
  bio TEXT,
  phone TEXT,
  hourly_rate NUMERIC,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lesson_clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Many-to-many: clients <-> coaches
CREATE TABLE IF NOT EXISTS lesson_client_coaches (
  client_id UUID NOT NULL REFERENCES lesson_clients(id) ON DELETE CASCADE,
  coach_id UUID NOT NULL REFERENCES lesson_coaches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_id, coach_id)
);

-- Many-to-many: clients <-> clubs
CREATE TABLE IF NOT EXISTS lesson_client_clubs (
  client_id UUID NOT NULL REFERENCES lesson_clients(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES lesson_clubs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_id, club_id)
);

CREATE TABLE IF NOT EXISTS lesson_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES lesson_coaches(id) ON DELETE CASCADE,
  club_id UUID REFERENCES lesson_clubs(id) ON DELETE SET NULL,
  
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'cancelled')),
  claimed_by_client_id UUID REFERENCES lesson_clients(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  
  note TEXT,
  location TEXT,
  
  -- Secure claim token
  claim_token UUID DEFAULT uuid_generate_v4() UNIQUE,
  
  -- Notification tracking
  notifications_sent BOOLEAN DEFAULT FALSE,
  notified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lesson_email_blasts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID REFERENCES lesson_coaches(id) ON DELETE SET NULL,
  club_id UUID REFERENCES lesson_clubs(id) ON DELETE SET NULL,
  
  blast_type TEXT NOT NULL CHECK (blast_type IN ('coach', 'club')),
  slots_included INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  emails_failed INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================
-- STRINGING MODE: Customers, Rackets, Jobs
-- ============================================

CREATE TABLE IF NOT EXISTS stringing_customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stringing_rackets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES stringing_customers(id) ON DELETE CASCADE,
  
  brand TEXT,
  model TEXT,
  string_pattern TEXT, -- e.g. "16x19"
  grip_size TEXT,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stringing_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  string_type TEXT CHECK (string_type IN ('poly', 'multi', 'synthetic_gut', 'natural_gut', 'hybrid', 'other')),
  gauge TEXT,
  
  -- For AI recommendations
  arm_friendliness_score INTEGER CHECK (arm_friendliness_score BETWEEN 1 AND 10),
  power_score INTEGER CHECK (power_score BETWEEN 1 AND 10),
  control_score INTEGER CHECK (control_score BETWEEN 1 AND 10),
  spin_score INTEGER CHECK (spin_score BETWEEN 1 AND 10),
  durability_score INTEGER CHECK (durability_score BETWEEN 1 AND 10),
  
  price NUMERIC,
  in_stock BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stringing_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  customer_id UUID NOT NULL REFERENCES stringing_customers(id) ON DELETE CASCADE,
  racket_id UUID REFERENCES stringing_rackets(id) ON DELETE SET NULL,
  
  -- String selection (either from catalog or custom)
  string_id UUID REFERENCES stringing_catalog(id) ON DELETE SET NULL,
  custom_string_name TEXT,
  
  -- Tension
  main_tension_lbs NUMERIC NOT NULL,
  cross_tension_lbs NUMERIC, -- NULL means same as mains
  
  -- Customer preferences (for AI context)
  play_style TEXT,
  skill_level TEXT,
  arm_issues TEXT,
  
  -- Status workflow
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'picked_up', 'cancelled')),
  
  -- Staff assignments
  requested_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  stringer_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  
  -- Timestamps
  quoted_ready_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  
  -- Notes
  internal_notes TEXT,
  customer_visible_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stringing_job_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES stringing_jobs(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES stringing_customers(id) ON DELETE SET NULL,
  
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comments TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================
-- INDEXES
-- ============================================

-- Profiles
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- Mixer
CREATE INDEX IF NOT EXISTS idx_mixer_events_user ON mixer_events(user_id);
CREATE INDEX IF NOT EXISTS idx_mixer_events_code ON mixer_events(event_code);
CREATE INDEX IF NOT EXISTS idx_mixer_events_date ON mixer_events(event_date);
CREATE INDEX IF NOT EXISTS idx_mixer_players_event ON mixer_players(event_id);
CREATE INDEX IF NOT EXISTS idx_mixer_rounds_event ON mixer_rounds(event_id);
CREATE INDEX IF NOT EXISTS idx_mixer_matches_round ON mixer_matches(round_id);

-- Lessons
CREATE INDEX IF NOT EXISTS idx_lesson_coaches_profile ON lesson_coaches(profile_id);
CREATE INDEX IF NOT EXISTS idx_lesson_coaches_club ON lesson_coaches(club_id);
CREATE INDEX IF NOT EXISTS idx_lesson_clients_email ON lesson_clients(email);
CREATE INDEX IF NOT EXISTS idx_lesson_slots_coach ON lesson_slots(coach_id);
CREATE INDEX IF NOT EXISTS idx_lesson_slots_status ON lesson_slots(status);
CREATE INDEX IF NOT EXISTS idx_lesson_slots_time ON lesson_slots(start_time);
CREATE INDEX IF NOT EXISTS idx_lesson_slots_token ON lesson_slots(claim_token);

-- Stringing
CREATE INDEX IF NOT EXISTS idx_stringing_customers_email ON stringing_customers(email);
CREATE INDEX IF NOT EXISTS idx_stringing_rackets_customer ON stringing_rackets(customer_id);
CREATE INDEX IF NOT EXISTS idx_stringing_jobs_customer ON stringing_jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_stringing_jobs_status ON stringing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_stringing_catalog_stock ON stringing_catalog(in_stock);


-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE mixer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mixer_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE mixer_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE mixer_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_coaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_client_coaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_client_clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_email_blasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stringing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stringing_rackets ENABLE ROW LEVEL SECURITY;
ALTER TABLE stringing_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE stringing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stringing_job_feedback ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own profile
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Mixer: users can manage their own events
CREATE POLICY "Users can manage own events" ON mixer_events
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public can view events by code" ON mixer_events
  FOR SELECT USING (true);

-- Mixer players: event owners can manage, public can view
CREATE POLICY "Event owners can manage players" ON mixer_players
  FOR ALL USING (
    EXISTS (SELECT 1 FROM mixer_events WHERE id = event_id AND user_id = auth.uid())
  );
CREATE POLICY "Public can view players" ON mixer_players
  FOR SELECT USING (true);

-- Mixer rounds/matches: same pattern
CREATE POLICY "Event owners can manage rounds" ON mixer_rounds
  FOR ALL USING (
    EXISTS (SELECT 1 FROM mixer_events WHERE id = event_id AND user_id = auth.uid())
  );
CREATE POLICY "Public can view rounds" ON mixer_rounds
  FOR SELECT USING (true);

CREATE POLICY "Round owners can manage matches" ON mixer_matches
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM mixer_rounds r
      JOIN mixer_events e ON r.event_id = e.id
      WHERE r.id = round_id AND e.user_id = auth.uid()
    )
  );
CREATE POLICY "Public can view matches" ON mixer_matches
  FOR SELECT USING (true);

-- Lessons: authenticated users can manage (simplified for now)
CREATE POLICY "Auth users can manage clubs" ON lesson_clubs
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can manage coaches" ON lesson_coaches
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can manage clients" ON lesson_clients
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can manage client_coaches" ON lesson_client_coaches
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can manage client_clubs" ON lesson_client_clubs
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can manage slots" ON lesson_slots
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Public can view slots by token" ON lesson_slots
  FOR SELECT USING (true);
CREATE POLICY "Auth users can manage blasts" ON lesson_email_blasts
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Stringing: authenticated users (staff) can manage all
CREATE POLICY "Staff can manage customers" ON stringing_customers
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can manage rackets" ON stringing_rackets
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can manage catalog" ON stringing_catalog
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Anyone can view catalog" ON stringing_catalog
  FOR SELECT USING (true);
CREATE POLICY "Staff can manage jobs" ON stringing_jobs
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can manage feedback" ON stringing_job_feedback
  FOR ALL USING (auth.uid() IS NOT NULL);


-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Generate unique event code for MixerMode
CREATE OR REPLACE FUNCTION generate_event_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Slot claiming function with race condition protection
CREATE OR REPLACE FUNCTION claim_lesson_slot(
  p_slot_id UUID,
  p_claim_token UUID,
  p_client_email TEXT
)
RETURNS JSON AS $$
DECLARE
  v_slot lesson_slots%ROWTYPE;
  v_client lesson_clients%ROWTYPE;
  v_coach lesson_coaches%ROWTYPE;
  v_profile profiles%ROWTYPE;
BEGIN
  -- Lock the slot
  SELECT * INTO v_slot
  FROM lesson_slots
  WHERE id = p_slot_id AND claim_token = p_claim_token
  FOR UPDATE;

  IF v_slot IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid slot or token');
  END IF;

  IF v_slot.status = 'claimed' THEN
    RETURN json_build_object('success', false, 'error', 'Slot already claimed');
  END IF;

  IF v_slot.status = 'cancelled' THEN
    RETURN json_build_object('success', false, 'error', 'Slot is no longer available');
  END IF;

  -- Find client
  SELECT c.* INTO v_client
  FROM lesson_clients c
  JOIN lesson_client_coaches cc ON c.id = cc.client_id
  WHERE c.email = p_client_email AND cc.coach_id = v_slot.coach_id;

  IF v_client IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Email not found in client list');
  END IF;

  -- Claim it
  UPDATE lesson_slots
  SET status = 'claimed', claimed_by_client_id = v_client.id, claimed_at = NOW()
  WHERE id = p_slot_id;

  -- Get coach info
  SELECT * INTO v_coach FROM lesson_coaches WHERE id = v_slot.coach_id;
  SELECT * INTO v_profile FROM profiles WHERE id = v_coach.profile_id;

  RETURN json_build_object(
    'success', true,
    'client_name', v_client.name,
    'coach_name', v_profile.full_name,
    'coach_email', v_profile.email,
    'start_time', v_slot.start_time,
    'end_time', v_slot.end_time
  );
END;
$$ LANGUAGE plpgsql;


-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_mixer_events_updated_at BEFORE UPDATE ON mixer_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_lesson_clubs_updated_at BEFORE UPDATE ON lesson_clubs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_lesson_coaches_updated_at BEFORE UPDATE ON lesson_coaches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_lesson_clients_updated_at BEFORE UPDATE ON lesson_clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_lesson_slots_updated_at BEFORE UPDATE ON lesson_slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_stringing_customers_updated_at BEFORE UPDATE ON stringing_customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_stringing_rackets_updated_at BEFORE UPDATE ON stringing_rackets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_stringing_catalog_updated_at BEFORE UPDATE ON stringing_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_stringing_jobs_updated_at BEFORE UPDATE ON stringing_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
