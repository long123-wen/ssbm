-- Administrator-controlled club registration editing.
-- Keeps the submitted registration visible until a club submits its revised full list.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS club_registration_edit_unlocks (
  competition_id TEXT NOT NULL,
  club_id TEXT NOT NULL,
  team_scope TEXT NOT NULL DEFAULT '',
  unlocked_by TEXT NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (competition_id, club_id, team_scope),
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE,
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_club_registration_edit_unlocks_competition
  ON club_registration_edit_unlocks(competition_id, club_id, team_scope);
