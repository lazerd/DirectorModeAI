-- ============================================
-- Board Report — NPS responses
-- Member satisfaction survey responses, collected via a shareable club link
-- (front-desk QR, newsletter, email). The Board Report computes the monthly
-- Net Promoter Score from these rows. Additive, safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS nps_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES cc_clubs(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score >= 0 AND score <= 10),
  comment TEXT,
  respondent_name TEXT,
  respondent_email TEXT,
  source TEXT NOT NULL DEFAULT 'link', -- 'link' | 'qr' | 'email'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nps_responses_club_time
  ON nps_responses(club_id, created_at DESC);

ALTER TABLE nps_responses ENABLE ROW LEVEL SECURITY;

-- Writes and report reads both go through the service-role admin client, which
-- bypasses RLS. This policy lets club staff read their own responses directly
-- (e.g. a future in-app responses view) without exposing other clubs' data.
DROP POLICY IF EXISTS nps_responses_club_read ON nps_responses;
CREATE POLICY nps_responses_club_read ON nps_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = nps_responses.club_id
        AND m.user_id = auth.uid()
    )
  );
