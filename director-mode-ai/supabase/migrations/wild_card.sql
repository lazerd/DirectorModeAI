-- ============================================
-- Wild Card (rotating partners) + signup caps by gender
-- ============================================
-- RETIRED 2026-09-15: 'wild-card' is no longer a match_format — the existing
-- mixed-doubles mixer now rotates partners itself (advancedMatchGeneration).
-- No rows use it. wild_card_* columns are left in place, unused, rather than
-- dropped. max_men / max_women live on as mixed doubles' separate spots.
-- This file stays as the record of what was applied to prod.
-- ============================================
-- events.match_format = 'wild-card' is a mixer: rotating random partners over
-- a set number of rounds, individual winner. Rounds/matches use the existing
-- rounds + matches tables; these columns hold the schedule settings.
--
--   wild_card_mode    'mixed' (one man + one woman per team) or 'open'
--   wild_card_rounds  how many rounds the schedule builds
--   wild_card_seed    the shuffle that produced the current schedule — the
--                     same seed + roster rebuilds the same sheet
--
-- max_men / max_women cap public signup per gender ("12 men, 12 women, first
-- come first served"); extras land on the waitlist. NULL = no gender cap.
-- Usable by any mixer, not just Wild Card.
--
-- Additive and safe to re-run.
-- ============================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS wild_card_mode TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS wild_card_rounds INTEGER;
ALTER TABLE events ADD COLUMN IF NOT EXISTS wild_card_seed INTEGER;
ALTER TABLE events ADD COLUMN IF NOT EXISTS max_men INTEGER;
ALTER TABLE events ADD COLUMN IF NOT EXISTS max_women INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_wild_card_mode_check') THEN
    ALTER TABLE events ADD CONSTRAINT events_wild_card_mode_check
      CHECK (wild_card_mode IS NULL OR wild_card_mode IN ('mixed', 'open'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_wild_card_rounds_check') THEN
    ALTER TABLE events ADD CONSTRAINT events_wild_card_rounds_check
      CHECK (wild_card_rounds IS NULL OR (wild_card_rounds BETWEEN 1 AND 12));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_gender_caps_check') THEN
    ALTER TABLE events ADD CONSTRAINT events_gender_caps_check
      CHECK ((max_men IS NULL OR max_men >= 0) AND (max_women IS NULL OR max_women >= 0));
  END IF;
END $$;
