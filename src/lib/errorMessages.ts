/**
 * 后端错误码 → 用户可见中文消息 单一字典
 *
 * 设计原则：
 * - 保持后端 `HttpError.message` 英文（API 文档语义稳定 + 便于日志检索）
 * - 前端 `normalizeError` 拦截错误时按 `code` 查表替换 `message` 字段
 * - 查不到对应 code 时回退原 message（开发者场景可见真实错误）
 * - 部分 code 故意不写进字典（如 `PGRST116`），保留英文供前端程序员调试
 *
 * 维护规则：
 * 1. 后端新增 `HttpError(code: '...', ...)` 时必须同步在本字典补条目
 * 2. 文案应面向最终用户（俱乐部/管理员），避免技术术语
 * 3. 文案长度控制在 2-30 字，过长信息应放 details
 */

// === HTTP / 通用 ===
const HTTP_GENERIC: Record<string, string> = {
  HTTP_ERROR: '服务器返回了未知错误',
  INTERNAL_ERROR: '服务器内部错误，请稍后重试',
  UNAUTHENTICATED: '请先登录后再操作',
  FORBIDDEN: '没有权限执行此操作',
  FORBIDDEN_COLUMN: '没有权限修改此字段',
  FORBIDDEN_RESOURCE: '没有访问此资源的权限',
  NOT_FOUND: '未找到对应的数据',
  METHOD_NOT_ALLOWED: '操作方式不被允许',
  PAYLOAD_TOO_LARGE: '上传内容超过大小限制',
  UNSUPPORTED_MEDIA_TYPE: '不支持的请求格式',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  BINDING_MISSING: '服务端配置缺失，请联系管理员',
  CORS_ORIGIN_DENIED: '请求来源不被允许',
  BUCKET_NOT_ALLOWED: '存储桶不存在',
};

// === 认证 / 密码 ===
const AUTH: Record<string, string> = {
  INVALID_CREDENTIALS: '用户名或密码错误',
  INVALID_PASSWORD: '密码长度需在 12-256 个字符之间',
  PASSWORD_MISMATCH: '两次输入的密码不一致',
  PASSWORD_RESET_REQUIRED: '请先重置密码后再继续操作',
  PASSWORD_RESET_FAILED: '密码重置失败，请重试',
  INVALID_SESSION: '登录已失效，请重新登录',
  SENSITIVE_COLUMN: '不允许直接修改此敏感字段',
};

// === 赛事 / 截止时间 ===
const COMPETITION: Record<string, string> = {
  COMPETITION_NOT_OPEN: '当前赛事未开放报名',
  DEADLINE_PASSED: '报名截止时间已过，无法提交',
  REGISTRATION_CLOSED: '报名已关闭',
  REGISTRATION_IMMUTABLE: '报名记录已确认，无法修改',
  REGISTRATION_NOT_UNLOCKED: '此报名记录尚未被管理员解锁',
  REGISTRATION_QUOTA_EXCEEDED: '报名限额已达到，请选择其他项目或分组',
  INDIVIDUAL_EVENT_QUOTA_EXCEEDED: '该运动员个人项目报名数已达上限',
  TEAM_EVENT_QUOTA_EXCEEDED: '该队伍集体项目报名数已达上限',
  GROUP_CAPACITY_EXCEEDED: '该组别报名人数已满',
  EVENT_ATHLETE_LIMIT: '所选运动员超过该项目名额',
};

