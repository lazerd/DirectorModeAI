-- Pro Shop: the AI staff board for a club (clubmode.ai/proshop).
--
--   proshop_tasks   one row per order or proposal. Directors give orders (source='director',
--                   status 'waiting'); staff propose work (source='staff', status 'proposed')
--                   that the director approves or skips. Work then moves
--                   doing -> done (with a one-line note) or declined.
--   proshop_board   one JSON doc per club and key: 'huddle', 'letter', 'stats'.
--   proshop_agents  per club and staff member: the "Right now" lines.
--
-- All access goes through /api/proshop/* with the service role after a club check,
-- so RLS is on with no policies (no direct client access).

CREATE TABLE IF NOT EXISTS proshop_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  agent       text NOT NULL,
  text        text NOT NULL CHECK (char_length(text) <= 600),
  status      text NOT NULL DEFAULT 'waiting'
              CHECK (status IN ('waiting','proposed','approved','doing','done','declined')),
  source      text NOT NULL DEFAULT 'director' CHECK (source IN ('director','staff')),
  created_by  uuid,
  detail      text,
  money       text,
  note        text,
  play        text,
  run         text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  decided_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proshop_tasks_club_created ON proshop_tasks (club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS proshop_tasks_club_status ON proshop_tasks (club_id, status);

CREATE TABLE IF NOT EXISTS proshop_board (
  club_id     uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key IN ('huddle','letter','stats')),
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, key)
);

CREATE TABLE IF NOT EXISTS proshop_agents (
  club_id     uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  agent       text NOT NULL,
  now_lines   jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, agent)
);

ALTER TABLE proshop_tasks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE proshop_board  ENABLE ROW LEVEL SECURITY;
ALTER TABLE proshop_agents ENABLE ROW LEVEL SECURITY;
