-- Per-club Square: each club connects its OWN Square account (OAuth), and
-- class sign-ups / court bookings are paid into it and marked paid by webhook.

-- What the settings screen shows about the connection.
alter table club_payments add column if not exists provider_location_id text;
alter table club_payments add column if not exists provider_business_name text;

-- The club's Square tokens. Service role only: RLS on, no policies, so no
-- signed-in client can ever read them — not even the club's own staff.
create table if not exists club_payment_tokens (
  club_id uuid primary key references cc_clubs(id) on delete cascade,
  provider text not null,
  merchant_id text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table club_payment_tokens enable row level security;
create index if not exists club_payment_tokens_merchant on club_payment_tokens (merchant_id);

-- The Square order a checkout was opened for, and when it was paid.
alter table club_program_registrations add column if not exists square_order_id text;
alter table club_program_registrations add column if not exists paid_at timestamptz;
alter table court_bookings add column if not exists square_order_id text;
alter table court_bookings add column if not exists paid_at timestamptz;
