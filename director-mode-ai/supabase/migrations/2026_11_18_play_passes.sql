-- CourtConnect paid hosting (Darrin 11/18/26): joining is free; a host's FIRST event is free;
-- after that hosting needs a Host Pass ($25/yr) or a Club Pass ($100/yr, every member can host).
-- No accounts: a host is a device id (host_id, kept in their browser). Passes come from the
-- LemonSqueezy webhook (price_key cc_host / cc_club in custom data).

alter table play_events add column if not exists host_id text;
alter table play_events add column if not exists club_code text;
create index if not exists play_events_host_id_idx on play_events(host_id);

create table if not exists play_passes (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('host','club')),
  host_id            text,             -- the buyer's device
  email              text,
  club_name          text,
  club_code          text unique,      -- club passes: members open clubmode.ai/play?club=<code>
  ls_subscription_id text unique,
  ls_customer_id     text,
  status             text not null default 'active',
  renews_at          timestamptz,
  ends_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists play_passes_host_idx on play_passes(host_id);
alter table play_passes enable row level security;
