# ProShopMode — v1 plan (saved 2026-08-19, not yet built)

Zero-inventory virtual pro shop. Clubs curate partner-brand products; members
click out to the brand's own site through a tracked redirect; the club earns a
commission on attributed orders and the platform takes a share.

**v1 is affiliate, NOT merchant of record. No cart, no checkout, no payments,
no inventory, no shipping/returns/tax. If a change request implies a cart, the
answer is "v2".**

The product thesis — design toward these, they ARE the module:
1. **Endorsement converts** — "Coach recommends" inside lesson recaps and
   stringing flows is first-class.
2. **Exclusivity** — club-branded merch collections get top billing.
3. **Moments** — products attach to events (demo days, tournaments) so
   commerce appears where intent already exists.

## Discovery findings (verified against the live DB 2026-08-19)

- Next.js 14 App Router + TS; Tailwind/Radix/lucide/sonner; RHF+zod; recharts;
  vitest (pure-logic tests only, colocated in src/lib).
- No ORM: supabase-js through RLS on the client; `getSupabaseAdmin()` for
  privileged paths (never `createServiceClient` for authorization — it
  forwards the caller's cookie).
- Migrations: SQL files in supabase/migrations, applied live via
  `node scripts/dbrun.mjs <file>`. Verify live schema first.
- Tenancy: use the CLUB model — `cc_clubs` + `cc_club_members(role ∈
  owner/director/coach/front_desk/member)` with RLS helpers `is_club_team()`
  (staff) / `is_club_member()` (careful: has leaked PII before; staff data
  goes behind is_club_team). Sleepy Hollow club id
  `c437bf37-1ea2-4dc1-9250-11402f377726`, slug `sleepy-hollow`.
- Platform admin = the `/admin` password gate (adminAuth.ts). Fine for v1.
- No feature-flag system exists → **`shop_storefronts.enabled` IS the flag**
  (SwimMode-style row gating). Default off; module invisible when off.
- Background jobs: /api/cron/* (none needed in v1).
- Public pages: standalone light pages; add public prefixes to ClubSidebar
  PUBLIC_PREFIXES; public API routes use admin client + force-dynamic.
- Dates render in America/Los_Angeles (Vercel runs UTC).

## Schema (8 tables, one migration per phase)

Platform-level (no club_id; no public RLS policies — admin client only):

    shop_brands      id, name, logo_url, site_url,
                     program_type ('link_params'|'network'|'manual'),
                     default_commission_rate numeric,
                     url_template text,  -- e.g. "https://joola.com/{path}?utm_source=clubmode&club={club_id}&member={member_id}&pl={placement}"
                     status ('active'|'paused'), timestamps
    shop_products    id, brand_id FK, name, images text[],
                     category ('paddle'|'racquet'|'apparel'|'shoes'|'accessories'|'club_merch'),
                     msrp_cents int NULL,        -- DISPLAY ONLY, label "price at {brand}.com"
                     destination_url text,
                     tags jsonb ({sport, skill, ntrp_min/max, utr_min/max, string: bool}),
                     active bool, timestamps

Club-scoped (club_id → cc_clubs; manage = is_club_team(club_id)):

    shop_storefronts       club_id UNIQUE, enabled bool DEFAULT false,  -- the feature flag
                           display_name, hero_blurb, section_order text[]
    shop_storefront_items  club_id, product_id, section ('featured'|'club_merch'|'coach_picks'|'category'),
                           blurb, featured bool, sort int, UNIQUE(club_id, product_id)
    shop_recommendations   club_id, coach_user_id, client_id → lesson_clients NULL,
                           member_user_id NULL, product_id,
                           source ('lesson_recap'|'stringing'|'manual'), note, created_at
    shop_clicks            club_id, product_id, member_user_id NULL,
                           placement ('storefront'|'lesson_recap'|'stringing'|'event'|'email'),
                           ua_device, referer, created_at
                           -- INSERT only via the redirect endpoint (admin client); staff-only reads
    shop_commissions       club_id, brand_id, order_ref, order_total_cents, commission_cents,
                           platform_share_cents, club_share_cents,
                           status ('pending'|'confirmed'|'paid'),
                           click_id NULL, imported_at, source_file,
                           UNIQUE(brand_id, order_ref)   -- CSV dedupe
    shop_event_products    club_id, event_id → events, product_id, sort,
                           UNIQUE(event_id, product_id)

## Routes

    /admin/shop(+/brands,/products,/import,/earnings)  platform admin: catalog CRUD,
                                                       product CSV import, commission CSV
                                                       import w/ column mapping, rollup
    /shop/manage        club owner/director: storefront builder (dnd-kit reorder),
                        enable toggle, blurbs, featured, Club Merch section
    /shop/earnings      club owner/director: clicks, est. conversions, commissions by
                        period/brand/placement, pending vs paid (recharts)
    /shop/[clubSlug]    public, mobile-first storefront; empty state sells the feature;
                        prices labeled MSRP "price at {brand}.com"
    /api/shop/r/[productId]?club=&pl=&m=   THE ONLY OUTBOUND PATH — logs shop_clicks,
                        fills url_template, 302s. No raw affiliate links in markup.
    /api/shop/storefront/[slug]            public admin-client read, force-dynamic

## Phases (each shippable behind the enabled flag)

1. **Catalog & curation** — brands/products/storefronts/items migration;
   /admin/shop CRUD + CSV import; /shop/manage builder; seed Joola + Boast,
   ~15 products incl. Sleepy Hollow club merch.
2. **Member storefront** — /shop/[clubSlug] + public API + detail drawer;
   sidebar entry "ProShopMode"; PUBLIC_PREFIXES += /shop/ (except /shop/manage
   and /shop/earnings).
3. **Attribution & earnings** — clicks/commissions migration; redirect
   endpoint; commission CSV import with column-mapping UI + dedupe; club
   earnings dashboard; platform rollup.
4. **Recommendation surfaces** — recommendations/event_products migration;
   coach picker on lesson recap + client profile → "Your coach recommends"
   card; stringing hook (tags.string products after /api/stringing/recommend);
   event merch block on /event/[eventCode]. Placement stamped on every click.

## Tests

- vitest: attribution template fill (param encoding, missing placeholders),
  commission CSV mapping + dedupe + share math, placement enum exhaustiveness.
- RLS/tenant isolation: `scripts/shop-rls-verify.mjs` — SQL assertions run
  against live policies (club A cannot read club B's storefront items, clicks,
  commissions; coach can insert recommendations but not touch storefront;
  member can read only enabled storefronts). Run before each phase ships.

## Known accepted risks

- Redirect endpoint is unauthenticated by design (logged-out clicks count);
  insert-only, no PII beyond optional member id; bot noise inflates clicks
  but never commissions.
- Platform-admin is a password gate until the ClubMode role overhaul lands.
