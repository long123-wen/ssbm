-- 0011: competitions.force_open
-- 管理端「特殊情况强制开放」开关：到报名截止时间自动截止后，
-- 管理端可一键将 force_open 置 1，跳过截止时间校验恢复正常报名；
-- 再次关闭即恢复截止。status 仍须为 'open' 才生效。
ALTER TABLE competitions ADD COLUMN force_open INTEGER NOT NULL DEFAULT 0;
