-- ============================================
-- JTT results-email saved recipients
-- ============================================
-- Stores the coach/recipient email list for the "Email results" button so
-- the director doesn't have to retype it each time. League-level (one list
-- per JTT league). Safe to re-run.
-- ============================================

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS jtt_email_recipients TEXT[] NOT NULL DEFAULT '{}'::text[];
