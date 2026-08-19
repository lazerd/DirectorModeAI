# clubmode.ai migration + per-club subdomains (planned 2026-08-19)

Goal: the product lives at **clubmode.ai**, and every club gets its own
address — **sleepyhollow.clubmode.ai**, **lafayettetennisclub.clubmode.ai** —
serving that club's public surfaces (storefront, pathway family pages, events,
mixers, join pages) under the club's own branding.

## Non-negotiable constraint

Thousands of tokenized links are already in families' inboxes
(pathway family links, JTT RSVP/score tokens, captain links, swim family
links, /enter score pages). **club.coachmode.ai must 301 to clubmode.ai with
the path intact, forever.** Nothing that was emailed may ever break.

## Steps

1. **Domain**: acquire/confirm clubmode.ai. Put DNS on Vercel (needed for the
   wildcard) or CNAME `*` to Vercel.
2. **Vercel**: add `clubmode.ai`, `www.clubmode.ai`, and wildcard
   `*.clubmode.ai` to the director-mode-ai project. Keep `club.coachmode.ai`
   attached and configure it as a permanent redirect to `clubmode.ai`
   (path-preserving).
3. **Tenant column**: add `cc_clubs.subdomain` TEXT UNIQUE (dns-safe:
   `^[a-z0-9-]{3,63}$`, reserved list: www, app, api, admin, mail, staging).
   Sleepy Hollow = `sleepyhollow`. Backfill from slug with hyphens preserved
   or collapsed per Darrin's taste (he wrote "sleepyhollow", so collapse).
4. **Middleware routing**: in Next middleware, parse Host:
   - `clubmode.ai` / `www` → marketing + the director app (current behavior).
   - `<sub>.clubmode.ai` → look up cc_clubs by subdomain (Edge-cached);
     rewrite public club surfaces to the club-scoped routes and stamp
     `x-club-id` so pages render that club's branding. Unknown sub → 404 page
     that sells ClubMode.
   - Preview deploys (`*.vercel.app`) keep current behavior.
5. **Auth cookies**: Supabase auth cookie domain → `.clubmode.ai` so a session
   works across app + club subdomains. Update Supabase Auth allowed redirect
   URLs, site URL.
6. **Email**: verify clubmode.ai on Resend; switch senders (noreply@clubmode.ai);
   keep the old domain verified during transition.
7. **Third-party callbacks**: LemonSqueezy/Square webhooks, any OAuth origins,
   Twilio webhooks → add new URLs before flipping.
8. **App-generated links**: audit for hardcoded `club.coachmode.ai` /
   `NEXT_PUBLIC_SITE_URL`; generate club-facing links as
   `https://<subdomain>.clubmode.ai/...` once live.
9. **Cutover order**: DNS + wildcard live → cookies/auth → deploy middleware →
   email domain → switch link generation → 301 the old host. Each step
   reversible; the 301 goes last.

## Open questions for Darrin

- Is clubmode.ai already owned? (If not, buy it before announcing anything.)
- Does the director console live at clubmode.ai or app.clubmode.ai?
  (Recommendation: clubmode.ai/ for marketing + login; club subdomains are
  member-facing only.)
- ClubMode launch overhaul memory says tenant isolation is HELD — the
  subdomain work raises the stakes on finishing that verification first.