// === 业务校验 ===
const VALIDATION: Record<string, string> = {
  ATHLETE_INELIGIBLE: '该运动员不符合本组报名条件（性别/年龄/出生日期）',
  INVALID_FIELD: '请求字段缺失或格式不正确',
  INVALID_PAYLOAD: '提交的数据格式有误',
  INVALID_COMPETITION: '所选赛事不存在',
  INVALID_EVENT_GROUP: '项目与分组不属于所选赛事',
  INVALID_ATHLETES: '运动员列表必须包含 1-50 个不同的 ID',
  INVALID_REGISTRATIONS: '报名列表必须包含 1-100 项',
  INVALID_ATHLETE_OWNERSHIP: '所有运动员必须属于当前俱乐部与赛事',
  INVALID_OWNED_REFERENCE: '所选队伍/教练员不属于当前俱乐部与赛事',
  INVALID_REVIEW: '审核请求参数有误',
  INVALID_PAGINATION: '分页参数超出范围',
  INVALID_IDEMPOTENCY_KEY: '幂等键格式无效',
  INVALID_STATE_TRANSITION: '不允许的状态变更',
  IMMUTABLE_FIELD: '报名后不可修改此字段',
  EMPTY_UPDATE: '没有可更新的内容',
  STATE_CONFLICT: '数据已被其他操作修改，请刷新后重试',
  DUPLICATE_ENTRY: '已存在相同的报名记录',
  UNIQUE_VIOLATION: '已存在使用相同唯一值的记录',
  FOREIGN_KEY_VIOLATION: '所引用的记录不存在或仍被使用',
  CONSTRAINT_VIOLATION: '提交的数据违反数据库约束',
  WORKFLOW_ENDPOINT_REQUIRED: '此资源只能通过专用工作流接口修改',
  CLUB_NOT_ELIGIBLE: '当前俱乐部尚未通过审核',
};

// === 限报 / 计分 / 出场顺序 ===
const SCORING: Record<string, string> = {
  TEAM_REQUIRED: '请选择具体队伍后再查询',
  ORDER_BOOK_NOT_PUBLISHED: '请先生成并发布出场顺序',
  ORDER_GENERATION_LOCKED: '出场顺序正在生成中，请稍候',
  NO_CURRENT_IMPORT: '当前没有已发布的计分表数据',
  MEDIA_STORAGE_UNAVAILABLE: '媒体存储尚未启用，请联系管理员开通',
};

// === 路径 / 媒体 ===
const MEDIA: Record<string, string> = {
  INVALID_PATH: '请求路径格式无效',
  INVALID_OBJECT_KEY: '对象路径无效',
  OBJECT_NOT_FOUND: '未找到对应的文件',
  INVALID_IMAGE_TYPE: '仅支持 JPEG、PNG、WebP、GIF、AVIF 格式的图片',
  IMAGE_TOO_LARGE: '图片大小超过 2MB 上限',
};

// === 数据库代理 ===
const DB_PROXY: Record<string, string> = {
  TABLE_NOT_ALLOWED: '不允许访问此数据表',
  COLUMN_NOT_ALLOWED: '不允许读取此字段',
  INVALID_COLUMNS: '请求的字段组合无效',
  INVALID_JSON_COLUMN: '该字段必须为合法 JSON',
  INVALID_BOOLEAN: '该字段必须为布尔值',
  INVALID_VALUE: '该字段必须为标量值',
  INVALID_FILTERS: '过滤条件过多',
  INVALID_FILTER: '过滤条件格式无效',
  INVALID_IN_FILTER: 'in 过滤需要 1-100 个值',
  INVALID_ILIKE_FILTER: 'ilike 需要较短的字符串',
  FILTER_NOT_ALLOWED: '不允许的过滤操作',
  FILTER_REQUIRED: '更新/删除需要至少一个过滤条件',
  INVALID_ACTION: '无效的查询操作',
  INVALID_ORDER: '排序参数无效',
  INVALID_LIMIT: '查询数量超出限制',
  INVALID_SINGLE: '无效的单行模式',
  INVALID_COUNT: '仅支持精确计数',
  INVALID_PASSWORD_HASH: '密码哈希格式无效',
  EMPTY_PAYLOAD: '提交内容为空',
};

// === 前端 fetch 兜底 ===
const NETWORK: Record<string, string> = {
  REQUEST_TIMEOUT: '请求超时，请检查网络连接后重试',
  NETWORK_ERROR: '无法连接服务器，请检查网络',
};

/** 完整错误码字典（合并所有分组） */
export const ERROR_MESSAGES: Record<string, string> = {
  ...HTTP_GENERIC,
  ...AUTH,
  ...COMPETITION,
  ...VALIDATION,
  ...SCORING,
  ...MEDIA,
  ...DB_PROXY,
  ...NETWORK,
};

/**
 * 按错误码查表返回中文消息；查不到时回退原 message。
 * - 不传 code 或 code 为 undefined：直接返回 fallback
 * - 传 code 但字典中无条目：返回 fallback（保留原始 message 让开发者可见）
 */
export function lookupErrorMessage(
  code: string | undefined,
  fallback: string,
): string {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] || fallback;
}
