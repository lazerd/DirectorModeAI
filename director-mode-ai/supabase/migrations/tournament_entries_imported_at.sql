-- ============================================
-- tournament_entries.imported_at — track which signups have been
-- pushed into the legacy event_players model
-- ============================================
-- For mixer-format events where public signups go into tournament_entries,
-- the director can click "Import to event" to create players + event_players
-- rows for each confirmed signup. We mark imported_at so re-clicking the
-- button doesn't double-import.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tournament_entries_imported
  ON tournament_entries(event_id) WHERE imported_at IS NULL;
