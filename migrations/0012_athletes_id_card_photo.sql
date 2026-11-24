-- 0012: athletes.id_card_photo
-- 身份证照片（敏感信息）：存储 athlete-avatars R2 bucket 中 idcard/<clubId>/ 前缀下的对象路径，
-- 读取走 /storage/athlete-avatars/object/... 需登录鉴权，不生成公开链接。
-- 存量运动员该列为 NULL（不受影响，仅新增运动员强制上传）。
ALTER TABLE athletes ADD COLUMN id_card_photo TEXT;
