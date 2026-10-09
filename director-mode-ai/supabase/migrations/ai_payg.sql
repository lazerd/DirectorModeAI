-- Ask Claude pay-as-you-go (2026-10-09). A club's AI overage is billed through a
-- separate metered LemonSqueezy subscription ("Ask Claude usage", $0.01/unit,
-- one unit = one cent of overage). Until the club owner opts in, Ask Claude
-- stops at the $5 included each month — Darrin never carries a club's AI bill.
create table if not exists ai_payg_subscriptions (
  user_id uuid primary key,                 -- the billing user (club owner)
  ls_subscription_id text,
  ls_subscription_item_id text,             -- where usage records are reported
  status text not null default 'active',    -- active | canceled
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table ai_payg_subscriptions enable row level security;

-- Cents of overage already reported to LemonSqueezy, per calendar month, so the
-- daily report only ever sends the increase since last time.
create table if not exists ai_usage_reports (
  billing_user_id uuid not null,
  period date not null,
  reported_cents int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (billing_user_id, period)
);
alter table ai_usage_reports enable row level security;
