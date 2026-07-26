# CaptainMode — Product Spec

A team-management tool for USTA and local-league captains, sold on top of ClubMode.

**Status:** Built (schema, generator, APIs, captain UI, player pages, cron, LemonSqueezy billing).
Migration is applied. Remaining work is listed in §11.

---

## 1. Positioning

CaptainMode handles the operational grind of captaining a league team: collecting availability,
building lineups, sending them out, and replacing players who bail. It is deliberately narrow —
no weather integrations, no dues collection, no social features.

The captain is a volunteer doing an unpaid job badly served by group texts and spreadsheets.
Every feature should remove a recurring weekly chore.

## 2. Pricing & access

| Situation | Price |
|---|---|
| Captain's club is on ClubMode Pro | **$10/month** |
| Captain's club is not a ClubMode customer | **$20/month** |

- **Captain pays their own card.** No director approval required, no club billing.
- **Up to 3 teams** per captain subscription. Beyond 3 requires a second subscription (OPEN: or a higher tier).
- **Co-captains are free** and get full access to the teams they're added to. They are future paying captains — do not charge them.

Strategic intent: captains at non-ClubMode clubs pay the $20 rate and become inbound pressure on
their club to adopt ClubMode ("I can get this for half price if you'd just use ClubMode").

### Two entry points

1. **Director-invited** — director invites captains from the ClubMode dashboard. Club/Pro link is automatic, captain lands on the $10 rate.
2. **Self-signup** — captain finds CaptainMode on the public site, signs up, searches for their club. If the club is on Pro they get $10; otherwise $20. No director involvement.

Both paths land in the same product. The only difference is price and whether the club link is pre-established.

## 3. Core objects

- **Captain** — the paying user. May captain up to 3 teams; may be co-captain on others.
- **Team** — one league team for one season. Has a league type, level, and season date range.
- **Player** — roster member. Name, email, rating, preferences. **No login, ever.**
- **Sub** — non-roster player available to fill in. Same shape as a player, flagged as a sub.
- **Match** — date, time, home/away, opponent, location, court count.
- **Availability response** — one player's yes/no/maybe for one match.
- **Lineup** — court assignments for one match.
- **Result** — court-by-court scores for one match.

### Player-level data captured

- **Partner preferences** — each player ranks their **top 5** preferred partners.
- **Return side preference** — deuce or ad. Used to build complementary pairs (a deuce-side player pairs well with an ad-side player).
- **Match day/time preferences** — general availability patterns, distinct from per-match availability.
- **Court limits** — singles only, doubles only, or "never court 1."
- **Captain's private notes** — not visible to players.

### Team-level data

- **Never-pair list** — pairs of players the generator must never put together. Every team has one.
- No locked/forced pairs. Partnerships come from preference rankings, not hard pins.

## 4. The weekly loop

This is the product. Everything else supports it.

### 4.1 Availability poll

Captain triggers a poll for an upcoming match. Every player gets an email:

> Can you play Tue Apr 14, 7:00pm vs Diablo Valley (home)?
> **[ Yes ] [ No ] [ Maybe ]**

One tap, no login, no account. Captain sees a live tally.

**Auto-nudge:** players who haven't responded get an automatic reminder 48 hours before the
captain's lineup deadline. Captains send this reminder manually every single week today.

### 4.2 One-click lineup generation

Given availability, the generator proposes court assignments. Captain drags to adjust.

**Priority order (settled):**

1. **Availability** — hard filter, highest priority. Only available players are considered.
2. **Hard constraints** — never-pair list, player court limits, league rating rules (see §5). Never violated.
3. **Court strength order** — stronger players on lower court numbers.
4. **Partner preference rank** — weight by rank position; a #1 preference counts more than a #5. Mutual preferences should weight higher than one-directional.
5. **Return side complementarity** — pair a deuce-preference player with an ad-preference player.
6. **Play-time fairness and playoff eligibility** — favor players who have played least, and players who still need matches to qualify for playoffs (see §6).
7. **Day/time preferences** — soft tiebreaker.

Captain can always override. Manual edits must show a warning if they break a hard constraint,
but should not be blocked.

### 4.3 Lineup email — 7 days out

Sent automatically 7 days before the match, to **the entire team** (not just those playing —
avoids "am I playing?" texts).

Players who **are** playing must tap **Confirm**. Captain sees who hasn't confirmed, which surfaces
bailers a week early instead of on match day.

Includes match-day logistics: arrival time, court address, opposing captain's contact.

### 4.4 Reminder email — day before

Automatic. Goes to playing players with time, location, and their court assignment.

### 4.5 Someone bails → instant sub

