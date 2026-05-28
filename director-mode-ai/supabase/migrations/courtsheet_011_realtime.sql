-- ============================================
-- CourtSheet AI — Phase 5 / Migration 011
-- Enable Supabase realtime on reservations + signups.
-- ============================================
-- Drives the live grid: two staff with the sheet open see each other's
-- changes within ~500ms, without polling. Idempotent — each ALTER
-- PUBLICATION is gated by a pg_publication_tables check so re-running
-- this migration on an already-configured database is a no-op.
--
-- Safe to re-run.
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reservations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reservation_signups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_signups;
  END IF;
END $$;
