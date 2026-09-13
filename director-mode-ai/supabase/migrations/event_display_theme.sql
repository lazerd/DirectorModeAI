-- A look for the TV, chosen per event.
--
-- The live console is cast to a screen in the clubhouse, and for a themed
-- social ("US Open watch party", "Oktoberfest") the club wants the screen to
-- look like the occasion rather than like ClubMode.
--
-- A COLUMN, not a branch in the page. Hardcoding one event's look into
-- console/page.tsx ships it to every club, and it is the same mistake as a
-- club's phone number in a .tsx file: the theme is a property of the event.
ALTER TABLE events ADD COLUMN IF NOT EXISTS display_theme TEXT;

COMMENT ON COLUMN events.display_theme IS
  'Named palette for the live console on a TV (see src/lib/events/displayTheme.ts). '
  'NULL means ClubMode''s own look. Never a hex value — a name, so the contrast '
  'of every theme is tested once rather than typed per event.';
