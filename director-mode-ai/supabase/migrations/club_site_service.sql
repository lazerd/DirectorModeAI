-- The $75/mo site-service tier (SITE_SERVICE_PRICE_USD). Sold by conversation,
-- with no LemonSqueezy variant, so nothing writes this automatically: it is set
-- by hand with scripts/site-service.mjs when a club signs.
--
-- Non-null = the club is on the tier. Every captain at the club gets
-- CaptainMode included (src/lib/captain/access.ts, siteServiceClubFor).
alter table cc_clubs add column if not exists site_service_since timestamptz;
