-- ============================================================
-- Migration 0005: 完整下线个人报名通道
-- 触发原因：系统统一只走俱乐部报名，个人报名入口/审核/接口/数据
--           已全部从前端 + 后端移除，本迁移清理 D1 中残留的
--           individual_* 表、字段、索引与触发器。
-- ============================================================
-- 与之配套的代码变更：
--   - functions/api/[[path]].ts       删 /api/individual/* 路由
--   - functions/_shared/workflows.ts  删 createIndividualRegistration
--   - src/sections/individual/*       整目录删除
--   - src/sections/admin/AdminIndividualRegistrations.tsx 删除
--   - src/individual-main.tsx         删除
--   - src/types/index.ts              删 5 个 Competition individual 字段
--                                     + IndividualRegStatus/IndividualRegistration 类型
--   - src/lib/store.ts                删 individualRegistrationStore + 5 字段映射
--   - src/lib/supabase.ts             删 individualStatusQuery + TABLES.individual_registrations
--   - src/sections/admin/CompetitionSelector.tsx 删个人报名配置 UI
--   - vite.config.ts                  删 individual html input
--   - individual.html                 删除
-- ============================================================
-- 保留（项目级别属性，不属于个人报名通道）：
--   - competitions.max_individual_events  限报项数（与个人报名通道无关）
--   - events.is_individual                项目级别的"个人赛 / 集体赛"属性
-- ============================================================
-- 注意：registration_state_transitions / review_jobs 表中的
--       registration_type CHECK 约束当前允许 'individual'。SQLite 不支持
--       ALTER TABLE DROP CONSTRAINT，必须重建表才能去掉该值。
--       实际业务不再写入 individual，保留值仅影响入参校验，迁移不做处理。
-- ============================================================

PRAGMA foreign_keys = OFF;

-- ========== 1. 触发器（先于表删除） ==========
DROP TRIGGER IF EXISTS trg_individual_event_capacity_before_insert;
DROP TRIGGER IF EXISTS trg_individual_event_count_after_insert;
DROP TRIGGER IF EXISTS trg_individual_event_count_after_delete;
DROP TRIGGER IF EXISTS trg_individual_event_count_after_status;

-- ========== 2. 索引（先于表删除） ==========
DROP INDEX IF EXISTS idx_individual_registration_events_group;
DROP INDEX IF EXISTS idx_individual_reg_comp_status_created;
DROP INDEX IF EXISTS idx_individual_reg_phone_created;

-- ========== 3. 子表（individual_registration_events）==========
-- 该表在 0002 引入，依赖 individual_registrations
DROP TABLE IF EXISTS individual_registration_events;

-- ========== 4. 主表（individual_registrations）==========
DROP TABLE IF EXISTS individual_registrations;

-- ========== 5. competitions 表的 5 个个人报名专属字段 ==========
-- 个人报名开关
ALTER TABLE competitions DROP COLUMN individual_registration_enabled;
-- 个人报名开放时间
ALTER TABLE competitions DROP COLUMN individual_open_at;
-- 个人报名截止时间
ALTER TABLE competitions DROP COLUMN individual_deadline;
-- 个人报名自定义扩展字段定义
ALTER TABLE competitions DROP COLUMN individual_form_schema;
-- 个人报名须知
ALTER TABLE competitions DROP COLUMN individual_notes;

-- ========== 6. event_groups.current_count 修复 ==========
-- 0002 末尾的 current_count 修复 SQL 把 individual_registration_events 也算进了计数。
-- 由于前面已经 DROP 该子表，这里手动重算一次，去掉已经不存在的 individual 计数。
UPDATE event_groups
SET current_count = (
  SELECT COUNT(*) FROM registrations r WHERE r.group_id = event_groups.id AND r.status IN ('pending','confirmed')
), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

PRAGMA foreign_keys = ON;
