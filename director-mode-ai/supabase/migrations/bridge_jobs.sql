-- The club-computer bridge (11/25/26): jobs ClubMode can't do from the cloud because they need
-- the director's own logged-in tools on their PC (ClubSpot, the reimbursement scripts).
-- A small worker on that PC claims jobs, runs them, and posts results. Server-only.
create table if not exists bridge_jobs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid,
  user_id uuid,
  line_id uuid,
  kind text not null,                 -- clubspot_day | clubspot_block | reimburse
  input jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz
);
create index if not exists bridge_jobs_queue on bridge_jobs (status, created_at);
alter table bridge_jobs enable row level security;

alter table text_lines add column if not exists sent_alerts text[] not null default '{}';

create table if not exists bridge_workers (
  club_id uuid primary key,
  seen_at timestamptz not null default now(),
  info jsonb
);
alter table bridge_workers enable row level security;

-- Photos texted in (receipts etc.), kept until the bridge files them.
create table if not exists text_media (
  id uuid primary key default gen_random_uuid(),
  line_id uuid references text_lines(id) on delete cascade,
  mime text not null,
  data text not null,              -- base64
  created_at timestamptz not null default now()
);
alter table text_media enable row level security;
