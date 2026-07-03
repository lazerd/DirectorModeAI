-- Fix infinite RLS recursion between lesson_clients <-> lesson_client_coaches
-- by moving cross-table checks into SECURITY DEFINER functions (bypass RLS).
create or replace function public.uid_owns_lesson_client(cid uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select exists(select 1 from lesson_clients where id=cid and profile_id=auth.uid());
$$;
create or replace function public.uid_owns_lesson_coach(coid uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select exists(select 1 from lesson_coaches where id=coid and profile_id=auth.uid());
$$;
create or replace function public.uid_coaches_lesson_client(cid uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select exists(select 1 from lesson_client_coaches lcc join lesson_coaches lc on lc.id=lcc.coach_id
                where lcc.client_id=cid and lc.profile_id=auth.uid());
$$;

drop policy if exists "coach reads their clients" on lesson_clients;
create policy "coach reads their clients" on lesson_clients for select to authenticated
  using (uid_coaches_lesson_client(id));

drop policy if exists "client or coach manages link" on lesson_client_coaches;
create policy "client or coach manages link" on lesson_client_coaches for all to authenticated
  using (uid_owns_lesson_client(client_id) or uid_owns_lesson_coach(coach_id))
  with check (uid_owns_lesson_client(client_id) or uid_owns_lesson_coach(coach_id));
