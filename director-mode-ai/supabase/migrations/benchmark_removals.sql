-- Owner-curated removals from the /benchmarks 990 dataset.
-- A row hides either one person-row ('row' scope, key = 'EIN|Person|Year')
-- or an entire club ('club' scope, key = 'EIN|*').
-- Written only by the service role via /api/benchmarks/removals, which gates
-- on Darrin's login emails — RLS is on with no policies so anon/authed
-- clients can't touch it.
create table if not exists public.benchmark_removals (
  key text primary key,
  ein text not null,
  person text,
  year text,
  scope text not null check (scope in ('row', 'club')),
  created_at timestamptz not null default now()
);
alter table public.benchmark_removals enable row level security;
