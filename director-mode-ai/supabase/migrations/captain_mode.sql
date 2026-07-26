-- =====================================================================
-- CaptainMode — USTA / local-league team captain tooling
--
-- Availability polling, lineup generation, sub replacement, and playoff
-- eligibility tracking for league captains. Sold per-captain on top of a
-- club's ClubMode Pro plan ($10/mo) or standalone ($20/mo).
--
-- Player-facing surfaces are tokenized and login-free: every captain_players
-- row carries a player_token, and all token traffic goes through the service
-- role (getSupabaseAdmin) server-side. anon gets NO grants on these tables.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_mode.sql
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Teams + staff
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captain_teams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_user_id   uuid NOT NULL,                       -- owning captain (auth.users)
  club_id           uuid REFERENCES cc_clubs(id),        -- null = standalone captain
  name              text NOT NULL,
  league_type       text NOT NULL DEFAULT 'usta_adult',  -- usta_adult|usta_combo|usta_mixed|usta_trilevel|flex
  level             text,                                -- '3.5', '8.5 combo', '40+ 4.0' …
  season_start      date,
  season_end        date,
  -- Playoff eligibility. Some leagues have no playoffs at all (East Bay
  -- Women's Tennis League), so this is opt-in per team. USTA requires MORE
  -- matches from self-rated and appeal-rated players than computer-rated
  -- ones, and the threshold depends on how many lines the league plays —
  -- so both numbers are captain-entered, never inferred.
  eligibility_enabled       boolean NOT NULL DEFAULT false,
  min_matches_default       int NOT NULL DEFAULT 2,   -- computer-rated
  min_matches_self_rated    int NOT NULL DEFAULT 3,   -- self-rate / appeal
  source_site       text,                                -- 'tennislink' | 'topdog' | free text
  archived          boolean NOT NULL DEFAULT false,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS captain_teams_captain_idx ON captain_teams(captain_user_id) WHERE archived = false;
CREATE INDEX IF NOT EXISTS captain_teams_club_idx    ON captain_teams(club_id);

-- Co-captains: full access, no extra charge.
CREATE TABLE IF NOT EXISTS captain_team_staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  role        text NOT NULL DEFAULT 'co_captain' CHECK (role IN ('captain','co_captain')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS captain_team_staff_user_idx ON captain_team_staff(user_id);

-- Break RLS recursion between teams <-> staff.
CREATE OR REPLACE FUNCTION public.captain_can_access_team(target_team uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM captain_teams t
     WHERE t.id = target_team AND t.captain_user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM captain_team_staff s
     WHERE s.team_id = target_team AND s.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- Roster + subs. No player logins — player_token is the credential.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captain_players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text,
  rating        numeric(3,1),                 -- NTRP: 3.0, 3.5, 4.0 …
  -- Self-rated and appeal-rated players face a higher playoff-eligibility bar
  -- than computer-rated players under USTA rules.
  rating_type   text NOT NULL DEFAULT 'computer'
                  CHECK (rating_type IN ('computer','self','appeal')),
  gender        text CHECK (gender IN ('M','F')),  -- required for mixed pairing rules
  return_side   text CHECK (return_side IN ('deuce','ad')),
  is_sub        boolean NOT NULL DEFAULT false,
  court_limit   text CHECK (court_limit IN ('singles_only','doubles_only','no_court_1')),
  notes         text,                         -- captain-private
  active        boolean NOT NULL DEFAULT true,
  player_token  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS captain_players_team_idx ON captain_players(team_id) WHERE active = true;

-- Token backfill -> NOT NULL -> DEFAULT (order matters on re-run).
UPDATE captain_players SET player_token = replace(gen_random_uuid()::text,'-','') WHERE player_token IS NULL;
ALTER TABLE captain_players ALTER COLUMN player_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS captain_players_token_idx ON captain_players(player_token);
ALTER TABLE captain_players ALTER COLUMN player_token SET DEFAULT replace(gen_random_uuid()::text,'-','');

-- Ranked partner preferences (top 5 per player).
CREATE TABLE IF NOT EXISTS captain_partner_prefs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  player_id           uuid NOT NULL REFERENCES captain_players(id) ON DELETE CASCADE,
  preferred_player_id uuid NOT NULL REFERENCES captain_players(id) ON DELETE CASCADE,
  rank                smallint NOT NULL CHECK (rank BETWEEN 1 AND 5),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, rank),
  UNIQUE (player_id, preferred_player_id),
  CHECK (player_id <> preferred_player_id)
);
CREATE INDEX IF NOT EXISTS captain_partner_prefs_team_idx ON captain_partner_prefs(team_id);

-- Hard "never put these two together" pairs.
CREATE TABLE IF NOT EXISTS captain_never_pair (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  player_a_id  uuid NOT NULL REFERENCES captain_players(id) ON DELETE CASCADE,
  player_b_id  uuid NOT NULL REFERENCES captain_players(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (player_a_id <> player_b_id)
);
CREATE INDEX IF NOT EXISTS captain_never_pair_team_idx ON captain_never_pair(team_id);

-- ---------------------------------------------------------------------
-- Matches
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captain_matches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id               uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  match_at              timestamptz NOT NULL,
  is_home               boolean NOT NULL DEFAULT true,
  opponent              text,
  location              text,
  arrival_note          text,                 -- "arrive 15 min early"
  opposing_captain_name text,
  opposing_captain_phone text,
  singles_courts        int NOT NULL DEFAULT 2,
  doubles_courts        int NOT NULL DEFAULT 3,
  status                text NOT NULL DEFAULT 'scheduled'
                          CHECK (status IN ('scheduled','played','cancelled')),
  lineup_email_sent_at  timestamptz,
  reminder_sent_at      timestamptz,
  nudge_sent_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS captain_matches_team_idx ON captain_matches(team_id, match_at);
CREATE INDEX IF NOT EXISTS captain_matches_sched_idx ON captain_matches(match_at)
  WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS captain_availability (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  match_id      uuid NOT NULL REFERENCES captain_matches(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES captain_players(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('yes','no','maybe')),
  responded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS captain_availability_match_idx ON captain_availability(match_id);

-- ---------------------------------------------------------------------
-- Lineups + results
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captain_lineups (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  match_id             uuid NOT NULL REFERENCES captain_matches(id) ON DELETE CASCADE,
  court_number         int NOT NULL,
  court_type           text NOT NULL CHECK (court_type IN ('singles','doubles')),
  player1_id           uuid REFERENCES captain_players(id) ON DELETE SET NULL,
  player2_id           uuid REFERENCES captain_players(id) ON DELETE SET NULL,
  player1_confirmed_at timestamptz,
  player2_confirmed_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, court_number)
);
CREATE INDEX IF NOT EXISTS captain_lineups_match_idx ON captain_lineups(match_id);

CREATE TABLE IF NOT EXISTS captain_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  match_id      uuid NOT NULL REFERENCES captain_matches(id) ON DELETE CASCADE,
  court_number  int NOT NULL,
  score         text,
  won           boolean,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, court_number)
);

-- ---------------------------------------------------------------------
-- Sub requests — first-to-claim wins (resolved by a single UPDATE).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captain_sub_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id               uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  match_id              uuid NOT NULL REFERENCES captain_matches(id) ON DELETE CASCADE,
  lineup_id             uuid REFERENCES captain_lineups(id) ON DELETE CASCADE,
  slot                  smallint NOT NULL DEFAULT 1 CHECK (slot IN (1,2)),
  dropped_player_id     uuid REFERENCES captain_players(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','filled','cancelled')),
  claimed_by_player_id  uuid REFERENCES captain_players(id) ON DELETE SET NULL,
  claimed_at            timestamptz,
  request_token         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
UPDATE captain_sub_requests SET request_token = replace(gen_random_uuid()::text,'-','') WHERE request_token IS NULL;
ALTER TABLE captain_sub_requests ALTER COLUMN request_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS captain_sub_requests_token_idx ON captain_sub_requests(request_token);
ALTER TABLE captain_sub_requests ALTER COLUMN request_token SET DEFAULT replace(gen_random_uuid()::text,'-','');
CREATE INDEX IF NOT EXISTS captain_sub_requests_open_idx ON captain_sub_requests(match_id) WHERE status = 'open';

-- ---------------------------------------------------------------------
-- Per-captain subscription. Deliberately separate from profiles.plan_tier:
-- a captain may be on ClubMode free while paying for CaptainMode, and the
-- rate depends on whether THEIR CLUB has Pro.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captain_subscriptions (
  user_id                 uuid PRIMARY KEY,
  club_id                 uuid REFERENCES cc_clubs(id),
  rate_type               text NOT NULL DEFAULT 'standalone'
                            CHECK (rate_type IN ('club_linked','standalone')),
  status                  text NOT NULL DEFAULT 'inactive',   -- mirrors Stripe
  stripe_customer_id      text,
  stripe_subscription_id  text,
  current_period_end      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Forward-compatible column adds, for installs made before these existed.
-- ---------------------------------------------------------------------
ALTER TABLE captain_teams
  ADD COLUMN IF NOT EXISTS eligibility_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_matches_default    int     NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS min_matches_self_rated int     NOT NULL DEFAULT 3;

ALTER TABLE captain_players
  ADD COLUMN IF NOT EXISTS rating_type text NOT NULL DEFAULT 'computer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'captain_players_rating_type_check'
  ) THEN
    ALTER TABLE captain_players
      ADD CONSTRAINT captain_players_rating_type_check
      CHECK (rating_type IN ('computer','self','appeal'));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- RLS. Captain owns the team; co-captains get the same access.
-- ---------------------------------------------------------------------
ALTER TABLE captain_teams          ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_team_staff     ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_players        ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_partner_prefs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_never_pair     ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_matches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_availability   ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_lineups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_results        ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_sub_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_subscriptions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "captain manages own teams" ON captain_teams;
CREATE POLICY "captain manages own teams" ON captain_teams
  FOR ALL TO authenticated
  USING (captain_user_id = auth.uid() OR captain_can_access_team(id))
  WITH CHECK (captain_user_id = auth.uid() OR captain_can_access_team(id));

DROP POLICY IF EXISTS "captain manages team staff" ON captain_team_staff;
CREATE POLICY "captain manages team staff" ON captain_team_staff
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR captain_can_access_team(team_id))
  WITH CHECK (captain_can_access_team(team_id));

-- Every team-scoped child table shares one shape.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'captain_players','captain_partner_prefs','captain_never_pair','captain_matches',
    'captain_availability','captain_lineups','captain_results','captain_sub_requests'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'captain team scope', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated
         USING (captain_can_access_team(team_id))
         WITH CHECK (captain_can_access_team(team_id))',
      'captain team scope', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "captain reads own subscription" ON captain_subscriptions;
CREATE POLICY "captain reads own subscription" ON captain_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Lock anon out entirely. Player-facing pages read/write through the
-- service role only, so anon never needs a grant — and must never be able
-- to enumerate tokens or player emails.
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'captain_teams','captain_team_staff','captain_players','captain_partner_prefs',
    'captain_never_pair','captain_matches','captain_availability','captain_lineups',
    'captain_results','captain_sub_requests','captain_subscriptions'
  ] LOOP
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);
  END LOOP;
END $$;

-- =====================================================================
-- VERIFY:
--   select count(*) from captain_teams;
--   select tablename, rowsecurity from pg_tables where tablename like 'captain%';
--   select tablename, policyname from pg_policies where tablename like 'captain%' order by 1;
--   -- anon must return zero rows here:
--   select table_name, privilege_type from information_schema.role_table_grants
--    where grantee='anon' and table_name like 'captain%';
-- =====================================================================
