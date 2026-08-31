-- 0007: 统一限报规则到 limit_configs
--
-- 背景：项目 & 分组页的限报 UI 已移除，限报统一在「限报配置」页设置（limit_configs 表）。
-- 但 event_groups.max_registrations（DB DEFAULT 20）仍被两个 trigger 用于硬性拦截，
-- 导致即便在 limit_configs 配置了更大的上限，实际仍被 DB 拦在 20 人/组。
--
-- 本迁移：删除这两个 trigger，让限报校验**只**由后端 assertLimits（读 limit_configs）负责。
--
-- 注意：event_groups.max_registrations 列保留（NOT NULL DEFAULT 20），
-- 但删除 trigger 后它不再参与任何校验，仅作为历史字段存在。
--
-- 回滚：见 migrations/0007_rollback.sql（重建 trigger 即恢复旧行为）

DROP TRIGGER IF EXISTS trg_registrations_capacity_before_insert_v2;
DROP TRIGGER IF EXISTS trg_registrations_capacity_before_activate_v2;
