-- Ask Claude metering (2026-10-09). One row per assistant request, priced at the
-- moment it ran, so a later rate change never rewrites what a club was shown.
-- Money is stored in micro-dollars (1 USD = 1,000,000) — a single request is a
-- fraction of a cent and rounding each one to cents would lose most of the bill.
create table if not exists ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  billing_user_id uuid not null,
  user_id uuid not null,
  club_id uuid,
  created_at timestamptz not null default now(),
  source text not null default 'assistant',
  model text not null,
  rounds int not null default 1,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_micro bigint not null default 0,      -- what Anthropic charges us
  billed_micro bigint not null default 0,    -- what the club pays
  exempt boolean not null default false,     -- platform owner: metered, never invoiced
  page text
);
create index if not exists ai_usage_events_bill_month on ai_usage_events (billing_user_id, created_at);
alter table ai_usage_events enable row level security;
-- No policies: written and read only by the server with the service role.

-- One row per overage notice sent, so each $10 step is announced exactly once.
create table if not exists ai_overage_notices (
  billing_user_id uuid not null,
  period date not null,          -- first day of the month (UTC)
  step int not null,             -- 1 = first $10 over, 2 = $20 over, ...
  sent_at timestamptz not null default now(),
  primary key (billing_user_id, period, step)
);
alter table ai_overage_notices enable row level security;
