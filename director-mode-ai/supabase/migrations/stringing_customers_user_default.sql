-- stringing_customers inserts from the browser omit user_id, but RLS requires
-- user_id = auth.uid(). Default it (same as stringing_catalog) so inserts pass.
-- Applied to prod 2026-09-10.
alter table stringing_customers alter column user_id set default auth.uid();
