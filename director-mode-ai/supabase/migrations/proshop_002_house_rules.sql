-- House rules: what each staff member has been taught about THIS club.
-- One row per club + staff member in proshop_agents; agent = 'club' holds club-wide facts.
-- rules = [{ text, source: 'seed'|'director', at }]. Injected into every Ask Claude answer
-- for the club (web and text). Directors add more by saying "remember ..." to any staff member.
ALTER TABLE proshop_agents ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '[]'::jsonb;
