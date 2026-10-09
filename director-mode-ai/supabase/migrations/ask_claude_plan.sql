-- Ask Claude is a $75/month-plan feature (Darrin, 2026-10-09: "ONLY the
-- 75/month peeps get the AI usage built in"). One row per paying club owner on
-- that plan, written only by the LemonSqueezy webhook with the service role.
-- Kept off `profiles` so the billing-column trigger stays the only gate there.
create table if not exists ask_claude_entitlements (
  user_id uuid primary key,                -- the billing user (club owner)
  ls_subscription_id text,
  status text not null default 'active',   -- active | canceled
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table ask_claude_entitlements enable row level security;
