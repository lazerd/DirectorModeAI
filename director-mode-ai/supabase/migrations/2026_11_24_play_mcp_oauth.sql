-- Racquets IRL AI connector sign-in (Darrin 11/24/26).
-- Only the Claude / ChatGPT connection (/api/mcp) signs in, with an emailed 6-digit code.
-- The web game pages stay no-login (Kevin). ChatGPT blocks tools that pass a game's host
-- key around as an argument, so the connector now knows the organizer from an OAuth token
-- and looks up each game's host key itself.

create table if not exists play_organizers (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table play_events add column if not exists organizer_id uuid references play_organizers(id) on delete set null;
create index if not exists play_events_organizer_idx on play_events(organizer_id, created_at desc);

-- Dynamically registered OAuth clients (Claude, ChatGPT). Public clients: PKCE, no secret.
create table if not exists mcp_oauth_clients (
  client_id     text primary key,
  client_name   text,
  redirect_uris text[] not null,
  created_at    timestamptz not null default now()
);

-- Emailed sign-in codes (hashed), with attempt counting.
create table if not exists mcp_login_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  attempts    int not null default 0,
  ip          text,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists mcp_login_codes_email_idx on mcp_login_codes(email, created_at desc);
create index if not exists mcp_login_codes_ip_idx on mcp_login_codes(ip, created_at desc);

-- Authorization codes and tokens: only hashes are stored.
create table if not exists mcp_oauth_grants (
  hash          text primary key,
  kind          text not null check (kind in ('code','access','refresh')),
  client_id     text not null,
  organizer_id  uuid not null references play_organizers(id) on delete cascade,
  redirect_uri  text,
  code_challenge text,
  scope         text,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists mcp_oauth_grants_org_idx on mcp_oauth_grants(organizer_id);

alter table play_organizers enable row level security;
alter table mcp_oauth_clients enable row level security;
alter table mcp_login_codes enable row level security;
alter table mcp_oauth_grants enable row level security;
