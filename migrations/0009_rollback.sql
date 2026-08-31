-- Rollback for 0009_drop_redundant_indexes.sql
-- Recreate the indexes that were dropped. Safe to re-run on a system that
-- still has the original indexes (CREATE INDEX IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_registrations_comp_team_status
  ON registrations(competition_id, team_profile_id, club_id, status);

CREATE INDEX IF NOT EXISTS idx_club_registration_edit_unlocks_competition
  ON club_registration_edit_unlocks(competition_id, club_id, team_scope);

CREATE INDEX IF NOT EXISTS idx_individual_reg_comp_status_created
  ON individual_registrations(competition_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_individual_reg_phone_created
  ON individual_registrations(phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_individual_registration_events_group
  ON individual_registration_events(group_id, individual_registration_id);
