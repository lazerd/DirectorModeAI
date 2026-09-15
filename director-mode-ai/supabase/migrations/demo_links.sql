-- One-link demos for sales prospects.
--
-- A prospect gets ONE URL, /demo/<token>. It opens a tour of their own club
-- and lets them step inside as a demo member or a demo board member without a
-- password. The token is the credential, so:
--
--   - it is long and random (>= 24 chars, enforced below), never guessable;
--   - it can expire and be revoked (active = false) without touching accounts;
--   - it only ever points at demo accounts. scripts/demo-link.mjs refuses a
--     platform owner or anyone who owns a club or holds `owner` anywhere,
--     because minting a session from a URL for a real account would be a
--     skeleton key.
--
-- RLS on with no policies, same as impersonation_log: nothing reads this
-- through a user's session. The app reads it with the service role only.
create table if not exists demo_links (
  token text primary key check (length(token) >= 24),
  club_id uuid not null references cc_clubs(id) on delete cascade,
  label text,
  member_user_id uuid references auth.users(id) on delete set null,
  director_user_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count integer not null default 0
);

-- What the staff login is called on this club's tour and banner. A club run
-- by a volunteer board has no "tennis director"; its link says "board member".
-- Wording only: the account's cc_club_members role is still `director`.
alter table demo_links add column if not exists director_label text not null default 'tennis director';

alter table demo_links enable row level security;
revoke all on demo_links from anon, authenticated;

create index if not exists demo_links_member_idx on demo_links (member_user_id);
create index if not exists demo_links_director_idx on demo_links (director_user_id);
create index if not exists demo_links_club_idx on demo_links (club_id);

-- A club whose data is invented for a demo. Every outbound email that can be
-- attributed to it is suppressed (src/lib/demo/emailGuard.ts), and its club
-- site says "Demo Environment" instead of the draft banner.
alter table cc_clubs add column if not exists demo_mode boolean not null default false;

update cc_clubs set demo_mode = true where slug = 'rossmoor-tennis-club';
