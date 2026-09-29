-- Public SMS opt-in (/sms). One row per consent event; the proof carriers ask for.
create table if not exists public.sms_consents (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  name text not null,
  email text,
  club_or_team text,
  consent_text text not null,
  source text not null default 'web:/sms',
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists sms_consents_phone_idx on public.sms_consents (phone_e164);
alter table public.sms_consents enable row level security;
-- No policies: only the service role (API route) reads or writes.
