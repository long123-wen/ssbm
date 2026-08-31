import type { Env } from './types';

/**
 * R2 工具集：负责把 `avatar_url` 解析为 R2 object key 并安全删除。
 *
 * R2 key 约定：
 *   bucket 永远是 `athlete-avatars`
 *   key    形如 `athlete-avatars/{path}`
 *
 * avatar_url 的多种格式（历史上前后端迁移过）：
 *   1) 新版：https://<host>/storage/athlete-avatars/object/<path>
 *      —— 这是 R2 兼容层的 GET 路径，path = R2 中除桶名后的剩余部分
 *   2) 历史 Supabase：https://<supabase>/storage/v1/object/public/athlete-avatars/<path>
 *      —— 旧 Supabase Storage 公网 URL（与本项目现网 R2 无关，跳过即可）
 *   3) data:base64 URI / 第三方 URL / null —— 跳过
 *
 * parseAthleteAvatarKey 只在 URL 命中本项目自己服务的 athlete-avatars 桶时才返回 key；
 * 其他情况返回 null，让调用方静默忽略。
 */
const ATHLETE_BUCKET = 'athlete-avatars';

function isSafeKeySegment(value: string): boolean {
  // 只允许 R2 key 常见字符：字母 / 数字 / . / - / _ / / （路径分隔符）
  // 禁止 \、空、..、../
  return !!value && !value.includes('\\') && value !== '.' && value !== '..' && !value.split('/').some(part => part === '' || part === '.' || part === '..');
}

/**
 * 从 avatar_url 提取 R2 object key（含桶名），无法识别时返回 null。
 *
 * 注意：本函数不会抛错。即使 URL 解析失败也只返回 null，调用方应静默跳过。
 */
export function parseAthleteAvatarKey(rawUrl: string | null | undefined): string | null {
  if (typeof rawUrl !== 'string' || !rawUrl) return null;
  // data: / http(s):// 之外直接返回
  if (rawUrl.startsWith('data:')) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const pathSegments = url.pathname.split('/').filter(Boolean);
  // 模式 1：/storage/athlete-avatars/object/<encoded path>
  const objectIdx = pathSegments.indexOf('object');
  if (objectIdx >= 1 && pathSegments[objectIdx - 1] === ATHLETE_BUCKET) {
    const encoded = pathSegments.slice(objectIdx + 1).join('/');
    if (!encoded) return null;
    const path = decodeURIComponent(encoded);
    if (!isSafeKeySegment(path)) return null;
    return `${ATHLETE_BUCKET}/${path}`;
  }
  // 模式 2：/storage/v1/object/public/athlete-avatars/<path> —— Supabase 旧格式，跳过
  // 我们不再支持 Supabase bucket，所以这里只识别路径后缀并继续尝试扣 key，
  // 但不在本项目内删除（这些文件本就不在本 R2 中），返回 null 即可。
  const publicIdx = pathSegments.indexOf('public');
  if (publicIdx >= 1 && pathSegments[publicIdx - 1] === 'object' && pathSegments[publicIdx + 1] === ATHLETE_BUCKET) {
    // 兼容性兜底：如果未来项目又迁回 Supabase，把这一行删掉即可恢复删除
    return null;
  }
  // 模式 3：直接给的 key 形式 `athlete-avatars/xxx.jpg`（极少出现，谨慎处理）
  if (pathSegments[0] === ATHLETE_BUCKET && pathSegments.length > 1) {
    const path = pathSegments.slice(1).join('/');
    if (isSafeKeySegment(path)) return `${ATHLETE_BUCKET}/${path}`;
  }
  return null;
}

/**
 * 提取一个 row 列表中所有可识别的 R2 key（去重），找不到或 R2 未启用时返回空数组。
 */
export function collectAthleteAvatarKeys<T>(rows: readonly T[], urlField: keyof T): string[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const keys = new Set<string>();
  for (const row of rows) {
    const key = parseAthleteAvatarKey(row?.[urlField] as string | null | undefined);
    if (key) keys.add(key);
  }
  return Array.from(keys);
}

/**
 * 删除单个 R2 对象。失败仅 warn，不抛错（避免主请求因清理失败而失败）。
 */
export async function deleteR2ByKey(env: Env, key: string): Promise<void> {
  if (!env.REGISTRATION_MEDIA) return;
  if (!key || !isSafeKeySegment(key.slice(ATHLETE_BUCKET.length + 1))) {
    console.warn(`[r2] refuse to delete unsafe key: ${key}`);
    return;
  }
  try {
    await env.REGISTRATION_MEDIA.delete(key);
  } catch (err) {
    console.warn(`[r2] delete failed for key=${key}:`, (err as Error)?.message || err);
  }
}

/**
 * 批量删除 R2 对象。R2.delete() 实际只接受 string[]，所以这里循环调用以保证安全。
 * 所有失败仅 warn，不抛错。
 */
export async function deleteR2ByKeys(env: Env, keys: readonly string[]): Promise<void> {
  if (!env.REGISTRATION_MEDIA) return;
  if (!Array.isArray(keys) || keys.length === 0) return;
  // R2 每次 delete() 接受最多 1000 个 key，但本项目头像文件 key 较少，逐个调用足够；
  // 同时为防止单个 key 异常阻塞整批，按 50 个一组分批。
  const CHUNK = 50;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const batch = keys.slice(i, i + CHUNK);
    const safeBatch = batch.filter(key => key && isSafeKeySegment(key.slice(ATHLETE_BUCKET.length + 1)));
    if (safeBatch.length === 0) continue;
    try {
      // R2 的真实 API 支持 delete(keys: string[])，但本项目里 R2Bucket.delete 仅声明单 key。
      // 兼容性处理：依次调用。
      for (const key of safeBatch) {
        try {
          await env.REGISTRATION_MEDIA.delete(key);
        } catch (err) {
          console.warn(`[r2] delete failed for key=${key}:`, (err as Error)?.message || err);
        }
      }
    } catch (err) {
      console.warn(`[r2] batch delete failed (offset=${i}):`, (err as Error)?.message || err);
    }
  }
}
