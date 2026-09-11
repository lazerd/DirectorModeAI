-- =====================================================================
-- MaintenanceMode — department heads post work, the maintenance crew does it.
--
--   Daily routine  maint_routine_items + maint_routine_checks
--   One-off tasks  maint_tasks
--   Projects       maint_projects + maint_project_steps
--   Notes log      maint_updates (a task OR a project)
--   Digest         maint_settings + maint_digest_sends
--
-- THE DAILY RESET NEEDS NO JOB: a check belongs to (item, club-local date).
-- "Today" is computed in the club's time zone by the API, so the checklist is
-- fresh at the club's midnight and yesterday's record stays intact.
--
-- ACCESS: RLS is ON with NO client policies — the anon and authenticated
-- clients get nothing. Every read and write goes through service-role API
-- routes that resolve the caller's club and filter by it (the
-- lesson_open_times_v2 convention). Child rows carry a composite
-- (parent_id, club_id) foreign key so they can never point at another club's
-- parent.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/20260911_maintenance_mode.sql
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------- routine
CREATE TABLE IF NOT EXISTS public.maint_routine_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES public.cc_clubs(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(btrim(title)) > 0),
  notes         text,
  department    text NOT NULL DEFAULT 'other'
                  CHECK (department IN ('tennis','aquatics','fitness','clubhouse','grounds','other')),
  location      text,
  days_of_week  smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}'
                  CHECK (cardinality(days_of_week) > 0 AND days_of_week <@ '{0,1,2,3,4,5,6}'::smallint[]),
  target_time   time,
  sort_order    int NOT NULL DEFAULT 0,
  -- Club-local date it was created: a brand-new item is never "missed yesterday".
  active_from   date NOT NULL,
  -- Removed items with history are archived, so old checks keep their name.
  archived_on   date,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, club_id)
);
CREATE INDEX IF NOT EXISTS maint_routine_items_club_idx
  ON public.maint_routine_items (club_id, archived_on, sort_order);

CREATE TABLE IF NOT EXISTS public.maint_routine_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES public.cc_clubs(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL,
  local_date  date NOT NULL,
  status      text NOT NULL DEFAULT 'done' CHECK (status IN ('done','skipped')),
  done_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at     timestamptz NOT NULL DEFAULT now(),
  note        text,
  photo_url   text,
  photo_path  text,
  UNIQUE (item_id, local_date),
  FOREIGN KEY (item_id, club_id)
    REFERENCES public.maint_routine_items (id, club_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS maint_routine_checks_club_date_idx
  ON public.maint_routine_checks (club_id, local_date);

-- ------------------------------------------------------------------ tasks
CREATE TABLE IF NOT EXISTS public.maint_tasks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id               uuid NOT NULL REFERENCES public.cc_clubs(id) ON DELETE CASCADE,
  title                 text NOT NULL CHECK (length(btrim(title)) > 0),
  description           text,
  department            text NOT NULL DEFAULT 'other'
                          CHECK (department IN ('tennis','aquatics','fitness','clubhouse','grounds','other')),
  location              text,
  priority              text NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low','normal','high','urgent')),
  due_date              date,
  status                text NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','in_progress','done','cancelled')),
  photo_url             text,
  photo_path            text,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at            timestamptz,
  started_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at          timestamptz,
  completed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completion_note       text,
  completion_photo_url  text,
  completion_photo_path text,
  cancelled_at          timestamptz,
  cancelled_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, club_id)
);
CREATE INDEX IF NOT EXISTS maint_tasks_club_status_idx
  ON public.maint_tasks (club_id, status, due_date);
CREATE INDEX IF NOT EXISTS maint_tasks_club_created_idx
  ON public.maint_tasks (club_id, created_at DESC);

-- --------------------------------------------------------------- projects
CREATE TABLE IF NOT EXISTS public.maint_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES public.cc_clubs(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(btrim(title)) > 0),
  description   text,
  department    text NOT NULL DEFAULT 'other'
                  CHECK (department IN ('tennis','aquatics','fitness','clubhouse','grounds','other')),
  location      text,
  target_date   date,
  status        text NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','active','on_hold','done')),
  completed_at  timestamptz,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, club_id)
);
CREATE INDEX IF NOT EXISTS maint_projects_club_status_idx
  ON public.maint_projects (club_id, status);

CREATE TABLE IF NOT EXISTS public.maint_project_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES public.cc_clubs(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  title       text NOT NULL CHECK (length(btrim(title)) > 0),
  sort_order  int NOT NULL DEFAULT 0,
  done        boolean NOT NULL DEFAULT false,
  done_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, club_id)
    REFERENCES public.maint_projects (id, club_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS maint_project_steps_project_idx
  ON public.maint_project_steps (project_id, sort_order);

-- ------------------------------------------------------------- notes log
CREATE TABLE IF NOT EXISTS public.maint_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES public.cc_clubs(id) ON DELETE CASCADE,
  task_id     uuid,
  project_id  uuid,
  author_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body        text NOT NULL CHECK (length(btrim(body)) > 0),
  photo_url   text,
  photo_path  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(task_id, project_id) = 1),
  FOREIGN KEY (task_id, club_id)
    REFERENCES public.maint_tasks (id, club_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, club_id)
    REFERENCES public.maint_projects (id, club_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS maint_updates_task_idx    ON public.maint_updates (task_id, created_at);
CREATE INDEX IF NOT EXISTS maint_updates_project_idx ON public.maint_updates (project_id, created_at);

-- ----------------------------------------------------------------- digest
CREATE TABLE IF NOT EXISTS public.maint_settings (
  club_id         uuid PRIMARY KEY REFERENCES public.cc_clubs(id) ON DELETE CASCADE,
  digest_enabled  boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Claimed BEFORE mailing: a second run the same day finds the row and skips.
CREATE TABLE IF NOT EXISTS public.maint_digest_sends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES public.cc_clubs(id) ON DELETE CASCADE,
  local_date  date NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'claimed',
  detail      text,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, local_date, user_id)
);

-- -------------------------------------------------------------------- RLS
ALTER TABLE public.maint_routine_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maint_routine_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maint_tasks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maint_projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maint_project_steps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maint_updates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maint_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maint_digest_sends   ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: service-role API routes only.

-- ---------------------------------------------------------------- photos
-- Public bucket with unguessable paths (<club_id>/<uuid>.jpg). Photos of a
-- torn net or a broken skimmer carry no member data.
INSERT INTO storage.buckets (id, name, public)
VALUES ('maintenance-photos', 'maintenance-photos', true)
ON CONFLICT (id) DO NOTHING;
