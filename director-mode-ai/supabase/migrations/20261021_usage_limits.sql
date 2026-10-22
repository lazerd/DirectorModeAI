-- A club owner's monthly spending limit across emails, texts and Ask Claude.
-- One row per billing account (the club owner). NULL limit = no limit.
-- Written by the service role on the owner's behalf; the owner can read it.
create table if not exists public.usage_limits (
  billing_user_id uuid primary key,
  monthly_limit_cents integer check (monthly_limit_cents is null or monthly_limit_cents >= 0),
  updated_at timestamptz not null default now()
);

alter table public.usage_limits enable row level security;

drop policy if exists usage_limits_owner_read on public.usage_limits;
create policy usage_limits_owner_read on public.usage_limits
  for select using (billing_user_id = auth.uid());
