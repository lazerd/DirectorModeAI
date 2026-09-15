-- ============================================
-- Club Sites — embedding on a club's existing website, and large text.
-- ============================================
-- Two additive columns on club_site. Both have defaults, so every existing row
-- keeps rendering exactly as it does today.
--
-- embed_origins
--   The websites allowed to show this club's pages inside an <iframe>, e.g.
--   {https://www.rossmoortennis.com, https://rtc.wildapricot.org}. Middleware
--   turns it into `Content-Security-Policy: frame-ancestors 'self' <origins>`
--   on `?embed=1` requests. EMPTY means "any site may embed the public pages" —
--   see lib/clubSite/embed.ts for why that is the default and what it costs.
--   Stored normalised (scheme + host [+ port], no path) by the Zod schema; the
--   middleware re-validates anyway, because this string ends up in a header.
--
-- text_size
--   'standard' | 'large'. Large is for clubs whose members are mostly older
--   (Rossmoor is a 55+ community): ~19px body text, 44px tap targets, darker
--   secondary text. Resolved in lib/clubSite/theme.ts.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE club_site
  ADD COLUMN IF NOT EXISTS embed_origins TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE club_site
  ADD COLUMN IF NOT EXISTS text_size TEXT NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'club_site_text_size_check'
  ) THEN
    ALTER TABLE club_site
      ADD CONSTRAINT club_site_text_size_check CHECK (text_size IN ('standard', 'large'));
  END IF;
END $$;
