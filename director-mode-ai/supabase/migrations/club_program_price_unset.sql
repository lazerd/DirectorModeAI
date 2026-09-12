-- A class price of zero meant two different things, and the site said "Free"
-- for both.
--
-- `club_programs.price_cents` was NOT NULL DEFAULT 0, so a club that had never
-- entered a price was indistinguishable from one running a genuinely free
-- clinic. Lafayette's published Pee-Wee class advertised "Free" on its own
-- website purely because nobody had typed a number yet. The club is not
-- misleading anyone on purpose — the schema gave it no way to say "not priced
-- yet", so it had to say the wrong thing.
--
-- After this: NULL = no price set (shown as "Price on request"),
--             0    = deliberately free.
--
-- Safe on re-run, and safe on existing data: every current 0 stays 0, keeping
-- today's meaning for any club that really is free. Only rows a human
-- deliberately clears become NULL.

ALTER TABLE club_programs ALTER COLUMN price_cents DROP DEFAULT;
ALTER TABLE club_programs ALTER COLUMN price_cents DROP NOT NULL;

COMMENT ON COLUMN club_programs.price_cents IS
  'What the class costs, in cents. NULL means no price has been set yet and the '
  'site shows "Price on request"; 0 means deliberately free. The two are not '
  'the same claim, so they are not the same value.';