Captain marks a player out. One click blasts **every eligible sub at once** with a **Claim** button.

- First to tap gets the spot.
- Everyone else sees "already filled."
- Lineup updates automatically.
- Captain is notified.

Eligibility = rating fits the court and league rules, and the sub isn't already playing.

### 4.6 After the match

Captain enters court-by-court scores. This powers the team record, play-time counts, and
playoff-eligibility tracking.

### 4.7 Rainout / reschedule

One button: pick a new date → **availability is re-polled from scratch** → lineup rebuilds.
Old availability is discarded because it was for a different day.

## 5. League formats supported at launch

| Format | Lineup implications |
|---|---|
| USTA Adult League 18+ / 40+ / 55+ | Standard singles + doubles courts at one NTRP level |
| USTA Combo | Combined-rating caps per court (7.5, 8.5, 9.5) — must validate |
| USTA Mixed | Combined-rating caps **plus** one-male-one-female per pair |
| USTA Tri-Level | Three NTRP levels, one court per level |
| TopDog flex / local leagues | Looser format. Named targets: **Fall League**, **East Bay Women's Tennis League** |

The generator must refuse to produce a lineup that violates a combined-rating cap, and warn
clearly if the captain manually creates one.

## 6. Playoff eligibility & play-time fairness

Both tracked, and both **feed the lineup generator** (priority 6 above).

### Eligibility is captain-configured, never assumed

Rules differ by league and by player, so the captain sets them at team setup:

- **Off by default.** Many leagues have no playoffs at all (East Bay Women's Tennis League, most
  flex leagues). When eligibility is off, nothing is tracked, shown, or fed to the generator.
- **Two thresholds when on.** USTA requires *more* matches from **self-rated and appeal-rated**
  players than from computer-rated ones, and the number depends on how many lines the league
  plays — commonly 3 in a 3-line league and 4 in a 4- or 5-line league. Both numbers are entered
  by the captain rather than inferred, because they vary by section and year.
- **Each player carries a rating type** — computer, self, or appeal — which selects their
  threshold.

The team hub warns when someone is short with few matches remaining: *"Sally needs 1 more match
(1/2) — only 2 left, so she needs nearly all of them."*

### Fairness

Matches played per player, visible to the captain. This is the #1 source of team drama; the
generator balances it unless overridden.

## 6a. Partnership chemistry (from results)

Court-by-court scores are entered after each match, and marking a match **played** is what makes
it count toward eligibility and fairness. The win/loss flags additionally produce a **partnership
record** for every pair that has played together.

That record feeds the generator as a chemistry signal: pairs that win together get pulled back
together, pairs that keep losing get split up. It is **scaled by confidence** — a 1–0 record barely
registers, while a 5–1 record carries real weight — so one lucky win never outranks a player's
stated partner preference. An even record is exactly neutral.

The team hub shows every partnership's record and win rate, so the generator's choices are
explainable rather than mysterious.

## 7. Data import

**Paste, parsed by AI.** The captain opens their team page on any site — USTA TennisLink, TopDog,
a local league page, a spreadsheet — selects all, copies, and pastes into CaptainMode. An LLM
extracts roster, ratings, schedule, and results into structured records.

Rationale over scraping:

- Handles **any** source with no per-site adapter.
- No stored credentials — the captain copies a page they're already authorized to view.
- No ToS exposure, no browser infrastructure, no breakage when sites redesign.
- Costs a fraction of a cent per paste and scales flat.

Captain re-pastes after match nights to pull in scores, or just enters scores directly.

**Future:** once usage shows which site dominates, build a real scraper for that one site as a
nightly auto-refresh, keeping paste as the permanent fallback.

## 8. Communication

**Email only** at launch. No SMS — avoids per-message costs, phone collection, and carrier
compliance. Reassess once captains ask for it.

All player-facing links are **one-tap, tokenized, and work without an account.**

## 9. Explicitly out of scope

- Dues collection or payment processing of any kind
- Weather integration
- Player accounts or a player-facing app
- Social/chat features
- Direct score reporting to USTA (captain still does this on TennisLink)

## 10. Technical implementation plan

Conventions below are taken from the existing codebase — follow them rather than inventing new ones.

### 10.1 Where the code goes

| What | Path |
|---|---|
| Routes | `src/app/captain/` — `layout.tsx` (server component: auth + module sidebar) plus one folder per sub-route with `page.tsx` |
| Components | `src/components/captain/` — **not** under `src/app` |
| Logic | `src/lib/captain/` — lineup generator, paste parser, eligibility math |
| API | `src/app/api/captain/<action>/route.ts` |
| Migration | `supabase/migrations/captain_mode.sql`, applied with `node scripts/dbrun.mjs supabase/migrations/captain_mode.sql` |

