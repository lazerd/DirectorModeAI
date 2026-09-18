-- The coach going to one particular match (JTT: Coach Alex takes the 12U to
-- Moraga CC on 9/27). Points at a team contact, so the name, email and phone
-- come from the one place they are already kept. Set null if the contact is
-- removed, so the match never points at nobody.
alter table captain_matches
  add column if not exists match_coach_id uuid
  references captain_team_contacts(id) on delete set null;
