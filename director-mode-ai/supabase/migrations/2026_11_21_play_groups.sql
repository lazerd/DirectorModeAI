-- Racquets IRL "Groups" (Darrin, 11/21/26).
-- A host keeps named groups of players ("Saturday 4.0 tennis") and emails a new game's link
-- to everyone in one. Racquets IRL stays login-free: only SAVING a group asks the host to
-- sign in (passwordless email link), so groups belong to an auth user. Players never log in;
-- they opt in to email with a checkbox when they join a game.
--
-- Host Pass ($25/yr) includes 1,000 emails a month: play_email_sends is the meter.
-- Every blast carries a one-click unsubscribe; play_email_optouts is honored forever.
--
-- All reads and writes go through /api/p/groups routes with the service role, like the
-- other play_* tables: RLS on, no policies.

-- Players opting in at join (never shown to other players; view() does not select these).
alter table play_rsvps add column if not exists email text;
alter table play_rsvps add column if not exists email_opt_in boolean not null default false;

create table if not exists play_groups (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 60),
  sport          text,
  level          text,
  created_at     timestamptz not null default now()
);
create index if not exists play_groups_owner_idx on play_groups(owner_user_id, created_at);

create table if not exists play_group_members (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references play_groups(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 40),
  email            text,
  opted_in         boolean not null default false,
  unsubscribed_at  timestamptz,
  source_rsvp_id   uuid references play_rsvps(id) on delete set null,
  created_at       timestamptz not null default now()
);
create unique index if not exists play_group_members_name_uq on play_group_members(group_id, lower(name));
create index if not exists play_group_members_email_idx on play_group_members(lower(email)) where email is not null;

-- One row per blast; the monthly meter is sum(to_count) since the 1st (UTC).
create table if not exists play_email_sends (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  group_id       uuid references play_groups(id) on delete set null,
  event_code     text,
  to_count       int not null default 0 check (to_count >= 0),
  created_at     timestamptz not null default now()
);
create index if not exists play_email_sends_owner_idx on play_email_sends(owner_user_id, created_at);

-- Unsubscribes. owner_user_id null = every Racquets IRL host; group_id null = all of that
-- host's groups. Kept separately from play_group_members so removing and re-adding a
-- member can never resubscribe them.
create table if not exists play_email_optouts (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  owner_user_id  uuid references auth.users(id) on delete cascade,
  group_id       uuid references play_groups(id) on delete cascade,
  created_at     timestamptz not null default now()
);
create index if not exists play_email_optouts_email_idx on play_email_optouts(lower(email));

alter table play_groups enable row level security;
alter table play_group_members enable row level security;
alter table play_email_sends enable row level security;
alter table play_email_optouts enable row level security;
