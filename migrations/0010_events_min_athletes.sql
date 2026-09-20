-- 0010: events 增加最少参赛人数（集体套路类项目有下限要求，如 6-12 人 / 9-18 人）
--
-- 语义：
--   min_athletes = 0（默认）→ 不限制最少人数，行为与迁移前完全一致
--   min_athletes > 0        → 报名时该项目的参赛运动员数不得少于该值
--
-- SQLite 的 ALTER TABLE ADD COLUMN 支持 NOT NULL + 常量 DEFAULT，历史行自动填 0，
-- 因此本迁移对存量数据与存量代码是向后兼容的（旧代码忽略该列即可）。
ALTER TABLE events ADD COLUMN min_athletes INTEGER NOT NULL DEFAULT 0;
