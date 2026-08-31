-- 0008: limit_configs 原子限报约束
-- 说明：SQLite 写事务是串行的；BEFORE INSERT/UPDATE 触发器在同一事务内读取当前计数，
--       由数据库最终拒绝超限写入，避免先 COUNT 后 INSERT 的并发竞态。

DROP TRIGGER IF EXISTS trg_registrations_capacity_before_insert_v2;
DROP TRIGGER IF EXISTS trg_registrations_capacity_before_activate_v2;
DROP TRIGGER IF EXISTS trg_limit_configs_before_registration_insert;
DROP TRIGGER IF EXISTS trg_limit_configs_before_registration_activate;

CREATE TRIGGER trg_limit_configs_before_registration_insert
BEFORE INSERT ON registrations
WHEN NEW.status IN ('pending', 'confirmed')
 AND (
   EXISTS (
     SELECT 1 FROM limit_configs lc
     WHERE lc.competition_id = NEW.competition_id
       AND lc.scope = 'group'
       AND lc.target_id = NEW.group_id
       AND lc.max_registrations IS NOT NULL
       AND (SELECT COUNT(*) FROM registrations r
            WHERE r.competition_id = NEW.competition_id
              AND r.group_id = NEW.group_id
              AND r.status IN ('pending', 'confirmed')) >= lc.max_registrations
   )
   OR EXISTS (
     SELECT 1 FROM limit_configs lc
     WHERE lc.competition_id = NEW.competition_id
       AND lc.scope = 'event'
       AND lc.target_id = NEW.event_id
       AND lc.max_registrations IS NOT NULL
       AND (SELECT COUNT(*) FROM registrations r
            WHERE r.competition_id = NEW.competition_id
              AND r.event_id = NEW.event_id
              AND r.status IN ('pending', 'confirmed')) >= lc.max_registrations
   )
   OR EXISTS (
     SELECT 1 FROM limit_configs lc
     WHERE lc.competition_id = NEW.competition_id
       AND lc.scope = 'team'
       AND lc.target_id = COALESCE(NULLIF(NEW.team_profile_id, ''), NEW.club_id)
       AND lc.max_registrations IS NOT NULL
       AND (SELECT COUNT(*) FROM registrations r
            WHERE r.competition_id = NEW.competition_id
              AND r.status IN ('pending', 'confirmed')
              AND r.id <> NEW.id
              AND ((NEW.team_profile_id IS NOT NULL AND NEW.team_profile_id <> '' AND r.team_profile_id = NEW.team_profile_id)
                OR ((NEW.team_profile_id IS NULL OR NEW.team_profile_id = '') AND r.club_id = NEW.club_id))) >= lc.max_registrations
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'LIMIT_CONFIGS_QUOTA_EXCEEDED');
END;

CREATE TRIGGER trg_limit_configs_before_registration_activate
BEFORE UPDATE OF status ON registrations
WHEN OLD.status NOT IN ('pending', 'confirmed')
 AND NEW.status IN ('pending', 'confirmed')
 AND (
   EXISTS (
     SELECT 1 FROM limit_configs lc
     WHERE lc.competition_id = NEW.competition_id
       AND lc.scope = 'group'
       AND lc.target_id = NEW.group_id
       AND lc.max_registrations IS NOT NULL
       AND (SELECT COUNT(*) FROM registrations r
            WHERE r.competition_id = NEW.competition_id
              AND r.group_id = NEW.group_id
              AND r.status IN ('pending', 'confirmed')) >= lc.max_registrations
   )
   OR EXISTS (
     SELECT 1 FROM limit_configs lc
     WHERE lc.competition_id = NEW.competition_id
       AND lc.scope = 'event'
       AND lc.target_id = NEW.event_id
       AND lc.max_registrations IS NOT NULL
       AND (SELECT COUNT(*) FROM registrations r
            WHERE r.competition_id = NEW.competition_id
              AND r.event_id = NEW.event_id
              AND r.status IN ('pending', 'confirmed')) >= lc.max_registrations
   )
   OR EXISTS (
     SELECT 1 FROM limit_configs lc
     WHERE lc.competition_id = NEW.competition_id
       AND lc.scope = 'team'
       AND lc.target_id = COALESCE(NULLIF(NEW.team_profile_id, ''), NEW.club_id)
       AND lc.max_registrations IS NOT NULL
       AND (SELECT COUNT(*) FROM registrations r
            WHERE r.competition_id = NEW.competition_id
              AND r.status IN ('pending', 'confirmed')
              AND ((NEW.team_profile_id IS NOT NULL AND NEW.team_profile_id <> '' AND r.team_profile_id = NEW.team_profile_id)
                OR ((NEW.team_profile_id IS NULL OR NEW.team_profile_id = '') AND r.club_id = NEW.club_id))) >= lc.max_registrations
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'LIMIT_CONFIGS_QUOTA_EXCEEDED');
END;

-- 修复迁移前可能已经产生的计数漂移。
UPDATE event_groups
SET current_count = (
  SELECT COUNT(*) FROM registrations r
  WHERE r.group_id = event_groups.id AND r.status IN ('pending', 'confirmed')
), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

CREATE INDEX IF NOT EXISTS idx_registrations_comp_event_status
  ON registrations(competition_id, event_id, status);
CREATE INDEX IF NOT EXISTS idx_registrations_comp_group_status
  ON registrations(competition_id, group_id, status);
-- NOTE: idx_registrations_comp_team_status removed; see migrations/0009 for rationale
--   (the planner never selected it; covered by idx_registrations_club_team_created +
--    idx_registrations_comp_status_created). 0009 also drops it from existing D1s.
