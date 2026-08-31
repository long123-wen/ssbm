/**
 * 报名截止时间统一校验（中心函数）。
 *
 * 语义（2026-08-29 拍板，与前端 src/lib/deadline.ts 保持完全一致）：
 *  1. 状态优先：status !== 'open'  → COMPETITION_NOT_OPEN（409）
 *  2. 时间次之：deadline='YYYY-MM-DD' 表示该日 23:59:59 之前仍可报，
 *     进入 23:59:59.001 起视为已过 → DEADLINE_PASSED（409）
 *  3. status===null/''/undefined → 当作 'draft' 走 COMPETITION_NOT_OPEN
 *  4. deadline 为 null/空/非法 → 不做时间校验（只看状态）
 *
 * 错误码策略：保留旧 REGISTRATION_CLOSED 兼容路径（仅当 status≠open 时仍抛旧码）
 *  新增更细粒度的 COMPETITION_NOT_OPEN / DEADLINE_PASSED 供前端差异化提示。
 *
 * 调用方：仅限 create / bulk / resubmit 三类"新建/重提"提交路径；
 * unlock / review / delete / cancel / update 等管理动作不调用本函数。
 *
 * @example
 *   assertCompetitionOpen({ status: 'open', registration_deadline: '2026-08-30' });
 *   // 当 2026-08-30T23:59:59.000Z 之前不抛；之后抛 DEADLINE_PASSED
 */
import { HttpError } from './http';
import type { Row } from './types';

export type DeadlineErrorCode = 'COMPETITION_NOT_OPEN' | 'DEADLINE_PASSED';
export type DeadlineCompatCode = 'REGISTRATION_CLOSED';

export interface DeadlineDecision {
  /** 距截止的剩余毫秒数；负数表示已过。null = 未设置 deadline */
  remaining_ms: number | null;
  /** 用于前端倒计时档位提示 */
  level: 'safe' | 'warning' | 'urgent' | 'expired';
  /** 截止时刻 Date 对象；null = 未设置 deadline */
  deadlineAt: Date | null;
}

/**
 * 仅返回判定结果（不抛错），给前端展示/倒计时用。
 * 与 assertCompetitionOpen 在语义上必须完全一致。
 */
export function evaluateDeadline(
  row: { status?: unknown; registration_deadline?: unknown },
  now: Date = new Date(),
): DeadlineDecision & { ok: boolean; reason?: DeadlineErrorCode | 'OK' } {
  const status = typeof row.status === 'string' ? row.status : '';
  if (status !== 'open') {
    return { ok: false, reason: 'COMPETITION_NOT_OPEN', remaining_ms: null, level: 'expired', deadlineAt: null };
  }
  const raw = row.registration_deadline;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: true, remaining_ms: null, level: 'safe', deadlineAt: null };
  }
  const deadlineAt = new Date(`${raw}T23:59:59.999Z`);
  if (Number.isNaN(deadlineAt.getTime())) {
    return { ok: true, remaining_ms: null, level: 'safe', deadlineAt: null };
  }
  const remaining_ms = deadlineAt.getTime() - now.getTime();
  if (remaining_ms <= 0) {
    return { ok: false, reason: 'DEADLINE_PASSED', remaining_ms, level: 'expired', deadlineAt };
  }
  // 三档阈值：3 天以上 safe、24h~3d warning、<24h urgent
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const THREE_DAYS = 3 * ONE_DAY;
  const level: DeadlineDecision['level'] =
    remaining_ms > THREE_DAYS ? 'safe' : remaining_ms > ONE_DAY ? 'warning' : 'urgent';
  return { ok: true, remaining_ms, level, deadlineAt };
}

/**
 * 抛错版：用于后端写入路径。
 *
 * 错误码：
 *  - status≠'open'         → 409 COMPETITION_NOT_OPEN
 *  - deadline 已过         → 409 DEADLINE_PASSED
 *
 * @param lockDeadline=false 时跳过时间检查（仅检查 status）。
 *   用于 update/edit pending registration 的场景：deadline 已过后，
 *   管理员已 unlock 的待审核记录仍允许调整运动员名单。
 *
 * 兼容：仍然抛出与旧版同名的 HttpError 形态（status 409 + 中文 message），
 * 但 code 字段切换为新码；旧版 REGISTRATION_CLOSED 仅在 message 字符串中保留，
 * 不作为独立 code 返回，避免双码歧义。
 */
export function assertCompetitionOpen(row: Row, now: Date = new Date(), options: { lockDeadline?: boolean } = {}): void {
  const lockDeadline = options.lockDeadline !== false; // 默认锁
  if (!lockDeadline) {
    const status = typeof row.status === 'string' ? row.status : '';
    if (status !== 'open') {
      throw new HttpError(409, 'Competition is not open for registration', 'COMPETITION_NOT_OPEN');
    }
    return;
  }
  const decision = evaluateDeadline(row, now);
  if (decision.ok) return;
  if (decision.reason === 'COMPETITION_NOT_OPEN') {
    throw new HttpError(409, 'Competition is not open for registration', 'COMPETITION_NOT_OPEN');
  }
  if (decision.reason === 'DEADLINE_PASSED') {
    throw new HttpError(409, 'Registration deadline has passed', 'DEADLINE_PASSED');
  }
  // 理论上不可达；兜底保持旧码
  throw new HttpError(409, 'Competition is not open for registration', 'REGISTRATION_CLOSED');
}

/**
 * 仅在需要保留旧 code 字符串时使用（仅限给前端字符串匹配用，非主路径）。
 * 当前统一改用 COMPETITION_NOT_OPEN / DEADLINE_PASSED 即可。
 */
export function assertCompetitionOpenCompat(row: Row, now: Date = new Date()): void {
  const status = typeof row.status === 'string' ? row.status : '';
  if (status !== 'open') {
    throw new HttpError(409, 'Competition is not open for registration', 'REGISTRATION_CLOSED');
  }
  const decision = evaluateDeadline(row, now);
  if (!decision.ok && decision.reason === 'DEADLINE_PASSED') {
    throw new HttpError(409, 'Registration deadline has passed', 'REGISTRATION_CLOSED');
  }
}
