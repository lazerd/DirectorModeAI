-- ClubMode Recruiting: pay only when you hire.
-- A club posts (or we detect) an opening and accepts the placement terms.
-- AI ranks and invites candidates; candidates apply with their résumé and
-- explicit consent; the club runs its process in the pipeline; when an
-- introduced candidate starts, a placement is recorded and the flat fee is due.
-- All cross-user reads/writes go through service-role APIs with explicit checks.

-- Openings: placement terms + public job board fields.
alter table public.connect_openings
  add column if not exists placement_fee_cents integer not null default 495000,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists is_public boolean not null default true,
  add column if not exists requirements text,
  add column if not exists job_url text,
  add column if not exists deadline date,
  add column if not exists city text,
  add column if not exists state text;

-- Candidates: résumé + a short experience summary the AI scores against.
alter table public.connect_candidates
  add column if not exists resume_path text,
  add column if not exists resume_filename text,
  add column if not exists resume_uploaded_at timestamptz,
  add column if not exists experience_summary text,
  add column if not exists certifications text,
  add column if not exists linkedin_url text;

-- One row per candidate per opening. Stage moves forward through the hiring process.
create table if not exists public.connect_applications (
  id uuid primary key default gen_random_uuid(),
  opening_id uuid not null references public.connect_openings(id) on delete cascade,
  candidate_id uuid not null references public.connect_candidates(id) on delete cascade,
  source text not null default 'self_apply',      -- 'ai_invite' | 'self_apply'
  stage text not null default 'applied',          -- invited|applied|screening|interviewing|offer|hired|declined|withdrawn
  cover_note text,
  resume_path text,                               -- snapshot of the résumé submitted with this application
  consent_at timestamptz,                         -- candidate authorized submission to this club
  introduced_at timestamptz,                      -- attribution clock starts here
  ai_fit_score integer,                           -- 0-100
  ai_fit jsonb,                                   -- {summary, strengths[], gaps[], questions[]}
  ai_fit_at timestamptz,
  club_notes text,
  hired_at timestamptz,
  start_date date,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opening_id, candidate_id)
);
create index if not exists idx_connect_applications_opening on public.connect_applications(opening_id);
create index if not exists idx_connect_applications_candidate on public.connect_applications(candidate_id);
alter table public.connect_applications enable row level security;

drop policy if exists connect_applications_candidate_read on public.connect_applications;
create policy connect_applications_candidate_read on public.connect_applications
  for select using (candidate_id in (select id from public.connect_candidates where profile_id = auth.uid()));

-- A successful placement = the fee event.
create table if not exists public.connect_placements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.connect_applications(id) on delete restrict,
  opening_id uuid not null references public.connect_openings(id) on delete restrict,
  candidate_id uuid not null references public.connect_candidates(id) on delete restrict,
  club_owner_id uuid not null,
  fee_cents integer not null,
  terms_version text,
  start_date date,
  status text not null default 'pending_start',   -- pending_start | due | paid | waived | refunded
  guarantee_until date,
  invoice_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.connect_placements enable row level security;
drop policy if exists connect_placements_owner_read on public.connect_placements;
create policy connect_placements_owner_read on public.connect_placements
  for select using (club_owner_id = auth.uid());

-- Private résumé storage; served to clubs only through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;
