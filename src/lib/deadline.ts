/**
 * 报名截止时间统一校验（前端镜像）。
 *
 * 必须与 functions/_shared/deadline.ts 保持完全一致的语义：
 *  1. status !== 'open'  → COMPETITION_NOT_OPEN
 *  2. deadline='YYYY-MM-DD' → 该日 23:59:59.999 之前可报，之后 → DEADLINE_PASSED
 *  3. deadline 为 null/空/非法 → 不做时间校验
 *
 * 前端不抛错，只返回 decision 对象；由调用方决定禁用按钮 / 弹 toast / 隐藏入口。
 */

export type DeadlineErrorCode = 'COMPETITION_NOT_OPEN' | 'DEADLINE_PASSED';
export type DeadlineLevel = 'safe' | 'warning' | 'urgent' | 'expired';

export interface DeadlineDecision {
  ok: boolean;
  /** 错误码：'COMPETITION_NOT_OPEN' | 'DEADLINE_PASSED' | null（ok=true） */
  reason: DeadlineErrorCode | null;
  /** 距截止的剩余毫秒数；负数=已过；null=未设置 */
  remaining_ms: number | null;
  /** UI 倒计时档位 */
  level: DeadlineLevel;
  /** 截止时刻 Date 对象；null=未设置 */
  deadlineAt: Date | null;
  /** 用户可读的中文 message（仅在 ok=false 时有值） */
  message: string | null;
}

const ONE_DAY = 24 * 60 * 60 * 1000;
const THREE_DAYS = 3 * ONE_DAY;

/**
 * 仅返回判定结果，不抛错。
 * @param row  包含 status 与 registration_deadline 的对象
 * @param now  可选测试用当前时间，默认 new Date()
 */
export function evaluateDeadline(
  row: { status?: unknown; registration_deadline?: unknown },
  now: Date = new Date(),
): DeadlineDecision {
  const status = typeof row.status === 'string' ? row.status : '';
  if (status !== 'open') {
    return {
      ok: false,
      reason: 'COMPETITION_NOT_OPEN',
      remaining_ms: null,
      level: 'expired',
      deadlineAt: null,
      message: '该赛事当前未开放报名',
    };
  }
  const raw = row.registration_deadline;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return {
      ok: true,
      reason: null,
      remaining_ms: null,
      level: 'safe',
      deadlineAt: null,
      message: null,
    };
  }
  const deadlineAt = new Date(`${raw}T23:59:59.999Z`);
  if (Number.isNaN(deadlineAt.getTime())) {
    return {
      ok: true,
      reason: null,
      remaining_ms: null,
      level: 'safe',
      deadlineAt: null,
      message: null,
    };
  }
  const remaining_ms = deadlineAt.getTime() - now.getTime();
  if (remaining_ms <= 0) {
    return {
      ok: false,
      reason: 'DEADLINE_PASSED',
      remaining_ms,
      level: 'expired',
      deadlineAt,
      message: '报名已截止',
    };
  }
  const level: DeadlineLevel =
    remaining_ms > THREE_DAYS ? 'safe' : remaining_ms > ONE_DAY ? 'warning' : 'urgent';
  return {
    ok: true,
    reason: null,
    remaining_ms,
    level,
    deadlineAt,
    message: null,
  };
}

/**
 * 把 remaining_ms 渲染成「距截止还剩 X 天 Y 小时」等用户可读文案。
 * level='expired' 时返回 '报名已截止'。
 */
export function formatDeadlineRemaining(decision: DeadlineDecision): string {
  if (decision.level === 'expired') return '报名已截止';
  if (decision.remaining_ms === null) return '';
  const days = Math.floor(decision.remaining_ms / ONE_DAY);
  const hours = Math.floor((decision.remaining_ms % ONE_DAY) / (60 * 60 * 1000));
  if (days > 3) return `距截止还剩 ${days} 天`;
  if (days > 0) return `距截止还剩 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `距截止还剩 ${hours} 小时`;
  const minutes = Math.max(1, Math.floor(decision.remaining_ms / (60 * 1000)));
  return `距截止还剩 ${minutes} 分钟`;
}

/**
 * 根据错误码返回用户可读的中文提示（用于 toast / 横幅）。
 */
export function deadlineErrorMessage(code: DeadlineErrorCode | null): string {
  if (code === 'COMPETITION_NOT_OPEN') return '该赛事当前未开放报名';
  if (code === 'DEADLINE_PASSED') return '报名已截止';
  return '';
}
