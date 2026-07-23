-- ============================================
-- CalendarMode — per-event reminder cadences
-- ============================================
-- A director sets, per event: "three reminders — 30 days out, 15 days out,
-- the night before the signup deadline — plus a same-day 'see you at 7pm
-- tonight'." A daily cron then actually sends them.
--
-- Two columns and one table:
--
--   calendar_items.reminder_cadence  the rules (jsonb array)
--   calendar_items.signup_deadline   the second anchor. Offsets are counted
--                                    from either the EVENT date or the
--                                    SIGNUP DEADLINE, because "the night
--                                    before the deadline" and "the morning
--                                    of the event" are different dates and
--                                    directors want both.
--
--   calendar_reminder_sends          one row per (item, rule) actually sent.
--
-- The UNIQUE(item_id, rule_id) constraint on that table is the whole point:
-- it makes a double-send impossible at the DATABASE level, not merely
-- unlikely. A cron that retries, two overlapping invocations, or a redeploy
-- mid-run all collide on the index instead of mailing the membership twice.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE calendar_items
  ADD COLUMN IF NOT EXISTS reminder_cadence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signup_deadline DATE;

CREATE TABLE IF NOT EXISTS calendar_reminder_sends (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  item_id       UUID NOT NULL REFERENCES calendar_items(id) ON DELETE CASCADE,

  -- Stable id of the rule inside reminder_cadence. Editing a rule's offset
  -- keeps its id, so a reminder already sent is never re-sent just because
  -- the director nudged the date.
  rule_id       TEXT NOT NULL,

  -- The date the rule resolved to when it fired, kept for the audit trail.
  scheduled_for DATE NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  recipients    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'partial', 'failed', 'skipped')),
  detail        TEXT,

  -- Distinguishes an automatic send from a director pressing "send now".
  triggered_by  TEXT NOT NULL DEFAULT 'cron'
                  CHECK (triggered_by IN ('cron', 'manual')),

  CONSTRAINT calendar_reminder_sends_once UNIQUE (item_id, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_reminder_sends_item
  ON calendar_reminder_sends(item_id);
CREATE INDEX IF NOT EXISTS idx_calendar_reminder_sends_club
  ON calendar_reminder_sends(club_id, sent_at DESC);

-- Lets the daily cron find candidate items without scanning every plan.
CREATE INDEX IF NOT EXISTS idx_calendar_items_reminders
  ON calendar_items(target_date)
  WHERE reminder_cadence <> '[]'::jsonb AND target_date IS NOT NULL;

ALTER TABLE calendar_reminder_sends ENABLE ROW LEVEL SECURITY;

-- Members can see that reminders went out; only staff can write.
-- (The cron uses the service role and bypasses both.)
DROP POLICY IF EXISTS calendar_reminder_sends_read ON calendar_reminder_sends;
CREATE POLICY calendar_reminder_sends_read ON calendar_reminder_sends FOR SELECT
  USING (is_club_member(club_id));

DROP POLICY IF EXISTS calendar_reminder_sends_write ON calendar_reminder_sends;
CREATE POLICY calendar_reminder_sends_write ON calendar_reminder_sends FOR ALL
  USING (is_club_staff(club_id)) WITH CHECK (is_club_staff(club_id));
