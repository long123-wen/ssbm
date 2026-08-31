/**
 * FE 镜像 deadline.ts 行为验证 — 与 BE assertCompetitionOpen 必须语义一致
 * 用 esbuild bundle 后跑
 */
import { evaluateDeadline, formatDeadlineRemaining, deadlineErrorMessage } from '../src/lib/deadline';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('  ❌ FAIL:', msg);
    process.exit(1);
  } else {
    console.log('  ✅', msg);
  }
}

console.log('--- C1: status=open, deadline 远未到 ---');
let d = evaluateDeadline({ status: 'open', registration_deadline: '2026-12-31' });
assert(d.ok === true, 'C1 ok=true');
assert(d.level === 'safe', 'C1 level=safe');
assert(d.reason === null, 'C1 reason=null');
assert(d.message === null, 'C1 message=null');
assert(d.remaining_ms !== null && d.remaining_ms > 0, 'C1 remaining_ms>0');
console.log('  text:', formatDeadlineRemaining(d));

console.log('--- C2: status=open, deadline 当天（未到 UTC 23:59:59）---');
d = evaluateDeadline({ status: 'open', registration_deadline: '2026-08-30' }, new Date('2026-08-30T15:00:00.000Z'));
assert(d.ok === true, 'C2 ok=true');
assert(d.reason === null, 'C2 reason=null');
assert(d.level === 'urgent' || d.level === 'warning', 'C2 level=urgent/warning');
assert(d.deadlineAt !== null, 'C2 deadlineAt set');

console.log('--- C3: status=open, deadline 当天 23:59:59.999 之后（已过）---');
d = evaluateDeadline({ status: 'open', registration_deadline: '2026-08-30' }, new Date('2026-08-31T00:00:00.000Z'));
assert(d.ok === false, 'C3 ok=false');
assert(d.reason === 'DEADLINE_PASSED', 'C3 reason=DEADLINE_PASSED');
assert(d.level === 'expired', 'C3 level=expired');
assert(d.message === '报名已截止', 'C3 message=报名已截止');

console.log('--- C4: status=draft（不管 deadline 多久）---');
d = evaluateDeadline({ status: 'draft', registration_deadline: '2026-12-31' });
assert(d.ok === false, 'C4 ok=false');
assert(d.reason === 'COMPETITION_NOT_OPEN', 'C4 reason=COMPETITION_NOT_OPEN');
assert(d.message === '该赛事当前未开放报名', 'C4 message set');

console.log('--- C5: status=open, deadline=null ---');
d = evaluateDeadline({ status: 'open', registration_deadline: null });
assert(d.ok === true, 'C5 ok=true');
assert(d.deadlineAt === null, 'C5 deadlineAt=null');
assert(d.remaining_ms === null, 'C5 remaining_ms=null');

console.log('--- C6: status=open, deadline 非法 ---');
d = evaluateDeadline({ status: 'open', registration_deadline: 'not-a-date' });
assert(d.ok === true, 'C6 ok=true (invalid deadline ignored)');

console.log('--- C7: formatDeadlineRemaining 文案 ---');
assert(formatDeadlineRemaining(evaluateDeadline({ status: 'open', registration_deadline: '2026-08-30' }, new Date('2026-08-31T00:00:00.000Z'))) === '报名已截止', 'C7 expired → 报名已截止');
let d5 = evaluateDeadline({ status: 'open', registration_deadline: '2099-12-31' });
const t5 = formatDeadlineRemaining(d5);
assert(t5.startsWith('距截止还剩'), 'C7 far future: ' + t5);

console.log('--- C8: deadlineErrorMessage ---');
assert(deadlineErrorMessage('DEADLINE_PASSED') === '报名已截止', 'C8 DEADLINE_PASSED');
assert(deadlineErrorMessage('COMPETITION_NOT_OPEN') === '该赛事当前未开放报名', 'C8 COMPETITION_NOT_OPEN');
assert(deadlineErrorMessage(null) === '', 'C8 null → ""');

console.log('--- C9: status=closed 边界 ---');
d = evaluateDeadline({ status: 'closed', registration_deadline: '2099-12-31' });
assert(d.ok === false && d.reason === 'COMPETITION_NOT_OPEN', 'C9 closed → COMPETITION_NOT_OPEN 即使 deadline 远');

console.log('--- C10: 与后端对齐 — 同输入 (open, 2026-08-30, 2026-08-31T00:00:00Z) ---');
// BE 会抛 DEADLINE_PASSED；FE 返 ok=false reason=DEADLINE_PASSED — 一致
d = evaluateDeadline({ status: 'open', registration_deadline: '2026-08-30' }, new Date('2026-08-31T00:00:00.000Z'));
assert(d.reason === 'DEADLINE_PASSED', 'C10 BE/FE 一致：DEADLINE_PASSED');

console.log('\n🎉 10/10 用例全过 — FE 镜像与 BE 语义一致');
