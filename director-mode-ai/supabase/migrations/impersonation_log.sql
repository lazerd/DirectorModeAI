-- Who viewed the app as whom.
--
-- "View as" hands the owner a real session for another user, so every write
-- made while it is on is made in that person's name. The one thing that must
-- not be reconstructable-only-from-memory is who did it: this table is the
-- record, written on start and closed on exit.
--
-- RLS on with no policies is deliberate. Nothing in the app reads this table
-- through a user's session; it is service-role only, so a user cannot see —
-- or erase — the fact that they were impersonated.
create table if not exists impersonation_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  admin_email text,
  target_user_id uuid not null,
  target_email text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  reason text
);

alter table impersonation_log enable row level security;

create index if not exists impersonation_log_admin_idx
  on impersonation_log (admin_user_id, started_at desc);
