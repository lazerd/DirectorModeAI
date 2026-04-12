-- ============================================================================
-- Pending production sync — paste into Supabase SQL editor and run once.
-- ============================================================================
--
-- This file consolidates every migration under ./migrations/ that has NOT
-- yet been applied to the live Supabase database. Every block is wrapped in
-- a DO / IF NOT EXISTS guard so re-running this whole file is completely
-- idempotent — if you've already applied part of it, only the missing
-- pieces will run.
--
-- Current pending migrations:
--   1. leagues_realtime.sql     — adds league_matches + league_flights to
--                                 the supabase_realtime publication so the
--                                 public bracket page at /leagues/[slug]/bracket
--                                 can subscribe to live score updates.
--   2. email_unsubscribes.sql   — creates the email_unsubscribes blocklist
--                                 that the one-click unsubscribe footer
--                                 inserts into when recipients opt out.
--
-- When you add a new migration file in ./migrations/ later, append its
-- contents to this file (still wrapped in guards) and re-run. Think of
-- this file as the "if my local migrations folder is the source of truth,
-- here's the diff I still need to apply to prod".
--
-- How to run:
--   1. Open Supabase dashboard → your project → SQL Editor
--   2. Paste this entire file
--   3. Click Run
--   4. Should complete in a few hundred ms with "Success. No rows returned."
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. leagues_realtime.sql — enable Supabase Realtime for league bracket tables
-- ----------------------------------------------------------------------------
-- Without this, the public bracket page (/leagues/[slug]/bracket) loads the
-- initial snapshot fine but never gets live score updates — the
-- postgres_changes subscription on league_matches silently receives nothing
-- because the tables aren't in the publication.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'league_matches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.league_matches;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'league_flights'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.league_flights;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. email_unsubscribes.sql — one-click unsubscribe blocklist
-- ----------------------------------------------------------------------------
-- Without this, the unsubscribe footer link on every outbound email lands on
-- a page that fails silently because email_unsubscribes doesn't exist yet.
-- The pre-send check in lib/emailUnsubscribe.ts returns false (fail open)
-- on query error so emails still go out in the meantime — the only thing
-- broken before this runs is the opt-out itself.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'email_unsubscribes'
  ) THEN
    CREATE TABLE public.email_unsubscribes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'all',
      unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(email, scope)
    );

    CREATE INDEX idx_email_unsubscribes_email ON public.email_unsubscribes(email);

    -- Service role handles all writes/reads. RLS is enabled but no policies
    -- → anon and authenticated users cannot touch this table directly. The
    -- lib code uses the admin client, so it bypasses RLS.
    ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ============================================================================
-- End of pending sync. If you see "Success. No rows returned." the database
-- is now aligned with every committed migration in director-mode-ai/supabase/
-- migrations/. Safe to re-run this file any time.
-- ============================================================================
