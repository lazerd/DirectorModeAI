-- Per-event credential for no-login participant score entry.
--
-- WHY: participants at a mixer / team-battle must enter scores without creating
-- an account. The old path had PublicScoreDialog write to `matches` directly
-- from the browser with the anon key, but `anon` holds no UPDATE (or SELECT)
-- grant on `matches`, so every logged-out submission failed the policy check.
-- This mirrors the JTT pattern that already works: the token is the credential
-- and the write happens server-side via the service role
-- (POST /api/event/score/[token]).
--
-- WHY A SEPARATE TABLE, not an `events.score_token` column: `events` carries the
-- policy "Anyone can view events by code" (USING true) AND a table-level SELECT
-- grant to `anon`. A column on `events` is therefore world-readable, and a
-- column-level REVOKE does NOT override a table-level grant — the credential
-- would be published to exactly the people it gates. Keeping it in its own
-- table with zero anon/authenticated grants makes it reachable only by the
-- service role.
--
-- Additive and re-runnable. Changes no existing policy and no existing grant.

-- Undo the first (unsafe) attempt if it ran.
drop index if exists public.events_score_token_key;
alter table public.events drop column if exists score_token;

create table if not exists public.event_score_tokens (
  event_id   uuid primary key references public.events (id) on delete cascade,
  token      text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

create unique index if not exists event_score_tokens_token_key
  on public.event_score_tokens (token);

-- RLS on with NO policies = no access for anon or authenticated. The service
-- role bypasses RLS, so the token route still reads it.
alter table public.event_score_tokens enable row level security;

revoke all on public.event_score_tokens from anon, authenticated;

-- Backfill every existing event with a token.
insert into public.event_score_tokens (event_id)
select e.id from public.events e
on conflict (event_id) do nothing;

-- Every new event gets a token automatically, so the route never 404s on an
-- event created after this migration ran.
create or replace function public.add_event_score_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_score_tokens (event_id)
  values (new.id)
  on conflict (event_id) do nothing;
  return new;
end;
$$;

drop trigger if exists events_add_score_token on public.events;
create trigger events_add_score_token
  after insert on public.events
  for each row execute function public.add_event_score_token();
