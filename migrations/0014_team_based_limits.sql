-- 0014: 集体项目限报按「队伍」计数
-- 背景：limit_configs.max_registrations 此前一律按报名记录数（人）统计。
--       集体项目一条记录包含多名运动员，用户要求「限报1队 = 只进1支队伍」，
--       因此集体项目（events.is_individual = 0）在项目/分组维度改为统计
--       COUNT(DISTINCT COALESCE(NULLIF(team_profile_id,''), club_id))；
--       个人项目仍按报名记录数统计，队伍维度始终按该队报名记录数统计。
-- 口径必须与 functions/_shared/workflows.ts 的 assertLimits() 完全一致。
-- 另：max_registrations = 0 按管理端文案视为「不限制」。

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
       AND lc.max_registrations > 0
       AND (
         SELECT CASE
           WHEN EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id AND e.is_individual = 0)
           THEN COUNT(DISTINCT COALESCE(NULLIF(r.team_profile_id, ''), r.club_id))
           ELSE COUNT(*)
         END
         FROM registrations r
         WHERE r.competition_id = NEW.competition_id
           AND r.group_id = NEW.group_id
           AND r.status IN ('pending', 'confirmed')
       ) >= lc.max_registrations
   )
   OR EXISTS (
     SELECT 1 FROM limit_configs lc
     WHERE lc.competition_id = NEW.competition_id
       AND lc.scope = 'event'
       AND lc.target_id = NEW.event_id
       AND lc.max_registrations > 0
       AND (
         SELECT CASE
           WHEN EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id AND e.is_individual = 0)
           THEN COUNT(DISTINCT COALESCE(NULLIF(r.team_profile_id, ''), r.club_id))
           ELSE COUNT(*)
         END
         FROM registrations r
         WHERE r.competition_id = NEW.competition_id
           AND r.event_id = NEW.event_id
           AND r.status IN ('pending', 'confirmed')
       ) >= lc.max_registrations
   )
   OR EXISTS (
     SELECT 1 FROM limit_configs lc
     WHERE lc.competition_id = NEW.competition_id
       AND lc.scope = 'team'
       AND lc.target_id = COALESCE(NULLIF(NEW.team_profile_id, ''), NEW.club_id)
       AND lc.max_registrations > 0
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
       AND lc.max_registrations > 0
       AND (
         SELECT CASE
           WHEN EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id AND e.is_individual = 0)
           THEN COUNT(DISTINCT COALESCE(NULLIF(r.team_profile_id, ''), r.club_id))
           ELSE COUNT(*)
         END
         FROM registrations r
         WHERE r.competition_id = NEW.competition_id
           AND r.group_id = NEW.group_id
           AND r.status IN ('pending', 'confirmed')
       ) >= lc.max_registrations
   )
   OR EXISTS (
     SELECT 1 FROM limit_configs lc
     WHERE lc.competition_id = NEW.competition_id
       AND lc.scope = 'event'
       AND lc.target_id = NEW.event_id
       AND lc.max_registrations > 0
       AND (
         SELECT CASE
           WHEN EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id AND e.is_individual = 0)
           THEN COUNT(DISTINCT COALESCE(NULLIF(r.team_profile_id, ''), r.club_id))
           ELSE COUNT(*)
         END
         FROM registrations r
         WHERE r.competition_id = NEW.competition_id
           AND r.event_id = NEW.event_id
           AND r.status IN ('pending', 'confirmed')
       ) >= lc.max_registrations
   )
   OR EXISTS (
     SELECT 1 FROM limit_configs lc
     WHERE lc.competition_id = NEW.competition_id
       AND lc.scope = 'team'
       AND lc.target_id = COALESCE(NULLIF(NEW.team_profile_id, ''), NEW.club_id)
       AND lc.max_registrations > 0
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
