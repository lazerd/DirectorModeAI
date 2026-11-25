-- Your staff, by text (11/25/26). A director's phone (SMS) or Telegram chat is a
-- "line" to their Pro Shop staff: a morning huddle, an evening recap, and any
-- message they send in. Server-only tables: RLS on, no policies.

create table if not exists text_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid not null,
  channel text not null check (channel in ('sms', 'telegram')),
  address text,                      -- +1XXXXXXXXXX, or the Telegram chat id once linked
  status text not null default 'pending' check (status in ('pending', 'active', 'stopped')),
  link_code text,                    -- 6 digits (SMS) or a Telegram /start code
  link_expires_at timestamptz,
  consent_text text,                 -- exactly what they agreed to, for SMS
  consent_ip text,
  morning boolean not null default true,
  evening boolean not null default true,
  menu jsonb not null default '[]'::jsonb,       -- the numbers in the last huddle: [{n, kind, ref, label}]
  awaiting jsonb,                                 -- the item a bare YES/SKIP answers
  history jsonb not null default '[]'::jsonb,    -- last turns with the staff
  last_morning date,
  last_evening date,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  stopped_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists text_lines_user_channel on text_lines (user_id, channel);
create unique index if not exists text_lines_address on text_lines (channel, address) where address is not null and status <> 'stopped';
alter table text_lines enable row level security;

create table if not exists text_messages (
  id bigserial primary key,
  line_id uuid references text_lines(id) on delete cascade,
  channel text not null,
  address text,
  direction text not null check (direction in ('in', 'out')),
  body text,
  kind text,                         -- huddle | recap | reply | code | system
  provider_id text,
  status text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists text_messages_line on text_messages (line_id, created_at desc);
alter table text_messages enable row level security;
