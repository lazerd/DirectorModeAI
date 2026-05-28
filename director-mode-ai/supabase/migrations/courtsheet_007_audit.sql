-- ============================================
-- CourtSheet AI — Phase 1 / Migration 007
-- `courtsheet_audit_log` — who/what/when for every plan.
-- ============================================
-- Every preview the AI generates, every confirm, every manual UI edit
-- writes one row. The diff field holds the reverse-plan so Undo can
-- replay it even months later.
--
-- The two action verbs matter:
--   plan_previewed   — model emitted a Plan; nothing was written
--   plan_applied     — Plan was confirmed and committed in a transaction
--   plan_rejected    — user dismissed the preview
--   reservation_edit — direct UI edit (drag/resize/click-edit, no AI)
--   signup_added / signup_cancelled / signup_promoted
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS courtsheet_audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id         UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL
                    CHECK (action IN (
                      'plan_previewed','plan_applied','plan_rejected',
                      'reservation_edit','reservation_cancel',
                      'signup_added','signup_cancelled','signup_promoted'
                    )),
  -- The structured intent the AI emitted (if AI-sourced).
  intent          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Full diff: { created: [...], modified: [...], cancelled: [...], reverse: {...} }.
  -- `reverse` is what Undo replays.
  diff            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Stable id so a preview row pairs with its applied/rejected follow-up.
  plan_id         UUID,
  -- Source channel: 'ai' (the command widget), 'ui' (manual sheet edit),
  -- 'api' (an external/tool integration), 'cron'.
  channel         TEXT NOT NULL DEFAULT 'ui'
                    CHECK (channel IN ('ai','ui','api','cron')),
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_club_time ON courtsheet_audit_log(club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_plan ON courtsheet_audit_log(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_actor ON courtsheet_audit_log(actor_user_id, created_at DESC);

ALTER TABLE courtsheet_audit_log ENABLE ROW LEVEL SECURITY;

-- Anyone in the club can read its audit log.
DROP POLICY IF EXISTS "Club members read audit" ON courtsheet_audit_log;
CREATE POLICY "Club members read audit" ON courtsheet_audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = courtsheet_audit_log.club_id
        AND m.user_id = auth.uid()
    )
  );

-- Service role writes audit rows. Authenticated users cannot insert
-- directly — the engine inserts via the admin client.
DROP POLICY IF EXISTS "No direct audit inserts" ON courtsheet_audit_log;
CREATE POLICY "No direct audit inserts" ON courtsheet_audit_log
  FOR INSERT WITH CHECK (false);
