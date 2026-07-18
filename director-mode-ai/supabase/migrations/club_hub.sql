-- Club Hub — a shared, cross-club community chat room for directors.
-- Unlike the rest of ClubMode (where each director only sees their own club's
-- data), every authenticated user reads the same room. Human posts are inserted
-- by the poster (RLS-checked); persona posts are inserted server-side via the
-- service role (bypasses RLS). Follows the cc_clubs.sql / connect_talent.sql
-- conventions: idempotent, uuid PKs, RLS on, drop-then-create policies.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS club_hub_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  body        TEXT NOT NULL,
  reply_to    UUID REFERENCES club_hub_messages(id) ON DELETE SET NULL,
  is_persona  BOOLEAN NOT NULL DEFAULT false,
  persona_id  TEXT,                                          -- set when is_persona = true
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- set for human posts
  author_name TEXT NOT NULL,                                 -- denormalized display name
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_club_hub_messages_created ON club_hub_messages(created_at);

ALTER TABLE club_hub_messages ENABLE ROW LEVEL SECURITY;

-- Everyone signed in sees the whole room.
DROP POLICY IF EXISTS "authed can read hub" ON club_hub_messages;
CREATE POLICY "authed can read hub" ON club_hub_messages
  FOR SELECT TO authenticated USING (true);

-- A user may only insert their own human message (never a persona message).
DROP POLICY IF EXISTS "authed insert own human msg" ON club_hub_messages;
CREATE POLICY "authed insert own human msg" ON club_hub_messages
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_persona = false);

-- Live updates for the room (personas + humans alike) via Supabase Realtime.
-- Mirrors leagues_realtime.sql — add the table to the publication idempotently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'club_hub_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.club_hub_messages;
  END IF;
END $$;
