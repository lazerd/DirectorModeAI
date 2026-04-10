# Supabase

The **production database is the source of truth** for the schema. There is no
authoritative `schema.sql` checked in — `legacy_schema_stale.sql` is preserved
only for historical reference and should not be trusted (see warning header in
that file).

If you need to know what columns or tables exist, use one of:

1. **Supabase dashboard** → Database → Tables → click any table to see its
   definition.
2. **Supabase SQL editor** → run `\d public.<table_name>` for a column list,
   or paste the introspection queries below.
3. **`pg_dump`** → see [`dump_schema.sh`](./dump_schema.sh) for a one-shot
   schema-only dump using your `DATABASE_URL`.

## Why no checked-in schema?

Production drifted from the original `schema.sql` over time (table renames,
new columns added through the dashboard, two parallel product schemas living
side-by-side). The 2026-04-10 bug bash audit discovered the file was actively
misleading developers into writing queries against tables and columns that
don't exist in prod. Rather than maintain a parallel definition that nobody
keeps in sync, we treat the live DB as the single source of truth.

If you want a fresh dump checked in, run `dump_schema.sh > current_schema.sql`
and commit the output — but be aware it will go stale again the moment
anyone makes a dashboard change.

## Production table directory (audited 2026-04-10)

Two parallel product schemas exist in the same database. Most live code reads
the v1 (legacy) tables; the v2 (`mixer_*`, `lesson_*`) tables are partially
migrated and largely empty.

### v1 — populated, used by live code

| Table              | Notes                                                            |
| ------------------ | ---------------------------------------------------------------- |
| `events`           | Mixer events (5 rows). Has `user_id`, `event_date`, `event_code`, `name`, `match_format`, `num_courts`, `start_time`, ... |
| `players`          | Master player records (124 rows). Has `id`, `user_id` (organizer), `name`, `gender`, `linked_user_id` (auth.user link for client dashboard), `rating_notes` |
| `event_players`    | Join: events ↔ players (39 rows). Has stats: `wins`, `losses`, `games_won`, `games_lost`, `team_id` |
| `event_teams`      | Team Battle teams. FK → `events.id` |
| `event_participants` | FK → `events.id` and `players.id` |
| `event_photos`     | FK → `events.id` |
| `rounds`           | Mixer rounds (7 rows). FK → `events.id` |
| `matches`          | Mixer matches (38 rows). FK → `rounds.id`. Player columns 1-4. |
| `clients`          | Lesson clients (v1 — distinct from `lesson_clients`) |
| `coaches`          | Lesson coaches (v1) |
| `clubs`            | Tennis clubs (v1) |
| `client_clubs`     | Join: clients ↔ clubs |
| `client_coaches`   | Join: clients ↔ coaches |
| `club_invitations` | UNIQUE on `invite_code` |
| `email_blasts`     | FK → `clubs.id`, `coaches.id` |

### v2 — newer, mostly empty (cross-product bridge writes here)

| Table             | Notes                                                              |
| ----------------- | ------------------------------------------------------------------ |
| `mixer_events`    | 0 rows. Used only by `/api/courtconnect/create-mixer-event`        |
| `mixer_players`   | 0 rows                                                             |
| `mixer_rounds`    | 0 rows                                                             |
| `mixer_matches`   | 0 rows                                                             |
| `lesson_clients`  | Has `id`, `name`, `email`, `phone`, `notes`, `created_at`, `profile_id` |
| `lesson_coaches`  | Has `id`, `profile_id`, `display_name`, `slug`, `email`, `created_at` |
| `lesson_slots`    | Has `coach_id`, `start_time`, `end_time`, `status`, `booked_by_client_id`, `booked_at`, `cancelled_at`, `cancellation_reason`, `reminder_sent`, ... |
| `lesson_blasts`   | FK → `lesson_coaches.id`                                           |
| `lesson_blast_slots` | Join: blasts ↔ slots                                            |
| `lesson_client_coaches` | Join: lesson_clients ↔ lesson_coaches                       |
| `lesson_client_profiles` | UNIQUE on `profile_id` — auth.user → lesson_client mapping |

### Shared / cross-product

| Table              | Notes                                                            |
| ------------------ | ---------------------------------------------------------------- |
| `profiles`         | Extends `auth.users`. Has `billing_status`, `trial_ends_at`, `organization_name`, `timezone`, `full_name` |
| `analytics_events` | Event tracking. Used by `/api/admin/track`                       |
| `cc_players`       | CourtConnect player profiles. Has `display_name`, `bio`, `primary_sport`, `preferred_days`, `preferred_times`, `organization_id` |
| `cc_player_sports` | Per-sport ratings (NTRP, UTR, level_label). UNIQUE on (player_id, sport) |
| `cc_events`        | Has `event_type`, `sport`, `event_date`, `start_time`, `location`, `court_count`, `max_players`, `skill_min`/`skill_max`, `is_public`, `status`, `organization_id` |
| `cc_event_players` | RSVPs. Has `guest_name`, `guest_email`, `status`, `response_order` |
| `cc_invitations`   | FK → `cc_events.id`, `cc_players.id`                             |
| `cc_vault_players` | Director's player vault. Has `utr_singles`, `utr_doubles` (split via the recent UTR migration), plus `rating_source`, `membership_status`, `cc_player_id` |
| `cc_clubs`         | CourtConnect-side clubs (distinct from v1 `clubs`)               |
| `cc_notification_preferences` | UNIQUE on `profile_id`                                |
| `cc_notifications` | Per-user notification log                                        |
| `facilities`       | Tennis facility records. FK → `profiles.id`                      |
| `facility_members` | Join: facilities ↔ profiles. UNIQUE on (facility_id, user_id)    |

### Stringing

| Table                  | Notes                                                       |
| ---------------------- | ----------------------------------------------------------- |
| `stringing_customers`  | `id`, `full_name`, `email`, `phone`, `notes`                |
| `stringing_rackets`    | FK → `stringing_customers.id`. `brand`, `model`, `string_pattern`, `grip_size` |
| `stringing_catalog`    | String inventory. `brand`, `name`, `string_type`, `gauge`, `price`, `in_stock`, `arm_friendliness_score`, etc. |
| `stringing_jobs`       | The main job board. FK → customers, rackets, catalog. `main_tension_lbs`, `cross_tension_lbs`, `custom_string_name`, `play_style`, `skill_level`, `arm_issues`, `status`, `quoted_ready_at`, `completed_at`, `picked_up_at`, `requested_by_user_id`, `stringer_user_id` |
| `stringing_job_feedback` | Post-job rating. FK → `stringing_jobs.id`                  |

## Introspection queries

### List all public tables
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

### List all columns for a specific table
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'YOUR_TABLE'
ORDER BY ordinal_position;
```

### List all foreign keys
```sql
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name;
```
