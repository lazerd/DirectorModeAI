-- ClubMode Recruiting: founding network referrals, candidate self-delete, placement audit trail.
-- All tables are service-role only (RLS on, no policies) except where noted.

-- 1. Referrals. Each candidate gets one private code; a row in connect_referrals is
--    recorded when someone who arrived through that code saves their FIRST profile.
alter table public.connect_candidates
  add column if not exists referral_code text,
  add column if not exists referred_by uuid references public.connect_candidates(id) on delete set null,
  -- Set when the candidate deletes their profile: personal fields are scrubbed, the row
  -- stays only so placement records (billing) keep their foreign key.
  add column if not exists deleted_at timestamptz;
create unique index if not exists uq_connect_candidates_referral_code on public.connect_candidates(referral_code) where referral_code is not null;

create table if not exists public.connect_referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  referrer_candidate_id uuid not null references public.connect_candidates(id) on delete cascade,
  referred_candidate_id uuid not null unique references public.connect_candidates(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_connect_referrals_referrer on public.connect_referrals(referrer_candidate_id);
alter table public.connect_referrals enable row level security; -- service role only

-- 2. Placement audit: who accepted the terms, and the candidate's name frozen on the
--    placement so the billing record survives a candidate deleting their profile.
alter table public.connect_openings add column if not exists terms_accepted_by uuid;
update public.connect_openings set terms_accepted_by = owner_id where terms_accepted_at is not null and terms_accepted_by is null;
alter table public.connect_placements add column if not exists candidate_name text;

-- 3. Every stage change on an application (club moves, candidate apply/withdraw, claim intros).
create table if not exists public.connect_application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.connect_applications(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  actor_id uuid,
  actor_role text,            -- 'club' | 'candidate' | 'platform' | 'system'
  note text,
  at timestamptz not null default now()
);
create index if not exists idx_connect_application_events_app on public.connect_application_events(application_id, at);
alter table public.connect_application_events enable row level security; -- service role only
