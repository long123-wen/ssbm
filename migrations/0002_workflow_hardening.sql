-- Workflow hardening. This is additive: 0001_initial_schema.sql remains immutable.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS registration_athletes (
  registration_id TEXT NOT NULL,
  athlete_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (registration_id, athlete_id),
  FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS individual_registration_events (
  individual_registration_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (individual_registration_id, event_id, group_id),
  FOREIGN KEY (individual_registration_id) REFERENCES individual_registrations(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  FOREIGN KEY (event_id, group_id) REFERENCES event_groups(event_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS registration_state_transitions (
  id TEXT PRIMARY KEY NOT NULL,
  registration_type TEXT NOT NULL CHECK (registration_type IN ('club','individual')),
  registration_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('pending','confirmed','rejected')),
  reason TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('club','admin','system')),
  actor_id TEXT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS workflow_idempotency (
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (actor_type, actor_id, idempotency_key, operation)
);

CREATE TABLE IF NOT EXISTS review_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  registration_type TEXT NOT NULL CHECK (registration_type IN ('club','individual')),
  competition_id TEXT,
  requested_action TEXT NOT NULL CHECK (requested_action IN ('confirmed','rejected')),
  reject_reason TEXT,
  requested_by TEXT NOT NULL,
  request_id TEXT NOT NULL,
  total_count INTEGER NOT NULL,
  processed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS review_job_items (
  job_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('updated','skipped')),
  detail TEXT,
  PRIMARY KEY (job_id, registration_id),
  FOREIGN KEY (job_id) REFERENCES review_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_books (
  id TEXT PRIMARY KEY NOT NULL,
  competition_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('building','published','failed')),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  is_stale INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0,1)),
  entry_count INTEGER NOT NULL DEFAULT 0,
  generated_by TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  published_at TEXT,
  stale_at TEXT,
  UNIQUE (competition_id, version),
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_book_entries (
  id TEXT PRIMARY KEY NOT NULL,
  order_book_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  start_order INTEGER NOT NULL CHECK (start_order > 0),
  session_label TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  venue_number INTEGER NOT NULL,
  bib_number TEXT NOT NULL,
  club_id TEXT NOT NULL,
  club_name TEXT NOT NULL,
  athletes TEXT NOT NULL CHECK (json_valid(athletes)),
  coach_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (order_book_id, registration_id),
  UNIQUE (order_book_id, start_order),
  FOREIGN KEY (order_book_id) REFERENCES order_books(id) ON DELETE CASCADE,
  FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS order_generation_locks (
  competition_id TEXT PRIMARY KEY NOT NULL,
  lock_token TEXT NOT NULL,
  locked_by TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_registration_athletes_athlete ON registration_athletes(athlete_id, registration_id);
CREATE INDEX IF NOT EXISTS idx_individual_registration_events_group ON individual_registration_events(group_id, individual_registration_id);
CREATE INDEX IF NOT EXISTS idx_transitions_registration ON registration_state_transitions(registration_type, registration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_jobs_requested_by ON review_jobs(requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_books_current ON order_books(competition_id, is_current, is_stale);
CREATE INDEX IF NOT EXISTS idx_order_book_entries_competition ON order_book_entries(competition_id, order_book_id, start_order);

-- Replace count triggers so only pending/confirmed registrations consume a group slot.
DROP TRIGGER IF EXISTS trg_registrations_capacity_before_insert;
DROP TRIGGER IF EXISTS trg_registrations_count_after_insert;
DROP TRIGGER IF EXISTS trg_registrations_count_after_delete;
DROP TRIGGER IF EXISTS trg_registrations_count_after_group_change;

CREATE TRIGGER IF NOT EXISTS trg_registrations_capacity_before_insert_v2
BEFORE INSERT ON registrations
WHEN NEW.status IN ('pending','confirmed')
 AND COALESCE((SELECT current_count >= max_registrations FROM event_groups WHERE id = NEW.group_id), 1)
BEGIN
  SELECT RAISE(ABORT, 'GROUP_CAPACITY_EXCEEDED');
END;

CREATE TRIGGER IF NOT EXISTS trg_registrations_capacity_before_activate_v2
BEFORE UPDATE OF status ON registrations
WHEN OLD.status = 'rejected' AND NEW.status IN ('pending','confirmed')
 AND COALESCE((SELECT current_count >= max_registrations FROM event_groups WHERE id = NEW.group_id), 1)
BEGIN
  SELECT RAISE(ABORT, 'GROUP_CAPACITY_EXCEEDED');
END;

CREATE TRIGGER IF NOT EXISTS trg_registrations_count_after_insert_v2
AFTER INSERT ON registrations
WHEN NEW.status IN ('pending','confirmed')
BEGIN
  UPDATE event_groups SET current_count = current_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.group_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_registrations_count_after_delete_v2
AFTER DELETE ON registrations
WHEN OLD.status IN ('pending','confirmed')
BEGIN
  UPDATE event_groups SET current_count = MAX(0, current_count - 1), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.group_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_registrations_count_after_status_v2
AFTER UPDATE OF status ON registrations
WHEN OLD.status <> NEW.status
BEGIN
  UPDATE event_groups
     SET current_count = MAX(0, current_count + CASE WHEN NEW.status IN ('pending','confirmed') THEN 1 ELSE 0 END - CASE WHEN OLD.status IN ('pending','confirmed') THEN 1 ELSE 0 END),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id = NEW.group_id;
END;

-- Normalized athlete rows make duplicate event entries impossible even under concurrent requests.
CREATE TRIGGER IF NOT EXISTS trg_registration_athlete_duplicate_event
BEFORE INSERT ON registration_athletes
WHEN EXISTS (
  SELECT 1 FROM registration_athletes existing
  JOIN registrations r_existing ON r_existing.id = existing.registration_id
  JOIN registrations r_new ON r_new.id = NEW.registration_id
  WHERE existing.athlete_id = NEW.athlete_id
    AND r_existing.competition_id = r_new.competition_id
    AND r_existing.event_id = r_new.event_id
    AND r_existing.id <> NEW.registration_id
    AND r_existing.status IN ('pending','confirmed')
)
BEGIN
  SELECT RAISE(ABORT, 'DUPLICATE_ENTRY');
END;

CREATE TRIGGER IF NOT EXISTS trg_individual_event_capacity_before_insert
BEFORE INSERT ON individual_registration_events
WHEN COALESCE((SELECT current_count >= max_registrations FROM event_groups WHERE id = NEW.group_id), 1)
BEGIN
  SELECT RAISE(ABORT, 'GROUP_CAPACITY_EXCEEDED');
END;

CREATE TRIGGER IF NOT EXISTS trg_individual_event_count_after_insert
AFTER INSERT ON individual_registration_events
WHEN (SELECT status FROM individual_registrations WHERE id = NEW.individual_registration_id) IN ('pending','confirmed')
BEGIN
  UPDATE event_groups SET current_count = current_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.group_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_individual_event_count_after_delete
AFTER DELETE ON individual_registration_events
WHEN (SELECT status FROM individual_registrations WHERE id = OLD.individual_registration_id) IN ('pending','confirmed')
BEGIN
  UPDATE event_groups SET current_count = MAX(0, current_count - 1), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.group_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_individual_event_count_after_status
AFTER UPDATE OF status ON individual_registrations
WHEN OLD.status <> NEW.status
BEGIN
  UPDATE event_groups
     SET current_count = MAX(0, current_count + CASE WHEN NEW.status IN ('pending','confirmed') THEN 1 ELSE 0 END - CASE WHEN OLD.status IN ('pending','confirmed') THEN 1 ELSE 0 END),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id IN (SELECT group_id FROM individual_registration_events WHERE individual_registration_id = NEW.id);
END;

-- Current published order remains readable, but changes invalidate it immediately.
CREATE TRIGGER IF NOT EXISTS trg_order_book_stale_after_registration_insert
AFTER INSERT ON registrations BEGIN
  UPDATE order_books SET is_stale = 1, stale_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE competition_id = NEW.competition_id AND is_current = 1 AND status = 'published';
END;
CREATE TRIGGER IF NOT EXISTS trg_order_book_stale_after_registration_delete
AFTER DELETE ON registrations BEGIN
  UPDATE order_books SET is_stale = 1, stale_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE competition_id = OLD.competition_id AND is_current = 1 AND status = 'published';
END;
CREATE TRIGGER IF NOT EXISTS trg_order_book_stale_after_registration_change
AFTER UPDATE OF status, event_id, group_id, athletes, coach_id, team_profile_id ON registrations BEGIN
  UPDATE order_books SET is_stale = 1, stale_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE competition_id = NEW.competition_id AND is_current = 1 AND status = 'published';
END;

-- Repair historical count drift once while the migration is applied.
UPDATE event_groups
SET current_count = (
  SELECT COUNT(*) FROM registrations r WHERE r.group_id = event_groups.id AND r.status IN ('pending','confirmed')
) + (
  SELECT COUNT(*) FROM individual_registration_events ire
  JOIN individual_registrations ir ON ir.id = ire.individual_registration_id
  WHERE ire.group_id = event_groups.id AND ir.status IN ('pending','confirmed')
), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
