-- Season Builder: one pre-season blast to every adult member asking who wants to
-- play which USTA league, at what level, day or nights/weekends, and who will
-- captain. Answers land in a live head count the director turns into teams.
--
--   sb_campaigns  one per season push (e.g. "Winter 2027 USTA Leagues")
--   sb_invites    one per PlayerVault person emailed; the token is their link
--   sb_responses  one per person who answered (via their link, or the public
--                 newsletter link, which is matched back to a vault person)
--
-- No RLS policies: every read and write goes through server routes that check
-- staff on the club (requireStaffForClub) or re-derive scope from a token.

create table if not exists sb_campaigns (
  id                 uuid primary key default gen_random_uuid(),
  club_id            uuid not null references cc_clubs(id) on delete cascade,
  title              text not null,
  intro              text,
  sign_off           text,                   -- "Darrin Cohen, Director of Tennis"
  registration_opens date,
  reply_by           date,
  season_start       date,
  season_end         date,
  -- [{key, label, gender:'female'|'male'|'mixed', min_age, slots:['day','nights_weekends'], valid_through}]
  leagues            jsonb not null default '[]'::jsonb,
  public_token       text not null unique default encode(gen_random_bytes(16), 'hex'),
  status             text not null default 'draft' check (status in ('draft', 'sent', 'closed')),
  sent_at            timestamptz,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists sb_campaigns_club_idx on sb_campaigns (club_id);

create table if not exists sb_invites (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references sb_campaigns(id) on delete cascade,
  vault_player_id uuid references cc_vault_players(id) on delete set null,
  name            text not null,
  email           text not null,
  token           text not null unique default encode(gen_random_bytes(16), 'hex'),
  sent_at         timestamptz,
  send_error      text,
  created_at      timestamptz not null default now(),
  unique (campaign_id, vault_player_id)
);
create index if not exists sb_invites_campaign_idx on sb_invites (campaign_id);

create table if not exists sb_responses (
  id                     uuid primary key default gen_random_uuid(),
  campaign_id            uuid not null references sb_campaigns(id) on delete cascade,
  invite_id              uuid unique references sb_invites(id) on delete set null,
  vault_player_id        uuid references cc_vault_players(id) on delete set null,
  name                   text not null,
  email                  text,
  phone                  text,
  interested             boolean not null default true,
  gender                 text check (gender in ('female', 'male')),
  ntrp                   text,                      -- '3.5', or 'unrated'
  -- [{league:'w40', slot:'day'}, {league:'x18', slot:'nights_weekends'}]
  choices                jsonb not null default '[]'::jsonb,
  role                   text check (role in ('captain', 'play')),
  age_ok                 boolean,                   -- attested: turns 40 in the season year or older
  usta_expires           date,                      -- last day of the month they gave
  usta_unknown           boolean not null default false,
  needs_renewal          boolean not null default false,
  notes                  text,
  source                 text not null default 'invite' check (source in ('invite', 'public')),
  confirmation_sent_at   timestamptz,
  renewal_notice_sent_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists sb_responses_campaign_idx on sb_responses (campaign_id);

alter table sb_campaigns enable row level security;
alter table sb_invites   enable row level security;
alter table sb_responses enable row level security;
