CREATE TABLE IF NOT EXISTS scorecard_imports (
  id TEXT PRIMARY KEY NOT NULL,
  competition_id TEXT NOT NULL,
  source_order_book_id TEXT NOT NULL,
  source_order_book_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('building','published','failed')),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  entry_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE (competition_id, source_order_book_id),
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_order_book_id) REFERENCES order_books(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS scorecard_entries (
  id TEXT PRIMARY KEY NOT NULL,
  scorecard_import_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  order_book_entry_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  team_profile_id TEXT,
  club_id TEXT NOT NULL,
  club_name TEXT NOT NULL,
  team_name TEXT,
  event_name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  session_label TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  venue_number INTEGER NOT NULL,
  athlete_names TEXT NOT NULL CHECK (json_valid(athlete_names)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (scorecard_import_id, order_book_entry_id),
  FOREIGN KEY (scorecard_import_id) REFERENCES scorecard_imports(id) ON DELETE CASCADE,
  FOREIGN KEY (order_book_entry_id) REFERENCES order_book_entries(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_scorecard_imports_current ON scorecard_imports(competition_id, is_current, imported_at);
CREATE INDEX IF NOT EXISTS idx_scorecard_entries_team ON scorecard_entries(competition_id, team_profile_id, scorecard_import_id);
CREATE INDEX IF NOT EXISTS idx_scorecard_entries_club ON scorecard_entries(competition_id, club_id, scorecard_import_id);

CREATE TRIGGER IF NOT EXISTS trg_scorecard_imports_current_update
AFTER INSERT ON scorecard_imports
WHEN NEW.is_current = 1
BEGIN
  UPDATE scorecard_imports SET is_current = 0 WHERE competition_id = NEW.competition_id AND id <> NEW.id;
END;
