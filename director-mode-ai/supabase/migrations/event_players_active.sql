-- Soft-delete flag so directors can remove a player mid-event (late departure) without
-- losing their completed-match history. Generator + UI filter on active = true; standings
-- calculations ignore the flag so prior results remain intact.
ALTER TABLE event_players ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
