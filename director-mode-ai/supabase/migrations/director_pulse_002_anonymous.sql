-- Director Pulse without sign-in: a contributor is identified by a private
-- access token (sent to their email as a "your results" link, and kept in a
-- cookie). Signed-in contributors still key on profile_id.
ALTER TABLE director_pulse ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE director_pulse ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE director_pulse ADD COLUMN IF NOT EXISTS access_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_director_pulse_token ON director_pulse(access_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_director_pulse_email ON director_pulse(lower(email)) WHERE email IS NOT NULL;