Copy `src/app/lessons/layout.tsx` as the layout starting point — the module-sidebar boilerplate is
identical across `lessons`, `stringing`, and `mixer`. Theme: page `#001820`, sidebar `#002838`,
brand lime `#D3FB52`.

### 10.2 Registration points

CaptainMode must be added to **four** places or it won't appear / won't be protected:

1. `src/components/shared/ClubSidebar.tsx` — the `ITEMS` array (~lines 40-56). Mounted once in the root layout; do not mount per-page.
2. `src/app/page.tsx` — the `tools` array (~line 88), the marketing card grid.
3. `src/app/page.tsx` — the "Quick Access" array (~line 725) for logged-in users.
4. `src/middleware.ts` — the `protectedPaths` array (~lines 36-54). Add the authenticated captain paths **only**; the tokenized player pages must stay public.

### 10.3 Data model

All tables: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`, `created_by uuid`, nullable `club_id uuid REFERENCES cc_clubs(id)` where club-linked. Migration must be idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`, `-- VERIFY:` block at the bottom).

| Table | Purpose / key columns |
|---|---|
| `captain_teams` | `captain_user_id`, `club_id` (null for standalone), `name`, `league_type`, `level`, `season_start/end`, `source_site` |
| `captain_team_staff` | `team_id`, `user_id`, `role 'captain'\|'co_captain'` — co-captains get full access, no charge |
| `captain_players` | `team_id`, `name`, `email`, `rating numeric`, `return_side 'deuce'\|'ad'`, `is_sub bool`, `court_limit`, `notes` (private), **`player_token`** |
| `captain_partner_prefs` | `player_id`, `preferred_player_id`, `rank smallint` (1-5) |
| `captain_never_pair` | `team_id`, `player_a_id`, `player_b_id` |
| `captain_matches` | `team_id`, `match_at timestamptz`, `is_home`, `opponent`, `location`, `court_count`, `opposing_captain_name/phone`, `arrival_time`, `status`, `lineup_email_sent_at`, `reminder_sent_at`, `nudge_sent_at` |
| `captain_availability` | `match_id`, `player_id`, `status 'yes'\|'no'\|'maybe'`, `responded_at`, `UNIQUE(match_id, player_id)` |
| `captain_lineups` | `match_id`, `court_number`, `court_type 'singles'\|'doubles'`, `player1_id`, `player2_id`, `player1_confirmed_at`, `player2_confirmed_at` |
| `captain_results` | `match_id`, `court_number`, `score text`, `won bool` |
| `captain_sub_requests` | `match_id`, `lineup_id`, `slot smallint`, `status 'open'\|'filled'\|'cancelled'`, `claimed_by_player_id`, `claimed_at`, **`request_token`** |
| `captain_subscriptions` | see §10.6 |

**RLS:** `ENABLE ROW LEVEL SECURITY` on all of them, policies `FOR ALL TO authenticated` using
`captain_user_id = auth.uid()` OR membership in `captain_team_staff`. Follow the pattern in
`ws4_coach_mode.sql`.

**Critical:** `REVOKE SELECT ON <table> FROM anon;` on every table, then column-level
`GRANT SELECT (safe_columns) TO anon` only where a public page needs it — the token columns and
player emails must never be anon-readable. Precedent: `ws1_isolation_lockdown.sql:69-77`.

### 10.4 Tokenized player links (no login)

Use the **JTT RSVP pattern** — it is this exact use case. See `supabase/migrations/leagues_jtt_rsvp.sql`,
`src/app/leagues/rsvp/[token]/page.tsx`, and `src/app/api/leagues/rsvp/[token]/route.ts`.

```sql
ALTER TABLE captain_players ADD COLUMN IF NOT EXISTS player_token TEXT;
UPDATE captain_players SET player_token = replace(uuid_generate_v4()::text,'-','') WHERE player_token IS NULL;
ALTER TABLE captain_players ALTER COLUMN player_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_captain_players_token ON captain_players(player_token);
ALTER TABLE captain_players ALTER COLUMN player_token SET DEFAULT replace(uuid_generate_v4()::text,'-','');
```

Backfill → `SET NOT NULL` → `SET DEFAULT`, in that order.

Public surfaces (all `export const dynamic = 'force-dynamic'`, all using `getSupabaseAdmin()` from
`@/lib/supabase/admin`, **no auth — the token is the credential**):

