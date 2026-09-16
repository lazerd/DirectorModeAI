-- =====================================================================
-- Region as a column, and a flag the outreach deck can read.
--
-- Additive to crm.sql. Two columns, both nullable, neither with a default —
-- nothing that already exists changes shape, and a re-run is a no-op.
--
-- WHY region MOVES OUT OF notes: scripts/import-dca.mjs wrote the region as
-- the first sentence of crm_orgs.notes ("DCA East region. From the
-- members-only directory…"). That is fine prose and useless data: you cannot
-- filter a cold list of 519 clubs by a substring of a paragraph without
-- either a LIKE scan or a regex in the UI, and the moment a rep edits the
-- notes — which is the whole point of the notes — the region is gone. The
-- sentence stays where it is; this is the copy the app reads.
--
-- WHY queued_at LIVES HERE: the outreach deck (/crm/deck) is being built
-- alongside this with its own crm_outreach_* tables. Selecting rows on the
-- cold list and saying "add these to the outreach queue" has to write
-- something today, before that table exists, or the button is a lie. A
-- timestamp on the org is the smallest thing that is true either way: the
-- deck reads `queued_at is not null` to find what a rep asked for, and if the
-- deck never ships it is a harmless "we meant to write to these".
--
-- Run: node scripts/dbrun.mjs supabase/migrations/crm_region.sql
-- Safe to re-run.
-- =====================================================================

ALTER TABLE public.crm_orgs ADD COLUMN IF NOT EXISTS region     text;
ALTER TABLE public.crm_orgs ADD COLUMN IF NOT EXISTS queued_at  timestamptz;

-- The cold list filters on these two and sorts on name; 519 rows is small
-- enough that Postgres may well seq-scan anyway, but the indexes cost nothing
-- and the list is the screen a rep lives on.
CREATE INDEX IF NOT EXISTS crm_orgs_region_idx ON public.crm_orgs (region) WHERE region IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_orgs_queued_idx ON public.crm_orgs (queued_at) WHERE queued_at IS NOT NULL;

-- --------------------------------------------------------------- backfill
--
-- Only ever fills a NULL. A rep who has corrected a region by hand keeps
-- their correction on every subsequent run, and the notes remain the source
-- of the first guess rather than a standing authority.
--
-- The pattern is the one lib/crm/region.ts uses, character for character:
-- "DCA <Word> region." at the start of the notes. "DCA member club (region
-- not recorded)." matches nothing and stays NULL, which is the honest answer
-- for those 117 clubs.
UPDATE public.crm_orgs
   SET region = initcap(substring(notes from 'DCA ([A-Za-z]+) region\.'))
 WHERE region IS NULL
   AND notes IS NOT NULL
   AND substring(notes from 'DCA ([A-Za-z]+) region\.') IS NOT NULL;
