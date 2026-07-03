-- Fix self-referential RLS recursion on cc_club_members (its policies query
-- cc_club_members, which re-triggers the policies). Route the checks through
-- SECURITY DEFINER helpers that bypass RLS. This also unblocks any table whose
-- policy subqueries cc_club_members (courts, reservations, etc.).
create or replace function public.is_club_staff(target_club uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select exists (select 1 from cc_club_members m
                 where m.club_id = target_club and m.user_id = auth.uid()
                   and m.role in ('owner','director'));
$$;

drop policy if exists "Members can view club roster" on cc_club_members;
create policy "Members can view club roster" on cc_club_members for select to public
  using (is_club_member(club_id));

drop policy if exists "Owners and directors manage memberships" on cc_club_members;
create policy "Owners and directors manage memberships" on cc_club_members for all to public
  using (is_club_staff(club_id) or exists (select 1 from cc_clubs c where c.id = cc_club_members.club_id and c.owner_id = auth.uid()))
  with check (is_club_staff(club_id) or exists (select 1 from cc_clubs c where c.id = cc_club_members.club_id and c.owner_id = auth.uid()));
