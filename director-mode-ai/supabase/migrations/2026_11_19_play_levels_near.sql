-- /play: levels as numbers, public listing for "near me", weekly series, need-one alerts.
alter table play_events add column if not exists level_min numeric;
alter table play_events add column if not exists level_max numeric;
alter table play_events add column if not exists listed boolean not null default false;
alter table play_events add column if not exists repeat_weekly boolean not null default false;
alter table play_rsvps add column if not exists level_num numeric;
create index if not exists play_events_listed_idx on play_events (listed, status, starts_at) where listed;

create table if not exists play_alerts (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  email       text not null,
  sport       text not null check (sport in ('tennis','pickleball','padel')),
  level       numeric,
  lat         double precision not null,
  lng         double precision not null,
  radius_mi   numeric not null default 10,
  place_label text,
  created_at  timestamptz not null default now(),
  last_sent_at timestamptz
);
create unique index if not exists play_alerts_email_sport_idx on play_alerts (lower(email), sport);
alter table play_alerts enable row level security;

create table if not exists play_alert_sends (
  alert_id uuid not null references play_alerts(id) on delete cascade,
  event_id uuid not null references play_events(id) on delete cascade,
  sent_at  timestamptz not null default now(),
  primary key (alert_id, event_id)
);
alter table play_alert_sends enable row level security;
