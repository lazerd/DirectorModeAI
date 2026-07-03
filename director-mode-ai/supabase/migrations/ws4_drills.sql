-- Coach Mode drill/game library (shared reference data, AI-generated).
create table if not exists drills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,          -- warmup, serve, groundstrokes, volley, overhead, movement, strategy, game, conditioning
  skills text[] not null default '{}',
  level text not null,             -- beginner, intermediate, advanced, all
  min_players int not null default 1,
  max_players int not null default 12,
  duration_min int,
  is_game boolean not null default false,
  setup text,
  instructions text,
  coaching_points text,
  progression text,
  tags text[] default '{}',
  created_at timestamptz default now()
);
create index if not exists drills_category_idx on drills(category);
create index if not exists drills_level_idx on drills(level);
alter table drills enable row level security;
drop policy if exists "anyone can read drills" on drills;
create policy "anyone can read drills" on drills for select using (true);