- `/captain/availability/[token]` — one page per player showing all their upcoming matches with Yes/No/Maybe, exactly like the JTT RSVP list.
- `/captain/confirm/[token]/[matchId]` — the Confirm tap from the 7-day lineup email.
- `/captain/claim/[requestToken]/[playerToken]` — sub claim.

Every write must **re-validate that the target row belongs to that token's scope** before updating
(precedent: `src/app/api/leagues/rsvp/[token]/route.ts:78-86`).

**First-to-claim atomicity** — resolve the race in a single statement, never read-then-write:

```sql
UPDATE captain_sub_requests
   SET status='filled', claimed_by_player_id=$1, claimed_at=now()
 WHERE id=$2 AND status='open'
RETURNING id;
```

Zero rows returned means someone else won; show "already filled."

### 10.5 Email and scheduling

Never call Resend directly. Use `sendBilledEmail` / `sendBilledEmails` from `src/lib/email.ts`,
which consumes email credits and routes through `safeResendSend` (unsubscribe check + signed
footer). Catch `CreditLimitError` and return `creditLimitResponse(err)` (402). Reference call site:
`src/app/api/lessons/blast/route.ts`.

**Scheduling:** add **one** daily cron to `vercel.json` — `/api/captain/cron` — that handles all
four scheduled sends in a single pass, rather than one cron per job:

1. Lineup emails for matches exactly 7 days out (where `lineup_email_sent_at IS NULL`)
2. Reminder emails for matches tomorrow (`reminder_sent_at IS NULL`)
3. Availability nudges to non-responders 48h before the captain's deadline (`nudge_sent_at IS NULL`)
4. Any open sub requests that need re-blasting

Guard each with its `*_sent_at` column so a re-run never double-sends. Precedent for the dedupe
approach: `src/lib/jttRsvpConfirmations.ts:127`.

### 10.6 Billing — LemonSqueezy (the Stripe account is dead)

Billing runs through **LemonSqueezy**, not Stripe — see the note at the top of
`src/lib/lemonsqueezy.ts`. It's a Merchant of Record, so it handles tax and compliance.

The club's own plan is two-tier (`free` | `pro`) on `profiles.plan_tier`, billed at the **club**
level via `resolveBillingUserId` → club owner. CaptainMode is a **separate per-captain subscription
at a different price**, and a captain may be on ClubMode free while paying for CaptainMode — so
`plan_tier` cannot be overloaded and `hasFeature()` cannot gate it.

**Built:**

- **`captain_subscriptions`** table: `user_id` (PK), `club_id`, `rate_type 'club_linked'|'standalone'`, `status`, `current_period_end`, plus `stripe_customer_id` / `stripe_subscription_id` which hold the **LemonSqueezy** customer and subscription ids (same column-reuse convention the rest of the app follows).
- **Two price keys** in `src/lib/lemonsqueezy.ts`: `captain_club` ($10/mo) and `captain_solo` ($20/mo), resolved through `BUY_LINKS` from `LEMONSQUEEZY_BUY_LINK_CAPTAIN_CLUB` / `..._CAPTAIN_SOLO`.
- **`hasCaptainAccess(userId)`** / `getCaptainAccess()` in `src/lib/captain/access.ts`, which every authenticated captain route gates on via `requireTeam()`.
- **Checkout** (`/api/billing/checkout`): CaptainMode is exempt from the owner-only guard, because a captain is normally just a club member paying with their own card. **The rate is re-resolved server-side** via `resolveCaptainRate(clubId)` — the client's `priceKey` is only a hint, so a tampered request cannot buy the $10 plan without a qualifying club. The supplied `clubId` is verified against `cc_club_members` / `cc_clubs.owner_id` before it counts.
- **Webhook** (`/api/webhooks/lemonsqueezy`): a CaptainMode branch keyed on `custom.price_key` upserts `captain_subscriptions` and **never touches `profiles.plan_tier`**. `club_id` and `rate_type` come from the checkout's custom data.
- **Team limit**: max 3 owned teams per captain, enforced at team creation. Co-captaining doesn't count.

**Remaining setup (needs the LemonSqueezy dashboard):**

1. Create two subscription products — $10/mo and $20/mo.
2. Copy their buy links into Vercel env as `LEMONSQUEEZY_BUY_LINK_CAPTAIN_CLUB` and `LEMONSQUEEZY_BUY_LINK_CAPTAIN_SOLO`. Until then checkout returns `price_not_configured` and the subscribe page says so plainly.
3. The webhook URL is already subscribed for the subscription lifecycle events; no new events are needed.

**Edge case still to decide:** if a club downgrades from Pro, its captains are already on the $10
price. Simplest defensible policy is to honour $10 until the period ends, then re-resolve at
renewal — the webhook re-reads `rate_type` from custom data on every event, so this needs a
deliberate choice rather than being handled implicitly.

