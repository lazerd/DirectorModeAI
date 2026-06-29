-- Token-level accounting for the per-page ClubMode Assistant chat.
-- The existing usage_credits row already tracks ai_calls_used (one per AI action);
-- these columns let the taxi-meter pricing reflect real Claude token cost, not just
-- a flat per-call count. Guarded so it is safe to run before or after the table exists.

alter table if exists usage_credits
  add column if not exists ai_input_tokens  bigint not null default 0;

alter table if exists usage_credits
  add column if not exists ai_output_tokens bigint not null default 0;
