-- 0007 回滚：恢复 event_groups.max_registrations 维度的容量拦截
-- 用途：若统一限报到 limit_configs 后出现问题，执行本文件即可恢复旧行为

DROP TRIGGER IF EXISTS trg_registrations_capacity_before_insert_v2;
DROP TRIGGER IF EXISTS trg_registrations_capacity_before_activate_v2;

CREATE TRIGGER trg_registrations_capacity_before_insert_v2
BEFORE INSERT ON registrations
WHEN NEW.status IN ('pending','confirmed')
 AND COALESCE((SELECT current_count >= max_registrations FROM event_groups WHERE id = NEW.group_id), 1)
BEGIN
  SELECT RAISE(ABORT, 'GROUP_CAPACITY_EXCEEDED');
END;

CREATE TRIGGER trg_registrations_capacity_before_activate_v2
BEFORE UPDATE OF status ON registrations
WHEN OLD.status = 'rejected' AND NEW.status IN ('pending','confirmed')
 AND COALESCE((SELECT current_count >= max_registrations FROM event_groups WHERE id = NEW.group_id), 1)
BEGIN
  SELECT RAISE(ABORT, 'GROUP_CAPACITY_EXCEEDED');
END;
