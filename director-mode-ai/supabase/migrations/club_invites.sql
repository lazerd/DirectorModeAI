-- Inviting people into a club, by name and by role.
--
-- Until now a club had exactly one way in: a shared join code that granted
-- `member`, after which the owner had to find the person and promote them by
-- hand. That is fine for members and wrong for staff — a pro should be invited
-- AS a pro, and the thing that makes them staff must not be a string that can
-- be forwarded.
--
-- An invite is therefore per-person: bound to an email, single use, expiring,
-- revocable, and it carries the role the director chose. The shared code stays
-- exactly what it is — a members' door.

CREATE TABLE IF NOT EXISTS cc_club_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  email       text NOT NULL,
  -- Only roles a director may hand out. 'owner' is deliberately not invitable.
  role        text NOT NULL CHECK (role IN ('director','coach','front_desk','member')),
  token       text NOT NULL UNIQUE,
  invited_by  uuid,
  invited_name text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at  timestamptz
);

CREATE INDEX IF NOT EXISTS cc_club_invites_club_idx ON cc_club_invites (club_id, created_at DESC);
-- One live invite per person per club; a re-invite updates rather than piles up.
CREATE UNIQUE INDEX IF NOT EXISTS cc_club_invites_open_idx
  ON cc_club_invites (club_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE cc_club_invites ENABLE ROW LEVEL SECURITY;
-- No authenticated policy on purpose: an invite token is a credential, so every
-- read and write goes through service-role routes that check who is asking.
