-- club_programs.registration_mode gains 'drop_in': play that needs no sign-up.
--
-- 'closed' told a visitor "Registration for this class is closed" about
-- Rossmoor's Tuesday drop-in, which is open to every resident and has never
-- had a sign-up. That reads as "you can't come". A drop-in is not a closed
-- class, so it gets its own mode and its own sentence.

ALTER TABLE club_programs DROP CONSTRAINT IF EXISTS club_programs_registration_mode_check;
ALTER TABLE club_programs ADD CONSTRAINT club_programs_registration_mode_check
  CHECK (registration_mode IN ('online', 'email', 'closed', 'drop_in'));
