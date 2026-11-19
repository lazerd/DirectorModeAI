-- CourtConnect "one link runs the night" (clubmode.ai/play → clubmode.ai/p/<code>).
-- Anyone can host: no account, no club. The host holds a secret host_key (kept in their browser);
-- each player who joins holds their own player_key. All reads and writes go through
-- /api/p routes with the service role, so RLS is on with no policies (nothing public).

create table if not exists play_events (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  host_key      text not null,
  host_name     text,
  title         text not null,
  sport         text not null default 'tennis' check (sport in ('tennis','pickleball')),
  kind          text not null default 'social' check (kind in ('game','social')),
  format        text not null default 'doubles' check (format in ('doubles','mixed-doubles','singles')),
  when_text     text,
  starts_at     timestamptz,
  location      text,
  level         text,
  spots         int not null default 8 check (spots between 2 and 96),
  courts        int not null default 2 check (courts between 1 and 24),
  round_minutes int not null default 20 check (round_minutes between 5 and 120),
  notes         text,
  status        text not null default 'open' check (status in ('open','live','done')),
  state         jsonb not null default '{}'::jsonb,   -- {mixer: GuestMixer, roundStartedAt}
  version       int not null default 0,
  parent_id     uuid references play_events(id) on delete set null,
  source_text   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists play_rsvps (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references play_events(id) on delete cascade,
  name        text not null,
  gender      text check (gender in ('male','female')),
  level       text,
  player_key  text not null,
  status      text not null default 'in' check (status in ('in','wait','out')),
  is_host     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists play_rsvps_event_idx on play_rsvps(event_id, created_at);

alter table play_events enable row level security;
alter table play_rsvps enable row level security;
