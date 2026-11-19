-- Crown alerts: a player opts in with an email to hear when their crown at a place changes hands.
create table if not exists play_crown_watch (
  id         uuid primary key default gen_random_uuid(),
  place_slug text not null,
  name_key   text not null,      -- player's name, lowercased (players are names, no accounts)
  email      text not null,
  created_at timestamptz not null default now(),
  unique (place_slug, name_key, email)
);
alter table play_crown_watch enable row level security;

-- Restore a hosting pass on another phone: the pass's email gets a 6-digit code.
alter table play_passes add column if not exists extra_host_ids text[] not null default '{}';
create table if not exists play_pass_codes (
  id         uuid primary key default gen_random_uuid(),
  pass_id    uuid not null references play_passes(id) on delete cascade,
  host_id    text not null,
  code_hash  text not null,
  tries      int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table play_pass_codes enable row level security;
