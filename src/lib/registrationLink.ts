// 赛事专属报名链接工具
// 二维码链接格式：https://www.dztsbmxt.top/#club?competition=<赛事ID>
// 登录/注册后 ClubApp 解析该参数，自动选中对应赛事，跳过手动选择页。

const COMPETITION_PARAM = 'competition';

/**
 * 从当前 URL（hash 或 query string）中读取赛事专属链接参数。
 * 兼容两种写法：
 *   https://www.dztsbmxt.top/#club?competition=xxx
 *   https://www.dztsbmxt.top/club.html?competition=xxx
 */
export function getCompetitionIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const questionAt = hash.indexOf('?');
  if (questionAt >= 0) {
    const fromHash = new URLSearchParams(hash.slice(questionAt + 1)).get(COMPETITION_PARAM);
    if (fromHash) return fromHash;
  }
  return new URLSearchParams(window.location.search).get(COMPETITION_PARAM);
}

/**
 * 生成赛事专属报名链接。
 * baseUrl 用当前站点 origin，自动适配生产/测试环境；也可显式传入。
 */
export function buildRegistrationUrl(competitionId: string, baseUrl?: string): string {
  const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://www.dztsbmxt.top');
  return `${origin}/#club?${COMPETITION_PARAM}=${encodeURIComponent(competitionId)}`;
}

/**
 * 清除 URL 中的赛事参数（保留 hash 路由），用 replaceState 不新增历史记录。
 * 用户通过专属链接进入后手动切换赛事时调用，避免刷新又跳回原赛事。
 */
export function clearCompetitionParamFromUrl(): void {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash || '';
  const route = hash.split('?')[0] || '#club';
  const search = new URLSearchParams(window.location.search);
  if (!hash.includes('?') && !search.has(COMPETITION_PARAM)) return;
  search.delete(COMPETITION_PARAM);
  const queryString = search.toString();
  const next = `${window.location.pathname}${queryString ? '?' + queryString : ''}${route}`;
  window.history.replaceState(null, '', next);
}
