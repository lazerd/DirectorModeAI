-- Marketing contact lists that outlive any one event — first use: every family
-- that has played in, signed up for, or been invited to a Dunkin' event, so a
-- Dunkin' SERIES can be promoted to a long list instead of rebuilding it each
-- time from whichever past events happen to be ticked.
--
-- One row per family email per list. `players` accumulates the kids seen on
-- that address; `sources` records every way the family reached the list
-- (e.g. 'quad:dunkin-quads-oct-3', 'rspa:1715', 'promo:2026-09-03').
-- Opt-outs are NOT stored here: every send already checks email_unsubscribes.
create table if not exists public.promo_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  list_key text not null,                -- 'sponsor:dunkin'
  email text not null,                   -- lower-cased
  parent_name text,
  players text[] not null default '{}',
  sources text[] not null default '{}',
  last_division text,
  first_added_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (owner_id, list_key, email)
);

create index if not exists promo_contacts_list on public.promo_contacts (owner_id, list_key);

-- Service role only (campaign sources + signup route run as admin).
alter table public.promo_contacts enable row level security;

-- Merge a family into a list: add the player and source if new, keep the
-- first parent name we learned, bump last_seen. Safe to call on every signup.
create or replace function public.upsert_promo_contact(
  p_owner uuid,
  p_list text,
  p_email text,
  p_parent text,
  p_player text,
  p_source text,
  p_division text default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into promo_contacts as c (owner_id, list_key, email, parent_name, players, sources, last_division)
  values (
    p_owner, p_list, lower(trim(p_email)), nullif(trim(p_parent), ''),
    case when nullif(trim(p_player), '') is null then '{}' else array[trim(p_player)] end,
    case when p_source is null then '{}' else array[p_source] end,
    p_division
  )
  on conflict (owner_id, list_key, email) do update set
    parent_name = coalesce(c.parent_name, excluded.parent_name),
    -- Same kid typed with different capitals ('Sloane orvis') is one kid; keep
    -- the capitalised spelling (uppercase sorts first).
    players = (select coalesce(array_agg(x order by x), '{}') from (
                 select distinct on (lower(x)) x from unnest(c.players || excluded.players) x order by lower(x), x collate "C"
               ) d),
    sources = (select coalesce(array_agg(distinct x), '{}') from unnest(c.sources || excluded.sources) x),
    last_division = coalesce(excluded.last_division, c.last_division),
    last_seen_at = now();
$$;

revoke all on function public.upsert_promo_contact(uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- Tidy rows merged before the case-insensitive rule.
update public.promo_contacts c set players = (
  select coalesce(array_agg(x order by x), '{}') from (
    select distinct on (lower(x)) x from unnest(c.players) x order by lower(x), x collate "C"
  ) d
);
