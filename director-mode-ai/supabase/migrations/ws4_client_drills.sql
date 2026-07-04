-- Coach Mode: drills a coach assigns to a specific player.
create table if not exists client_drills (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references lesson_clients(id) on delete cascade,
  coach_id  uuid references lesson_coaches(id) on delete set null,
  drill_id  uuid references drills(id) on delete set null,
  club_id   uuid references cc_clubs(id),
  note      text,
  status    text not null default 'assigned',   -- assigned | done
  assigned_at timestamptz not null default now()
);
create index if not exists client_drills_client_idx on client_drills(client_id);

alter table client_drills enable row level security;

drop policy if exists "coach manages assigned drills" on client_drills;
create policy "coach manages assigned drills" on client_drills for all to authenticated
  using (uid_owns_lesson_coach(coach_id) or uid_coaches_lesson_client(client_id))
  with check (uid_owns_lesson_coach(coach_id) or uid_coaches_lesson_client(client_id));

drop policy if exists "client reads assigned drills" on client_drills;
create policy "client reads assigned drills" on client_drills for select to authenticated
  using (uid_owns_lesson_client(client_id));
