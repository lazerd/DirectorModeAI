-- Enable Supabase realtime (postgres_changes) for the league bracket tables.
-- The public bracket page at /leagues/[slug]/bracket subscribes to changes
-- on these so viewers get live updates as scores come in during league night
-- without having to refresh the page.
--
-- Idempotent: safe to re-run. Each ALTER PUBLICATION is wrapped in a DO block
-- that first checks pg_publication_tables so re-applying the migration on an
-- already-configured database is a no-op instead of an error.

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
