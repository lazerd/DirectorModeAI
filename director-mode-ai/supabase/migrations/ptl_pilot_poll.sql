-- PTL pilot-planning poll.
--
-- The task force (NorCal staff + volunteers) can't all get on one call, so each
-- person answers the pilot questions on their own and Claude reads the whole
-- set. One row per person per poll: re-submitting with the same email updates
-- the earlier answers instead of adding a second vote.
--
-- RLS on, no policies: only the service role (API routes) reads or writes.

CREATE TABLE IF NOT EXISTS ptl_poll_responses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_slug   text NOT NULL,
  name        text NOT NULL,
  email       text NOT NULL,
  answers     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ptl_poll_responses_one_per_person
  ON ptl_poll_responses (poll_slug, lower(email));

CREATE TABLE IF NOT EXISTS ptl_poll_analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_slug       text NOT NULL,
  response_count  int NOT NULL,
  analysis        jsonb NOT NULL,
  model           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ptl_poll_analyses_latest
  ON ptl_poll_analyses (poll_slug, created_at DESC);

ALTER TABLE ptl_poll_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ptl_poll_analyses  ENABLE ROW LEVEL SECURITY;