### 10.7 AI usage

Anthropic SDK, following `src/app/api/lessons/summary/route.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
const MODEL = process.env.AI_MODEL_AGENT ?? 'claude-sonnet-4-6';
const KEY = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY;
// … then: recordAiUsage(user.id, msg.usage?.input_tokens ?? 0, msg.usage?.output_tokens ?? 0)
```

Two AI touchpoints:

- **Paste parser** (`/api/captain/import`) — takes pasted page text, returns structured roster / schedule / results as JSON. Validate the output with `zod` before writing anything, and always show the captain a preview to confirm before committing.
- **Lineup generator** — see below.

**The lineup generator should be deterministic code, not an LLM call.** The priority order in §4.2 is
a constraint-satisfaction problem with hard rules (rating caps, never-pair) that must never be
violated; an LLM will occasionally break them. Write it in `src/lib/captain/lineup.ts` as scored
assignment with hard constraints as filters, and unit-test it with `vitest` alongside the file
(precedent: `src/lib/quads.test.ts`). MixerMode's `heuristicRecommendation()` in
`src/app/api/mixer/recommend/route.ts:52-96` is the in-repo precedent for deterministic logic over
an AI call.

### 10.8 Suggested build order

1. Migration + RLS + tokens; team/roster CRUD; manual player entry.
2. Availability poll: email send, `/captain/availability/[token]` page, live tally in captain view.
3. Lineup generator (deterministic, unit-tested) + drag-to-edit UI.
4. Lineup email 7 days out with Confirm, day-before reminder, 48h nudge — all on the one daily cron.
5. Sub pool + first-to-claim blast.
6. Score entry → team record, play-time counts, playoff eligibility; wire eligibility back into the generator.
7. Paste import with AI parse + confirmation preview.
8. Billing: Stripe prices, `captain_subscriptions`, rate resolution, webhook, team limit.
9. Both entry points: director-invite flow from the ClubMode dashboard, and public self-signup.
10. Reschedule flow (re-poll + rebuild).

Steps 1-4 are the usable core — that's a captain's whole week. Everything after is leverage.

## 11. What's built, and what's left

### Built

| Area | Files |
|---|---|
| Schema + RLS + tokens | `supabase/migrations/captain_mode.sql` (11 tables) |
| Lineup generator | `src/lib/captain/lineup.ts` + `lineup.test.ts` (31 tests) |
| Access / rate resolution | `src/lib/captain/access.ts` |
| Route auth, eligibility rules, pair records | `src/lib/captain/server.ts` |
| Player emails | `src/lib/captain/emails.ts` |
| Captain APIs | `src/app/api/captain/{teams,players,matches,poll,lineup,subs,results}/route.ts` |
| Player token APIs | `src/app/api/captain/{availability,claim,confirm}/…/route.ts` |
| Daily cron | `src/app/api/captain/cron/route.ts` (+ `vercel.json`) |
| Captain UI | `src/app/captain/(app)/…` + `src/components/captain/…` |
| Player pages (no login) | `src/app/captain/{availability,claim,confirm}/…` |
| Navigation | `ClubSidebar.tsx`, `middleware.ts` |

The `(app)` route group exists so the auth layout wraps only captain pages — the tokenized player
pages sit outside it and stay reachable without a login. `middleware.ts` deliberately does not list
`/captain` for the same reason.

### Left to do

1. **Create the two LemonSqueezy products** and set their buy links in Vercel env (see §10.6).
   The code path is complete; it just has no product to point at. To exercise the app before then,
   insert a subscription row by hand:
   ```sql
   insert into captain_subscriptions (user_id, status, rate_type)
   values ('<auth.users id>', 'active', 'standalone')
   on conflict (user_id) do update set status = 'active';
   ```
2. **Never-pair UI.** The generator enforces the never-pair list and the table exists, but nothing
   in the roster screen writes to it yet.
4. **Paste-to-import (§7).** Not started; roster entry is currently paste-one-per-line
   (`Name, email, rating`) rather than AI-parsed.
5. **Reschedule UI.** The API handles it (`PATCH /api/captain/matches` with `reschedule_to`, which
   wipes availability and re-polls); no button calls it yet.

## 12. Open questions

- Pricing beyond 3 teams — second subscription, or a higher tier?
- Should a team page be publicly shareable (results/standings for players to check)?
- How is "club is on Pro" verified for self-signup captains whose club name is typed freehand?
- Does the sub-claim blast go to club members via CourtConnect when the club is on ClubMode, or sub pool only?
