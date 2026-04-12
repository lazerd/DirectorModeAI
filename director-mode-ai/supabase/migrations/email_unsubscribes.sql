-- Email unsubscribe blocklist.
--
-- One row per (email, scope) combination a recipient has opted out of. The
-- core "CAN-SPAM compliant unsubscribe link" is scope = 'all' — that blocks
-- every outbound email to the address. Future-friendly: scope can be
-- 'leagues', 'lessons', 'courtconnect', 'stringing', 'marketing' etc. so we
-- can later offer per-product opt-outs without a schema change.
--
-- Pre-send path (src/lib/emailUnsubscribe.ts) queries this table and skips
-- the send if a matching row exists. The /unsubscribe page inserts here
-- after verifying an HMAC-signed token from the email footer.
--
-- Idempotent: DO block checks information_schema before creating so
-- re-running the migration is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'email_unsubscribes'
  ) THEN
    CREATE TABLE public.email_unsubscribes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'all',
      unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(email, scope)
    );

    CREATE INDEX idx_email_unsubscribes_email ON public.email_unsubscribes(email);

    -- Service role handles all writes/reads. RLS is enabled but no
    -- policies → anon and authenticated users cannot touch this table
    -- directly. The lib code uses the admin client, so it bypasses RLS.
    ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
