-- Tournament hubs: group tournament events under a shared hub_slug so they
-- surface as one page (/tournaments/hub/[slug]) with per-division links + QR
-- posters. Applied to production 2026-07-20 via scripts/dbrun.mjs.
alter table events add column if not exists hub_slug text;
alter table events add column if not exists hub_title text;
create index if not exists idx_events_hub_slug on events(hub_slug);
