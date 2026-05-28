-- ============================================
-- CourtSheet AI — Phase 1 / Migration 001
-- Extensions required by the reservation engine.
-- ============================================
-- btree_gist lets a GiST index mix b-tree-style equality (court_id =) with
-- a range overlap (tstzrange &&). That combination is the linchpin of
-- migration 005's no-double-booking EXCLUDE constraint. Supabase allows
-- this extension on the standard plan.
--
-- uuid-ossp is already enabled by earlier migrations; included here for
-- safety so this file is standalone.
--
-- Safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;
