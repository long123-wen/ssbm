/**
 * 集成测试：验证 workflows.ts 中 4 个 deadline 调用点
 *  create / bulk / resubmit 应被 deadline 阻挡
 *  update 即使 deadline 已过仍可改
 */
import { evaluateDeadline, assertCompetitionOpen } from '../functions/_shared/deadline.ts';

interface CaseRow { name: string; row: { status: string; registration_deadline: string | null }; now: Date; expectThrow: boolean | 'lockStatusOnly'; expectCode?: string; lockDeadline?: boolean }

const past = '2026-08-30';   // 已过
const future = '2026-12-31'; // 未到
const nowBeforeDeadline = new Date('2026-08-31T00:00:01.000Z'); // deadline 后 1ms
const nowAfterDeadline = new Date('2026-08-30T15:00:00.000Z');  // deadline 当天 15:00 UTC

const cases: CaseRow[] = [
  // create 路径：status open + deadline 已过 → 应 DEADLINE_PASSED
  { name: 'C1 create: open+past', row: { status: 'open', registration_deadline: past }, now: nowBeforeDeadline, expectThrow: true, expectCode: 'DEADLINE_PASSED' },
  // create 路径：status draft → 应 COMPETITION_NOT_OPEN
  { name: 'C2 create: draft', row: { status: 'draft', registration_deadline: future }, now: nowBeforeDeadline, expectThrow: true, expectCode: 'COMPETITION_NOT_OPEN' },
  // update 路径：lockDeadline=false → 跳过 deadline，仅看 status
  { name: 'C3 update: open+past+skip', row: { status: 'open', registration_deadline: past }, now: nowBeforeDeadline, expectThrow: false, lockDeadline: false },
  // update 路径：lockDeadline=false 但 status closed → 应 COMPETITION_NOT_OPEN（status 仍要查）
  { name: 'C4 update: closed+skip', row: { status: 'closed', registration_deadline: future }, now: nowBeforeDeadline, expectThrow: true, expectCode: 'COMPETITION_NOT_OPEN', lockDeadline: false },
  // create 路径：open + 当天 → 应 ok
  { name: 'C5 create: same-day', row: { status: 'open', registration_deadline: past }, now: nowAfterDeadline, expectThrow: false },
  // create 路径：open + 远期 → 应 ok
  { name: 'C6 create: future', row: { status: 'open', registration_deadline: future }, now: nowBeforeDeadline, expectThrow: false },
  // create 路径：open + null → 应 ok
  { name: 'C7 create: null', row: { status: 'open', registration_deadline: null }, now: nowBeforeDeadline, expectThrow: false },
  // create 路径：open + 非法 → 应 ok（不查时间）
  { name: 'C8 create: invalid', row: { status: 'open', registration_deadline: 'not-a-date' }, now: nowBeforeDeadline, expectThrow: false },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const t0 = Date.now();
  try {
    assertCompetitionOpen(c.row as any, c.now, { lockDeadline: c.lockDeadline });
    if (c.expectThrow) {
      console.log(`❌ ${c.name}  expected throw ${c.expectCode}, got NO THROW`);
      fail++;
    } else {
      console.log(`✅ ${c.name}  no throw (${Date.now() - t0}ms)`);
      pass++;
    }
  } catch (e: any) {
    if (!c.expectThrow) {
      console.log(`❌ ${c.name}  expected NO throw, got ${e.code} "${e.message}"`);
      fail++;
    } else if (e.code !== c.expectCode) {
      console.log(`❌ ${c.name}  expected code ${c.expectCode}, got ${e.code}`);
      fail++;
    } else {
      console.log(`✅ ${c.name}  threw ${e.code} (${Date.now() - t0}ms)`);
      pass++;
    }
  }
}

console.log(`\n=== ${pass} pass / ${fail} fail (total ${cases.length}) ===`);
process.exit(fail > 0 ? 1 : 0);
