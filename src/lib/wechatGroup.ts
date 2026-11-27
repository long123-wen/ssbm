import { supabase } from '@/lib/supabase';

/** 微信群公告：二维码固定存放在 athlete-avatars 桶的这个 key，管理端可覆盖上传 */
export const WECHAT_QR_KEY = 'wechat-group/qr.jpg';
export const WECHAT_GROUP_TITLE = '德州市首届跳绳比赛';

const baseQrUrl = supabase.storage.from('athlete-avatars').getPublicUrl(WECHAT_QR_KEY).data.publicUrl;

/** 加时间戳绕过浏览器/CDN 缓存，保证管理端换图后刷新即可看到新二维码 */
export function wechatQrUrl(): string {
  const separator = baseQrUrl.includes('?') ? '&' : '?';
  return `${baseQrUrl}${separator}v=${Date.now()}`;
}
