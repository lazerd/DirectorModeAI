-- CourtConnect go-to-market (Darrin + Kevin, 2026-10-27): every club gets
-- 1,000 free emails, then ONE member can sponsor the club, or the director pays.
--
-- A sponsor is a member who put their own card down for the club's sends. The
-- club's usage stays recorded under the club owner (billing_user_id, as for
-- every send); the sponsor's metered subscription is what gets charged for it.
-- One row per club account. A sponsor whose subscription lapses simply stops
-- counting: payerFor() checks ai_payg_subscriptions every time.

create table if not exists club_sponsors (
  billing_user_id uuid primary key,          -- the club owner's account the sends are recorded under
  sponsor_user_id uuid not null,              -- the member whose card pays
  club_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists club_sponsors_sponsor_idx on club_sponsors (sponsor_user_id);

alter table club_sponsors enable row level security;
-- Service role only: no policies on purpose.

comment on table club_sponsors is
  'A member paying for their club''s ClubMode sends (1,000 free emails, then a sponsor or the director). Max $30/month via the club''s usage limit.';
