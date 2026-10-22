-- One row per billable send (email or text), priced in cents at send time.
-- Ask Claude keeps its own ai_usage_events (micro-dollars, token detail); the
-- usage report adds the two together for the single "ClubMode usage" charge.
-- Written only by the service role; a club owner can read their own rows.
create table if not exists public.usage_events (
  id bigserial primary key,
  billing_user_id uuid not null,
  user_id uuid,
  club_id uuid,
  kind text not null check (kind in ('email', 'sms')),
  units integer not null default 1 check (units > 0),
  billed_cents integer not null check (billed_cents >= 0),
  exempt boolean not null default false,
  ref text,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_billing_created
  on public.usage_events (billing_user_id, created_at);

alter table public.usage_events enable row level security;

drop policy if exists usage_events_owner_read on public.usage_events;
create policy usage_events_owner_read on public.usage_events
  for select using (billing_user_id = auth.uid());
