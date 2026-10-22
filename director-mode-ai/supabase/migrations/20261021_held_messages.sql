-- Emails a club tried to send before it had a card on file. Held, not dropped:
-- the moment the club owner adds a card (their "ClubMode usage" subscription
-- goes active) they are sent in order and marked released. Service role only;
-- the owner can see what is waiting.
create table if not exists public.held_messages (
  id bigserial primary key,
  billing_user_id uuid not null,
  user_id uuid not null,
  club_id uuid,
  kind text not null default 'email' check (kind in ('email')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index if not exists held_messages_waiting
  on public.held_messages (billing_user_id, created_at)
  where released_at is null;

alter table public.held_messages enable row level security;

drop policy if exists held_messages_owner_read on public.held_messages;
create policy held_messages_owner_read on public.held_messages
  for select using (billing_user_id = auth.uid());
