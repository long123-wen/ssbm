import { evaluateDeadline, assertCompetitionOpen } from '../functions/_shared/deadline.ts';

// Case 1: status=open, deadline 远未到
let r = evaluateDeadline({ status: 'open', registration_deadline: '2026-12-31' });
console.log('C1 safe:', JSON.stringify(r));

// Case 2: status=open, deadline 当天 23:59:58 之前应 ok
r = evaluateDeadline({ status: 'open', registration_deadline: '2026-08-30' }, new Date('2026-08-30T15:59:58.000Z'));
console.log('C2 same-day urgent:', JSON.stringify(r));

// Case 3: status=open, deadline 当天 23:59:59.001 之后应 DEADLINE_PASSED
r = evaluateDeadline({ status: 'open', registration_deadline: '2026-08-30' }, new Date('2026-08-31T00:00:00.000Z'));
console.log('C3 passed:', JSON.stringify(r));

// Case 4: status!=open
r = evaluateDeadline({ status: 'draft', registration_deadline: '2026-12-31' });
console.log('C4 not open:', JSON.stringify(r));

// Case 5: status=open, deadline null
r = evaluateDeadline({ status: 'open', registration_deadline: null });
console.log('C5 no deadline:', JSON.stringify(r));

// Case 6: status=open, deadline 非法
r = evaluateDeadline({ status: 'open', registration_deadline: 'not-a-date' });
console.log('C6 invalid deadline:', JSON.stringify(r));

// Case 7: assertCompetitionOpen 抛错
try {
  assertCompetitionOpen({ status: 'draft', registration_deadline: '2026-12-31' });
  console.log('C7 assert NO THROW: BUG');
} catch (e: any) {
  console.log('C7 assert throws:', e.code, e.status, e.message);
}

try {
  assertCompetitionOpen({ status: 'open', registration_deadline: '2026-08-30' }, new Date('2026-08-31T00:00:00.000Z'));
  console.log('C8 assert NO THROW: BUG');
} catch (e: any) {
  console.log('C8 assert throws:', e.code, e.status, e.message);
}

// Case 9: assertCompetitionOpen 通过
try {
  assertCompetitionOpen({ status: 'open', registration_deadline: '2026-12-31' });
  console.log('C9 assert PASS: ok');
} catch (e: any) {
  console.log('C9 assert THROWS: BUG', e.code);
}
