-- clubmode.ai is members-only (11/25/26). A code from Darrin opens the door; the
-- code is how a director finds out what's inside. Server-only: RLS on, no policies.
create table if not exists member_codes (
  code text primary key,              -- stored UPPERCASE
  label text,                         -- who it's for
  max_uses int,                       -- null = unlimited
  uses int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table member_codes enable row level security;

insert into member_codes (code, label, max_uses) values
  ('FOUNDER', 'Darrin: for showing people in person', null),
  ('BELVEDERE', 'Anoosh, Belvedere Tennis Club', 25),
  ('DIABLO', 'Marco, Diablo Country Club', 25)
on conflict (code) do nothing;
