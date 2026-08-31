/**
 * 年龄分组 / 跨组别匹配 测试套件
 *
 * 覆盖范围（按用户要求）：
 *  - 正常年龄：每个组别中心的典型年龄
 *  - 分组边界值：ageMin / ageMax 对应出生日
 *  - 边界前后值：边界日前 1 天 / 后 1 天
 *  - 最小值 / 最大值：组别最小 ageMin 4 岁、最大无上限
 *  - 空值 / 缺失值：birthDate 为空 / undefined / null
 *  - 非法值：无效日期、负数、小数
 *  - 超大值：year 9999
 *  - 重复数据：完全相同的输入
 *  - 跨组别组合：本组 + 升组 + 跨多个组
 *  - 跨越多个分组：青少年/青年/成年
 *  - 组内与组间混合：multi-athlete 校验
 *  - 性别组合：男/女/混合
 *  - 大集体：maxAthletes = 5 / 10 / 16
 *
 * 验证策略：
 *  - 直接调用前端 src/lib/groupMatcher.ts 的纯函数
 *  - 复刻后端 functions/_shared/workflows.ts 中 assertEligible + isBigTeam + birthStartOf 逻辑
 *  - 同一份测试用例同时跑前后端，对比结果，强制两边一致
 *
 * 运行：
 *  1. 生成 bundle: ./node_modules/.bin/esbuild --bundle --platform=node --format=esm --outfile=.test-bundle.mjs scripts/test-age-bucketing.ts
 *  2. 执行:        node .test-bundle.mjs
 */

import {
  isGroupEligible,
  canEnterGroup,
  isBirthInGroupRange,
  validateGroupRegistration,
  validateRegistrationBatch,
  filterEligibleGroups,
  getExactPresetGroups,
  getCrossPresetGroups,
  getAvailablePresetGroups,
  isBigTeamEvent,
  calcAge,
  isValidISODate,
  BIG_TEAM_MIN_SIZE,
} from '../src/lib/groupMatcher';
import { PRESET_AGE_GROUPS, birthRangeForAge, PRESET_COMBINED_GROUPS } from '../src/lib/presets';

// ============================================================
// 后端逻辑复刻（与 functions/_shared/workflows.ts 保持一致）
// ============================================================
const BACKEND_BIG_TEAM_MIN_SIZE = 5;
function backendIsBigTeam(maxAthletes: unknown): boolean {
  const n = Number(maxAthletes);
  return Number.isFinite(n) && n >= BACKEND_BIG_TEAM_MIN_SIZE;
}
function backendBirthStartOf(group: { age_max?: number | null }, startDate: string): string {
  const year = startDate ? new Date(startDate).getFullYear() : new Date().getFullYear();
  const ageMax = group.age_max === null || group.age_max === undefined ? null : Number(group.age_max);
  if (ageMax === null || !Number.isFinite(ageMax)) return '1900-01-01';
  return `${year - ageMax}-01-01`;
}
function backendIsValidISODate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}
type BackendAssertEligibleResult = { ok: true } | { ok: false; reason: string };
function backendAssertEligible(
  group: { group_gender?: string | null; age_max?: number | null; max_athletes?: number | null },
  athlete: { gender?: string | null; birth_date?: string | null },
  startDate: string,
  isIndividual: boolean,
): BackendAssertEligibleResult {
  if (group.group_gender && group.group_gender !== 'mixed' && athlete.gender !== group.group_gender) {
    return { ok: false, reason: 'GENDER_MISMATCH' };
  }
  if (!isIndividual && backendIsBigTeam(group.max_athletes)) return { ok: true };
  const birthDate = String(athlete.birth_date || '');
  if (!birthDate) return { ok: false, reason: 'MISSING_BIRTH' };
  if (!backendIsValidISODate(birthDate)) return { ok: false, reason: 'INVALID_ISO_DATE' };
  const start = backendBirthStartOf(group, startDate);
  if (birthDate < start) {
    return { ok: false, reason: `BIRTH_TOO_EARLY:${start}` };
  }
  return { ok: true };
}

// ============================================================
// 测试工具
// ============================================================
const COMPETITION_DATE = '2026-08-15';
const YEAR = 2026;

let totalCases = 0;
let passedCases = 0;
let failedCases: { name: string; expected: string; actualFE: unknown; actualBE: unknown; note?: string }[] = [];

function assertTrue(cond: boolean, name: string, note?: string) {
  totalCases++;
  if (cond) {
    passedCases++;
  } else {
    failedCases.push({ name, expected: 'true', actualFE: false, actualBE: false, note });
  }
}
function assertEqual(actual: unknown, expected: unknown, name: string, note?: string) {
  totalCases++;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passedCases++;
  } else {
    failedCases.push({ name, expected: JSON.stringify(expected), actualFE: JSON.stringify(actual), actualBE: '', note });
  }
}
function assertCrossSideConsistency(
  name: string,
  feResult: boolean,
  group: { ageMin?: number; ageMax?: number; gender?: string },
  athlete: { birthDate: string; gender: 'male' | 'female' },
  maxAthletes: number | undefined,
  expected: boolean,
  note?: string,
) {
  // 前端
  const fe = isGroupEligible(group, athlete.birthDate, athlete.gender, COMPETITION_DATE, maxAthletes);
  // 后端（把前端 group/athlete 字段映射到后端字段名）
  const be = backendAssertEligible(
    { group_gender: group.gender ?? null, age_max: group.ageMax ?? null, max_athletes: maxAthletes ?? null },
    { gender: athlete.gender, birth_date: athlete.birthDate || null },
    COMPETITION_DATE,
    false, // 后端这里的 isIndividual 视项目类型而定，下面单独覆盖
  );
  const beOk = be.ok;
  const beMatchFE = fe === beOk;
  const feMatchExpected = fe === expected;
  totalCases++;
  if (beMatchFE && feMatchExpected) {
    passedCases++;
  } else {
    failedCases.push({
      name: `${name}${note ? ' (' + note + ')' : ''}`,
      expected: String(expected),
      actualFE: `eligible=${fe}`,
      actualBE: `ok=${beOk}${!be.ok ? ` reason=${be.reason}` : ''}`,
      note: !beMatchFE ? 'FE/BE 不一致' : 'FE 与预期不符',
    });
  }
}

// ============================================================
// 1. 边界值测试 — 每个年龄组的边界（ageMin/ageMax 出生日）
// ============================================================
// 说明：2026 赛事，ageMax=6 → 最早出生 2020-01-01；ageMin=4 → 最晚出生 2022-12-31
console.log('\n=== 1. 边界值测试 ===');
{
  // 幼儿组 4-6 岁
  // 完全匹配：2021-06-15（5 岁）→ 应在组内
  const exact = isBirthInGroupRange({ ageMin: 4, ageMax: 6 }, '2021-06-15', COMPETITION_DATE);
  assertTrue(exact, '幼儿组中心值 2021-06-15 落在区间内');

  // 起始日（ageMax=6）→ 2020-01-01 应该匹配
  assertTrue(
    isBirthInGroupRange({ ageMin: 4, ageMax: 6 }, '2020-01-01', COMPETITION_DATE),
    '幼儿组起始日 2020-01-01 落在区间内',
  );
  // 起始日前 1 天 → 2019-12-31 不应匹配
  assertTrue(
    !isBirthInGroupRange({ ageMin: 4, ageMax: 6 }, '2019-12-31', COMPETITION_DATE),
    '幼儿组起始日前 1 天 2019-12-31 不在区间内',
  );

  // 结束日（ageMin=4）→ 2022-12-31 应该匹配
  assertTrue(
    isBirthInGroupRange({ ageMin: 4, ageMax: 6 }, '2022-12-31', COMPETITION_DATE),
    '幼儿组结束日 2022-12-31 落在区间内',
  );
  // 结束后 1 天 → 2023-01-01 不应匹配
  assertTrue(
    !isBirthInGroupRange({ ageMin: 4, ageMax: 6 }, '2023-01-01', COMPETITION_DATE),
    '幼儿组结束后 1 天 2023-01-01 不在区间内',
  );

  // 儿童甲组 7-9 岁
  assertTrue(isBirthInGroupRange({ ageMin: 7, ageMax: 9 }, '2017-01-01', COMPETITION_DATE), '儿童甲组起始日 2017-01-01 落在区间内');
  assertTrue(!isBirthInGroupRange({ ageMin: 7, ageMax: 9 }, '2016-12-31', COMPETITION_DATE), '儿童甲组起始日前 1 天 2016-12-31 不在区间内');
  assertTrue(isBirthInGroupRange({ ageMin: 7, ageMax: 9 }, '2019-12-31', COMPETITION_DATE), '儿童甲组结束日 2019-12-31 落在区间内');
  assertTrue(!isBirthInGroupRange({ ageMin: 7, ageMax: 9 }, '2020-01-01', COMPETITION_DATE), '儿童甲组结束后 1 天 2020-01-01 不在区间内');

  // 成年组 26+ （ageMax 缺失）
  // ageMax=undefined → 起始日 1900-01-01
  assertTrue(isBirthInGroupRange({ ageMin: 26, ageMax: undefined }, '1900-01-01', COMPETITION_DATE), '成年组起始日 1900-01-01 落在区间内（无下限）');
  // 成年组 end = 2026-26 = 2000-12-31
  assertTrue(isBirthInGroupRange({ ageMin: 26, ageMax: undefined }, '2000-12-31', COMPETITION_DATE), '成年组结束日 2000-12-31 落在区间内');
  assertTrue(!isBirthInGroupRange({ ageMin: 26, ageMax: undefined }, '2001-01-01', COMPETITION_DATE), '成年组 2001-01-01 不在区间内（超出 25 岁下限）');
}

// ============================================================
// 2. 跨组别「报高不报低」核心规则
// ============================================================
console.log('\n=== 2. 报高不报低 ===');
{
  // 2016 年出生（10 岁）报 儿童乙组(10-12) → 应通过
  assertCrossSideConsistency(
    '2016 出生 报本组儿童乙组',
    false,
    { ageMin: 10, ageMax: 12, gender: 'male' },
    { birthDate: '2016-05-15', gender: 'male' },
    1, // 个人项目
    true,
  );

  // 2016 年出生（10 岁）报 少年甲组(13-15) → 应通过（升组）
  assertCrossSideConsistency(
    '2016 出生 升组报少年甲组',
    false,
    { ageMin: 13, ageMax: 15, gender: 'male' },
    { birthDate: '2016-05-15', gender: 'male' },
    1,
    true,
  );

  // 2013 年出生（13 岁）报 儿童乙组(10-12) → 应拒绝（降组）
  assertCrossSideConsistency(
    '2013 出生 降组报儿童乙组（应拒）',
    false,
    { ageMin: 10, ageMax: 12, gender: 'male' },
    { birthDate: '2013-05-15', gender: 'male' },
    1,
    false,
  );

  // 2013 出生 报少年甲组(13-15) → 应通过（本组）
  assertCrossSideConsistency(
    '2013 出生 报本组少年甲组',
    false,
    { ageMin: 13, ageMax: 15, gender: 'male' },
    { birthDate: '2013-05-15', gender: 'male' },
    1,
    true,
  );

  // 2013 出生 报青年组(19-25) → 应通过（升组，跨多个组）
  assertCrossSideConsistency(
    '2013 出生 跨多组报青年组',
    false,
    { ageMin: 19, ageMax: 25, gender: 'male' },
    { birthDate: '2013-05-15', gender: 'male' },
    1,
    true,
  );

  // 2013 出生 报成年组(26+) → 应通过（升组，跨多组）
  assertCrossSideConsistency(
    '2013 出生 跨多组报成年组',
    false,
    { ageMin: 26, ageMax: undefined, gender: 'male' },
    { birthDate: '2013-05-15', gender: 'male' },
    1,
    true,
  );

  // 1990 出生（36 岁）报 成年组 → 应通过
  assertCrossSideConsistency(
    '1990 出生 报成年组',
    false,
    { ageMin: 26, ageMax: undefined, gender: 'male' },
    { birthDate: '1990-05-15', gender: 'male' },
    1,
    true,
  );

  // 1990 出生 报 幼儿组 → 应拒绝（严重降组）
  assertCrossSideConsistency(
    '1990 出生 报幼儿组（应拒）',
    false,
    { ageMin: 4, ageMax: 6, gender: 'male' },
    { birthDate: '1990-05-15', gender: 'male' },
    1,
    false,
  );
}

// ============================================================
// 3. 性别匹配
// ============================================================
console.log('\n=== 3. 性别匹配 ===');
{
  // 男报男子组 → 通过
  assertCrossSideConsistency(
    '男 报男子组',
    false,
    { ageMin: 10, ageMax: 12, gender: 'male' },
    { birthDate: '2016-05-15', gender: 'male' },
    1,
    true,
  );

  // 男报女子组 → 拒绝
  assertCrossSideConsistency(
    '男 报女子组（应拒）',
    false,
    { ageMin: 10, ageMax: 12, gender: 'female' },
    { birthDate: '2016-05-15', gender: 'male' },
    1,
    false,
  );

  // 女报女子组 → 通过
  assertCrossSideConsistency(
    '女 报女子组',
    false,
    { ageMin: 10, ageMax: 12, gender: 'female' },
    { birthDate: '2016-05-15', gender: 'female' },
    1,
    true,
  );

  // 男报混合组(mixed) → 通过
  assertCrossSideConsistency(
    '男 报混合组',
    false,
    { ageMin: 10, ageMax: 12, gender: 'mixed' },
    { birthDate: '2016-05-15', gender: 'male' },
    1,
    true,
  );

  // 女报混合组(mixed) → 通过
  assertCrossSideConsistency(
    '女 报混合组',
    false,
    { ageMin: 10, ageMax: 12, gender: 'mixed' },
    { birthDate: '2016-05-15', gender: 'female' },
    1,
    true,
  );

  // group.gender=undefined（未设置）→ 通过任意性别
  assertCrossSideConsistency(
    '男 报未设置性别组',
    false,
    { ageMin: 10, ageMax: 12, gender: undefined },
    { birthDate: '2016-05-15', gender: 'male' },
    1,
    true,
  );
}

// ============================================================
// 4. 大集体（≥5 人）：跳过年龄校验
// ============================================================
console.log('\n=== 4. 大集体跳过年龄校验 ===');
{
  // 1990 出生（36 岁）报 幼儿组男子组 大集体项目 → 通过（只校验性别）
  assertCrossSideConsistency(
    '1990出生 报幼儿组(大集体, 10人)',
    false,
    { ageMin: 4, ageMax: 6, gender: 'male' },
    { birthDate: '1990-05-15', gender: 'male' },
    10, // 长绳
    true,
  );

  // 2016 出生（10 岁）报 成年组 大集体 → 通过
  assertCrossSideConsistency(
    '2016出生 报成年组(大集体, 16人)',
    false,
    { ageMin: 26, ageMax: undefined, gender: 'male' },
    { birthDate: '2016-05-15', gender: 'male' },
    16,
    true,
  );

  // 边界：4 人仍为小集体，应执行年龄校验
  assertCrossSideConsistency(
    '1990出生 报幼儿组(小集体, 4人, 应拒)',
    false,
    { ageMin: 4, ageMax: 6, gender: 'male' },
    { birthDate: '1990-05-15', gender: 'male' },
    4, // 4×30秒接力
    false,
  );

  // 边界：5 人开始为"大集体"（>=5）
  assertCrossSideConsistency(
    '1990出生 报幼儿组(刚好5人)',
    false,
    { ageMin: 4, ageMax: 6, gender: 'male' },
    { birthDate: '1990-05-15', gender: 'male' },
    5,
    true,
  );

  // 性别不符即使大集体也要拒
  assertCrossSideConsistency(
    '男 报女子组(大集体, 应拒)',
    false,
    { ageMin: 4, ageMax: 6, gender: 'female' },
    { birthDate: '1990-05-15', gender: 'male' },
    10,
    false,
  );

  // 大集体不要求出生日期（但仍要求 gender 一致）
  // 这里测后端：缺失 birthDate 但大集体 → 通过
  {
    const be = backendAssertEligible(
      { group_gender: 'male', age_max: 6, max_athletes: 10 },
      { gender: 'male', birth_date: '' },
      COMPETITION_DATE,
      false,
    );
    assertTrue(be.ok, '大集体缺失 birthDate 仍通过');
  }
}

// ============================================================
// 5. 空值 / 缺失值 / 非法值
// ============================================================
console.log('\n=== 5. 空值/缺失/非法值 ===');
{
  // 空 birthDate
  {
    const fe = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '', 'male', COMPETITION_DATE, 1);
    const be = backendAssertEligible(
      { group_gender: 'male', age_max: 6, max_athletes: 1 },
      { gender: 'male', birth_date: '' },
      COMPETITION_DATE,
      true,
    );
    assertEqual(fe, false, '空 birthDate 前端应拒');
    assertEqual(be.ok, false, '空 birthDate 后端应拒');
  }

  // null birthDate
  {
    const fe = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' } as any, null as any, 'male', COMPETITION_DATE, 1);
    const be = backendAssertEligible(
      { group_gender: 'male', age_max: 6, max_athletes: 1 },
      { gender: 'male', birth_date: null },
      COMPETITION_DATE,
      true,
    );
    assertEqual(fe, false, 'null birthDate 前端应拒');
    assertEqual(be.ok, false, 'null birthDate 后端应拒');
  }

  // undefined birthDate
  {
    const fe = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' } as any, undefined as any, 'male', COMPETITION_DATE, 1);
    const be = backendAssertEligible(
      { group_gender: 'male', age_max: 6, max_athletes: 1 },
      { gender: 'male', birth_date: undefined },
      COMPETITION_DATE,
      true,
    );
    assertEqual(fe, false, 'undefined birthDate 前端应拒');
    assertEqual(be.ok, false, 'undefined birthDate 后端应拒');
  }

  // 非法日期字符串
  //
  // ★ 2026-08-29 已修复：在 FE groupMatcher.ts 顶部 + BE workflows.ts 顶部
  //   统一加入 isValidISODate() 守卫（/^\d{4}-\d{2}-\d{2}$/ + Date 回环校验）。
  //   修复前两处都返回 true（漏放过）；修复后两处都返回 false。
  {
    const fe = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, 'not-a-date', 'male', COMPETITION_DATE, 1);
    const be = backendAssertEligible(
      { group_gender: 'male', age_max: 6, max_athletes: 1 },
      { gender: 'male', birth_date: 'not-a-date' },
      COMPETITION_DATE,
      true,
    );
    assertEqual(fe, false, '非法日期 "not-a-date" 前端应拒（isValidISODate 守卫）');
    assertEqual(be.ok, false, '非法日期 "not-a-date" 后端应拒（isValidISODate 守卫）');
  }

  // 未来日期（'2050-12-31'）—— 字典序漏洞曾放过"非日期字符串"，现已修复
  // 说明：2050-12-31 是合法 ISO 格式且能被 Date 正确解析，因此 isValidISODate 通过。
  //   字典序比较下 '2050-12-31' ≥ '2020-01-01' → 视为可报"幼儿组"（起始日 2020-01-01）。
  //   这与"未来出生的人"语义一致；业务上应在报名表单层（input max=today）拒绝，
  //   而不是在分组匹配层。
  {
    const fe = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '2050-12-31', 'male', COMPETITION_DATE, 1);
    const be = backendAssertEligible(
      { group_gender: 'male', age_max: 6, max_athletes: 1 },
      { gender: 'male', birth_date: '2050-12-31' },
      COMPETITION_DATE,
      true,
    );
    // 未来日期在 isValidISODate 守卫下通过 → 进入字典序比较 → 通过（与 FE/BE 一致）
    assertEqual(fe, true, '未来日期 2050-12-31 是合法 ISO 格式，FE 视为可报（应在表单层拦截）');
    assertEqual(be.ok, true, '未来日期 2050-12-31 是合法 ISO 格式，BE 视为可报（应在表单层拦截）');
  }

  // 极大年份 '9999-12-31' —— 同上
  {
    const fe = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '9999-12-31', 'male', COMPETITION_DATE, 1);
    const be = backendAssertEligible(
      { group_gender: 'male', age_max: 6, max_athletes: 1 },
      { gender: 'male', birth_date: '9999-12-31' },
      COMPETITION_DATE,
      true,
    );
    // 9999-12-31 是合法 ISO 格式且 Date 可解析（年 9999 在 ES Date 范围内）
    assertEqual(fe, true, '9999-12-31 是合法 ISO 格式，FE 视为可报（应在表单层拦截）');
    assertEqual(be.ok, true, '9999-12-31 是合法 ISO 格式，BE 视为可报（应在表单层拦截）');
  }

  // 格式合法但日期非法：'2020-13-01' / '2020-02-30'
  {
    const fe1 = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '2020-13-01', 'male', COMPETITION_DATE, 1);
    const fe2 = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '2020-02-30', 'male', COMPETITION_DATE, 1);
    assertEqual(fe1, false, '月份越界 2020-13-01 前端应拒（isValidISODate 守卫）');
    assertEqual(fe2, false, '日期越界 2020-02-30 前端应拒（isValidISODate 守卫）');
  }

  // 格式不完整：'2020-1-1' / '2020-1-01' / '20-01-01' / '2020/01/01'
  {
    assertEqual(
      isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '2020-1-1', 'male', COMPETITION_DATE, 1),
      false,
      '非标准格式 2020-1-1 前端应拒（isValidISODate 守卫）',
    );
    assertEqual(
      isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '2020-1-01', 'male', COMPETITION_DATE, 1),
      false,
      '非标准格式 2020-1-01 前端应拒（isValidISODate 守卫）',
    );
    assertEqual(
      isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '20-01-01', 'male', COMPETITION_DATE, 1),
      false,
      '2 位年份 20-01-01 前端应拒（isValidISODate 守卫）',
    );
    assertEqual(
      isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '2020/01/01', 'male', COMPETITION_DATE, 1),
      false,
      '斜杠分隔 2020/01/01 前端应拒（isValidISODate 守卫）',
    );
  }

  // 负数出生日期（年份 -1）
  {
    // '-0001-01-01' 字典序小于 '2020-01-01'，但格式上不是合法 ISO（年份 5 位宽）→ 应被 isValidISODate 拒
    // 实际上 '-0001-01-01' 不匹配 /^\d{4}-\d{2}-\d{2}$/（年份含负号）→ 返回 false
    const fe = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '-0001-01-01', 'male', COMPETITION_DATE, 1);
    assertEqual(fe, false, '负数年份出生应被拒（isValidISODate 守卫）');
  }

  // 极小年份 '0001-01-01' — 格式合法、Date 可解析、字典序早于 '2020-01-01' → 仍然 false（应拒）
  {
    const fe = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '0001-01-01', 'male', COMPETITION_DATE, 1);
    assertEqual(fe, false, '极小年份 0001-01-01 应被拒（早于起始日 2020-01-01）');
  }

  // isValidISODate 单元测试
  {
    assertEqual(isValidISODate('2020-01-01'), true, '合法日期 2020-01-01');
    assertEqual(isValidISODate('2020-12-31'), true, '合法日期 2020-12-31');
    assertEqual(isValidISODate('2024-02-29'), true, '闰年合法 2024-02-29');
    assertEqual(isValidISODate('2023-02-29'), false, '非闰年 2023-02-29 非法');
    assertEqual(isValidISODate('2020-13-01'), false, '月份 13 非法');
    assertEqual(isValidISODate('2020-00-01'), false, '月份 0 非法');
    assertEqual(isValidISODate('2020-01-32'), false, '日期 32 非法');
    assertEqual(isValidISODate('2020-01-00'), false, '日期 0 非法');
    assertEqual(isValidISODate('not-a-date'), false, '非日期字符串');
    assertEqual(isValidISODate(''), false, '空字符串');
    assertEqual(isValidISODate('2020-1-1'), false, '非标准格式');
    assertEqual(isValidISODate('2020/01/01'), false, '斜杠分隔');
    assertEqual(isValidISODate(undefined as any), false, 'undefined');
    assertEqual(isValidISODate(null as any), false, 'null');
    assertEqual(isValidISODate(20200101 as any), false, '数字');
    assertEqual(isValidISODate({} as any), false, '对象');
  }

  // 空性别
  {
    // 前端：isGenderEligible 不严格处理 ''，但 canEnterGroup 不读 gender athlete
    // 这里测后端：group_gender 为 '' → 视为未设置（前端同样）
    // 但实际上前端只接受 'male'|'female' 类型，需用类型断言
    const fe = isGroupEligible({ ageMin: 4, ageMax: 6, gender: '' as any }, '2021-06-15', 'male', COMPETITION_DATE, 1);
    // '' 不会等于 'male'，但 isGenderEligible 视为不限制
    // 实际行为：group.gender && group.gender !== 'mixed' → '' 为 falsy → 进入 true 分支
    assertEqual(fe, true, 'group.gender=""（空字符串）应视为未设置');
  }

  // 后端缺失 gender
  {
    const be = backendAssertEligible(
      { group_gender: 'male', age_max: 6, max_athletes: 1 },
      { gender: '', birth_date: '2021-06-15' },
      COMPETITION_DATE,
      true,
    );
    // athlete.gender='' !== 'male' → 拒绝
    assertEqual(be.ok, false, '后端 athlete.gender="" 不匹配 male');
  }
}

// ============================================================
// 6. 异常 maxAthletes（undefined / null / NaN / 负数 / 小数 / 字符串）
// ============================================================
console.log('\n=== 6. 异常 maxAthletes ===');
{
  // 验证 isBigTeamEvent 行为
  assertEqual(isBigTeamEvent(undefined), false, 'undefined maxAthletes 非大集体');
  assertEqual(isBigTeamEvent(null), false, 'null maxAthletes 非大集体');
  assertEqual(isBigTeamEvent(NaN), false, 'NaN maxAthletes 非大集体');
  assertEqual(isBigTeamEvent(0), false, '0 人 非大集体');
  assertEqual(isBigTeamEvent(1), false, '1 人 非大集体');
  assertEqual(isBigTeamEvent(4), false, '4 人 非大集体');
  assertEqual(isBigTeamEvent(5), true, '5 人 大集体');
  assertEqual(isBigTeamEvent(10), true, '10 人 大集体');
  assertEqual(isBigTeamEvent(16), true, '16 人 大集体');
  assertEqual(isBigTeamEvent(-1), false, '负数 非大集体');
  // ★ 设计差异：FE 用 typeof === 'number' 严格类型守卫
  //   - 2.5 是 number，但 2.5 < 5 → false（不是"大集体"，而是"非整数"）
  //   - 实际项目 maxAthletes 必为整数，这里 2.5 视为非合规输入
  assertEqual(isBigTeamEvent(2.5), false, '小数 2.5 非大集体（<5）；项目 maxAthletes 应为整数');
  // FE 严格类型守卫：'5' 是 string → false；BE 用 Number() 隐式转换 → true
  // 这是一个 FE/BE 设计差异，非 bug。建议统一为严格类型以避免歧义。
  assertEqual(isBigTeamEvent('5' as any), false, '字符串 "5" FE 严格类型视为非大集体；BE 会隐式转换（设计差异）');
  assertEqual(isBigTeamEvent('abc' as any), false, '字符串 "abc" 非大集体');

  // 后端 backendIsBigTeam — 用 Number() 隐式转换，与 FE 行为不同
  assertEqual(backendIsBigTeam(undefined), false, '后端 undefined 非大集体');
  assertEqual(backendIsBigTeam(null), false, '后端 null 非大集体');
  assertEqual(backendIsBigTeam(NaN), false, '后端 NaN 非大集体');
  assertEqual(backendIsBigTeam(5), true, '后端 5 是大集体');
  assertEqual(backendIsBigTeam(4), false, '后端 4 非大集体');
  assertEqual(backendIsBigTeam('5'), true, '后端 "5" 是大集体（Number() 隐式转换）');
  assertEqual(backendIsBigTeam('abc'), false, '后端 "abc" 非大集体（NaN）');

  // FE/BE 设计差异固化
  // FE: typeof === 'number' 严格
  // BE: Number() 隐式转换
  // 差异在 '5'（FE false / BE true）上显现 —— 实际 maxAthletes 来自数据库 INTEGER 字段，
  // 正常路径下不会传入字符串，差异是理论存在但实践中不会触发。
  assertEqual(
    isBigTeamEvent('5' as any) !== backendIsBigTeam('5'),
    true,
    'FE/BE 大集体判断类型策略不同（FE 严格 / BE 隐式）—— 记录在案',
    'design-difference:fe-strict-vs-be-coerce',
  );
}

// ============================================================
// 7. 重复数据：相同输入多次跑，结果应一致
// ============================================================
console.log('\n=== 7. 重复数据一致性 ===');
{
  const result1 = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '2021-06-15', 'male', COMPETITION_DATE, 1);
  const result2 = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '2021-06-15', 'male', COMPETITION_DATE, 1);
  const result3 = isGroupEligible({ ageMin: 4, ageMax: 6, gender: 'male' }, '2021-06-15', 'male', COMPETITION_DATE, 1);
  assertTrue(result1 === result2 && result2 === result3, '相同输入 3 次结果一致');

  // 大量重复（1000 次）应保持稳定
  let allSame = true;
  const baseline = isGroupEligible({ ageMin: 10, ageMax: 12, gender: 'female' }, '2015-01-01', 'female', COMPETITION_DATE, 1);
  for (let i = 0; i < 1000; i++) {
    const r = isGroupEligible({ ageMin: 10, ageMax: 12, gender: 'female' }, '2015-01-01', 'female', COMPETITION_DATE, 1);
    if (r !== baseline) { allSame = false; break; }
  }
  assertTrue(allSame, '1000 次重复输入结果一致');
}

// ============================================================
// 8. 跨组别组合：本组 + 升一组 + 升多组
// ============================================================
console.log('\n=== 8. 跨组别组合 ===');
{
  const groups = [
    { id: 'g1', name: '幼儿组男子组', ageMin: 4, ageMax: 6, gender: 'male' as const },
    { id: 'g2', name: '儿童甲组男子组', ageMin: 7, ageMax: 9, gender: 'male' as const },
    { id: 'g3', name: '儿童乙组男子组', ageMin: 10, ageMax: 12, gender: 'male' as const },
    { id: 'g4', name: '少年甲组男子组', ageMin: 13, ageMax: 15, gender: 'male' as const },
    { id: 'g5', name: '青年组男子组', ageMin: 19, ageMax: 25, gender: 'male' as const },
    { id: 'g6', name: '成年组男子组', ageMin: 26, ageMax: undefined, gender: 'male' as const },
  ];

  // 2016 出生（10 岁）男子：可报儿童乙/少年甲/青年/成年（4 个）
  const eligible = filterEligibleGroups(groups, [{ birthDate: '2016-05-15', gender: 'male' }], false, COMPETITION_DATE, 1);
  assertEqual(eligible.length, 4, '2016 男可报 4 个组（本组+3 升组）');
  assertEqual(eligible.map((g) => g.name).join(','), '儿童乙组男子组,少年甲组男子组,青年组男子组,成年组男子组', '2016 男可报组名顺序正确');

  // 2020 出生（6 岁）男子：在 6 个男子组中，按"报高不报低"规则，
  // 出生 2020-05-15 字典序 ≥ 所有组的起始日（1900-01-01 / 2001 / 2007 / 2014 / 2017 / 2020）
  // → 6 个组全部合法（幼儿本组 + 5 个升组选项）
  // ★ 这是"报高不报低"规则的正确行为，不是 bug
  const eligible2 = filterEligibleGroups(groups, [{ birthDate: '2020-05-15', gender: 'male' }], false, COMPETITION_DATE, 1);
  assertEqual(eligible2.length, 6, '2020 男可报全部 6 个组（本组+5 升组，报高不报低）');
  assertEqual(eligible2[0].name, '幼儿组男子组', '2020 男首先能报幼儿组（本组）');
  assertEqual(eligible2[5].name, '成年组男子组', '2020 男最远能报成年组（5 升组）');

  // 1995 出生（31 岁）男子：仅成年组
  const eligible3 = filterEligibleGroups(groups, [{ birthDate: '1995-05-15', gender: 'male' }], false, COMPETITION_DATE, 1);
  assertEqual(eligible3.length, 1, '1995 男仅可报成年组');
  assertEqual(eligible3[0].name, '成年组男子组', '1995 男只能报成年组');
}

// ============================================================
// 9. 多人项目：组内混合 + 组间混合
// ============================================================
console.log('\n=== 9. 多人项目混合 ===');
{
  // 场景 A：组内混合（同年）— 全部 2016 男，4 人接力（maxAthletes=4）
  const sameYear = filterEligibleGroups(
    [{ id: 'g', name: '儿童乙组男子组', ageMin: 10, ageMax: 12, gender: 'male' as const }],
    [
      { birthDate: '2016-01-01', gender: 'male' as const },
      { birthDate: '2016-06-15', gender: 'male' as const },
      { birthDate: '2016-12-31', gender: 'male' as const },
    ],
    false, COMPETITION_DATE, 4,
  );
  assertEqual(sameYear.length, 1, '组内同年混合通过');

  // 场景 B：组间混合 — 2014 + 2016，男接力（maxAthletes=4）
  // 2014 出生（12 岁）在本组；2016 出生（10 岁）也在本组
  const intra = filterEligibleGroups(
    [{ id: 'g', name: '儿童乙组男子组', ageMin: 10, ageMax: 12, gender: 'male' as const }],
    [
      { birthDate: '2014-01-01', gender: 'male' as const },
      { birthDate: '2016-12-31', gender: 'male' as const },
    ],
    false, COMPETITION_DATE, 4,
  );
  assertEqual(intra.length, 1, '组间同年段（2014/2016）混合通过');

  // 场景 C：跨组混合 — 2014 男 + 2013 男 报儿童乙组（10-12）
  // 2013 出生（13 岁）超龄 → 应过滤
  const crossGroup = filterEligibleGroups(
    [{ id: 'g', name: '儿童乙组男子组', ageMin: 10, ageMax: 12, gender: 'male' as const }],
    [
      { birthDate: '2014-01-01', gender: 'male' as const },
      { birthDate: '2013-12-31', gender: 'male' as const },
    ],
    false, COMPETITION_DATE, 4,
  );
  assertEqual(crossGroup.length, 0, '跨组（2014+2013）报儿童乙组应被过滤');

  // 场景 D：跨多组（2014 + 2010 + 2005） 报少年甲组（13-15）
  // 2010 出生（16 岁）超龄；2005 出生（21 岁）更超龄
  // 应无人符合
  const multi = filterEligibleGroups(
    [{ id: 'g', name: '少年甲组男子组', ageMin: 13, ageMax: 15, gender: 'male' as const }],
    [
      { birthDate: '2014-01-01', gender: 'male' as const },
      { birthDate: '2010-06-15', gender: 'male' as const },
      { birthDate: '2005-06-15', gender: 'male' as const },
    ],
    false, COMPETITION_DATE, 4,
  );
  assertEqual(multi.length, 0, '跨多组 3 名 2014/2010/2005 男 报少年甲组 应被过滤');

  // 场景 E：升组 — 2014 + 2013 + 2012 + 2011 男 报少年甲组
  // 2014 出生（12 岁）→ 升组合法；其他都本组
  const upgrade = filterEligibleGroups(
    [{ id: 'g', name: '少年甲组男子组', ageMin: 13, ageMax: 15, gender: 'male' as const }],
    [
      { birthDate: '2014-01-01', gender: 'male' as const }, // 12 岁
      { birthDate: '2013-01-01', gender: 'male' as const }, // 13 岁
      { birthDate: '2012-01-01', gender: 'male' as const }, // 14 岁
      { birthDate: '2011-12-31', gender: 'male' as const }, // 14 岁（边界）
    ],
    false, COMPETITION_DATE, 4,
  );
  assertEqual(upgrade.length, 1, '4 名 2011-2014 男 报少年甲组 → 全部合法');
}

// ============================================================
// 10. 大集体多人：完全无视年龄
// ============================================================
console.log('\n=== 10. 大集体多人 ===');
{
  // 10 人长绳：跨越 1990-2020 全部 OK
  const athletes = [
    { birthDate: '1990-01-01', gender: 'male' as const },
    { birthDate: '2000-01-01', gender: 'male' as const },
    { birthDate: '2010-01-01', gender: 'male' as const },
    { birthDate: '2016-01-01', gender: 'male' as const },
    { birthDate: '2020-01-01', gender: 'male' as const },
  ];
  const group = { id: 'g', name: '成年组男子组', ageMin: 26, ageMax: undefined, gender: 'male' as const };
  const filtered = filterEligibleGroups([group], athletes, false, COMPETITION_DATE, 10);
  assertEqual(filtered.length, 1, '5 名 1990-2020 男 报成年组大集体 → 通过');

  // 大集体但性别不符
  const filteredGender = filterEligibleGroups(
    [{ id: 'g', name: '女子组', ageMin: undefined, ageMax: undefined, gender: 'female' as const }],
    [{ birthDate: '1990-01-01', gender: 'male' as const }],
    false, COMPETITION_DATE, 10,
  );
  assertEqual(filteredGender.length, 0, '男 报女子组大集体 → 被过滤');
}

// ============================================================
// 11. 特教组 / 不分组别（边界情况）
// ============================================================
console.log('\n=== 11. 特教组/不分组别 ===');
{
  // 特教组：id='age_8'，无 ageMin/ageMax
  // getExactPresetGroups 应始终包含特教组
  const exact = getExactPresetGroups('2010-01-01', 'male', COMPETITION_DATE);
  const hasSpecial = exact.some((g) => g.name.includes('特教组'));
  assertTrue(hasSpecial, '任意出生日期 getExactPresetGroups 都含特教组');

  // 不分组别：id='comb_none'，isStandalone=true
  const noneGroup = PRESET_COMBINED_GROUPS.find((g) => g.id === 'comb_none');
  assertTrue(noneGroup !== undefined, '不分组别存在');
  // getExactPresetGroups 只返回非 standalone，所以不应包含
  const hasNone = exact.some((g) => g.id === 'comb_none');
  assertTrue(!hasNone, 'getExactPresetGroups 不应包含不分组别（standalone）');

  // getCrossPresetGroups 应包含特教组（始终可报）
  const cross = getCrossPresetGroups('1990-01-01', 'male', COMPETITION_DATE);
  const crossHasSpecial = cross.some((g) => g.name.includes('特教组'));
  assertTrue(crossHasSpecial, 'getCrossPresetGroups 包含特教组');
}

// ============================================================
// 12. validateGroupRegistration — 审核场景
// ============================================================
console.log('\n=== 12. validateGroupRegistration 审核 ===');
{
  // 完全匹配
  const r1 = validateGroupRegistration(
    '2021-06-15', 'male',
    { name: '幼儿组男子组', ageMin: 4, ageMax: 6, gender: 'male' },
    true, COMPETITION_DATE, 1,
  );
  assertTrue(r1.valid && !r1.isCross, '审核：完全匹配 valid+!isCross');

  // 升组
  const r2 = validateGroupRegistration(
    '2016-05-15', 'male',
    { name: '少年甲组男子组', ageMin: 13, ageMax: 15, gender: 'male' },
    true, COMPETITION_DATE, 1,
  );
  assertTrue(r2.valid && r2.isCross === true, '审核：升组 valid+isCross');

  // 降组
  const r3 = validateGroupRegistration(
    '2013-05-15', 'male',
    { name: '儿童乙组男子组', ageMin: 10, ageMax: 12, gender: 'male' },
    true, COMPETITION_DATE, 1,
  );
  assertTrue(!r3.valid, '审核：降组应拒');

  // 大集体年龄错配仍 valid
  const r4 = validateGroupRegistration(
    '1990-05-15', 'male',
    { name: '幼儿组男子组', ageMin: 4, ageMax: 6, gender: 'male' },
    false, COMPETITION_DATE, 10,
  );
  assertTrue(r4.valid, '审核：大集体年龄错配仍 valid');

  // validateRegistrationBatch 多人
  const batch = validateRegistrationBatch(
    [
      { name: 'A', birthDate: '2016-05-15', gender: 'male' },
      { name: 'B', birthDate: '2013-12-31', gender: 'male' },
    ],
    { name: '儿童乙组男子组', ageMin: 10, ageMax: 12, gender: 'male' },
    false, COMPETITION_DATE, 4,
  );
  assertEqual(batch.length, 2, '批量审核返回 2 个结果');
  assertTrue(batch[0].valid, '批量审核 A 合法');
  assertTrue(!batch[1].valid, '批量审核 B 不合法（2013 降组）');
}

// ============================================================
// 13. getAvailablePresetGroups 综合
// ============================================================
console.log('\n=== 13. getAvailablePresetGroups ===');
{
  // 个人项目：报高不报低
  const personal = getAvailablePresetGroups('2016-05-15', 'male', COMPETITION_DATE, true, 1);
  assertTrue(personal.length > 0, '个人项目返回非空');
  // 应含本组儿童乙 + 升组
  const hasYonger = personal.some((g) => g.name.includes('幼儿组') || g.name.includes('儿童甲组'));
  assertTrue(!hasYonger, '个人项目不应包含降组选项');

  // 大集体：所有 gender 匹配的组别
  const bigTeam = getAvailablePresetGroups('2016-05-15', 'male', COMPETITION_DATE, false, 10);
  assertTrue(bigTeam.length >= 7, '大集体返回 >=7 个组（按男子过滤）');
}

// ============================================================
// 14. 出生日期范围动态推算（按赛事年份）
// ============================================================
console.log('\n=== 14. 出生日期范围动态推算 ===');
{
  // 2026 赛事：幼儿组 → 2020-01-01 ~ 2022-12-31
  const r2026 = birthRangeForAge(4, 6, '2026-08-15');
  assertEqual(r2026, { start: '2020-01-01', end: '2022-12-31' }, '2026 赛事 幼儿组范围');

  // 2027 赛事：自动顺延 → 2021-01-01 ~ 2023-12-31
  const r2027 = birthRangeForAge(4, 6, '2027-08-15');
  assertEqual(r2027, { start: '2021-01-01', end: '2023-12-31' }, '2027 赛事 幼儿组范围（自动顺延）');

  // 2030 赛事：2024-01-01 ~ 2026-12-31
  const r2030 = birthRangeForAge(4, 6, '2030-08-15');
  assertEqual(r2030, { start: '2024-01-01', end: '2026-12-31' }, '2030 赛事 幼儿组范围');

  // 成年组（ageMax=undefined）→ 起始 1900
  const rAdult = birthRangeForAge(26, undefined, '2026-08-15');
  assertEqual(rAdult.start, '1900-01-01', '成年组起始日 1900');
  assertEqual(rAdult.end, '2000-12-31', '成年组结束日 2000-12-31');

  // ageMin=undefined → 结束 2026-12-31
  const rOpen = birthRangeForAge(undefined, 6, '2026-08-15');
  assertEqual(rOpen.start, '2020-01-01', 'ageMin 缺失 起始日 2020');
  assertEqual(rOpen.end, '2026-12-31', 'ageMin 缺失 结束日 2026-12-31');

  // 都缺失
  const rNone = birthRangeForAge(undefined, undefined, '2026-08-15');
  assertEqual(rNone, { start: '1900-01-01', end: '2026-12-31' }, '都缺失 → 全范围');
}

// ============================================================
// 15. calcAge 边界
// ============================================================
console.log('\n=== 15. calcAge 周岁计算 ===');
{
  // 比赛日 2026-08-15，出生 2020-08-15 → 6 周岁
  assertEqual(calcAge('2020-08-15', '2026-08-15'), 6, '生日当天=6 岁');
  // 比赛日 2026-08-15，出生 2020-08-16 → 5 周岁（差 1 天）
  assertEqual(calcAge('2020-08-16', '2026-08-15'), 5, '生日前 1 天=5 岁');
  // 比赛日 2026-08-15，出生 2020-08-14 → 6 周岁
  assertEqual(calcAge('2020-08-14', '2026-08-15'), 6, '生日后 1 天=6 岁');
  // 跨年：比赛 2026-08-15，出生 2020-12-31 → 5 周岁（生日未到）
  assertEqual(calcAge('2020-12-31', '2026-08-15'), 5, '跨年：5 岁');
  // 边界：空值 → 0
  assertEqual(calcAge('', '2026-08-15'), 0, '空 birthDate → 0');
  assertEqual(calcAge('2020-01-01', ''), 0, '空 compDate → 0');
  // 负数 age 不会出现（已用 Math.max(0, age) 兜底）
  assertEqual(calcAge('2030-01-01', '2026-08-15'), 0, '未来出生 → 0');
}

// ============================================================
// 16. 综合前后端一致性矩阵
// ============================================================
console.log('\n=== 16. FE/BE 综合一致性 ===');
{
  // 50 个随机组合
  const year = 2026;
  const cases: { birthDate: string; gender: 'male' | 'female'; ageMax: number; groupGender: string; maxAthletes: number; isIndividual: boolean; expected: boolean }[] = [];
  for (let i = 0; i < 50; i++) {
    const birthYear = 1980 + Math.floor(Math.random() * 45); // 1980-2024
    const m = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
    const d = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
    const birthDate = `${birthYear}-${m}-${d}`;
    const gender = Math.random() < 0.5 ? 'male' : 'female';
    const groupGender = ['male', 'female', 'mixed'][Math.floor(Math.random() * 3)];
    const ageMax = [3, 6, 9, 12, 15, 18, 25, undefined][Math.floor(Math.random() * 8)];
    const maxAthletes = [1, 2, 4, 5, 10, 16][Math.floor(Math.random() * 6)];
    const isIndividual = maxAthletes === 1;
    // 计算预期
    let expected = true;
    if (groupGender !== 'mixed' && groupGender !== gender) expected = false;
    if (!isIndividual && maxAthletes >= 5) {
      // 大集体：只校验性别
    } else {
      const start = ageMax === undefined ? '1900-01-01' : `${year - ageMax}-01-01`;
      if (birthDate < start) expected = false;
    }
    cases.push({ birthDate, gender, ageMax, groupGender, maxAthletes, isIndividual, expected });
  }
  for (const c of cases) {
    assertCrossSideConsistency(
      `随机用例 birth=${c.birthDate} g=${c.gender} gg=${c.groupGender} max=${c.maxAthletes}`,
      c.isIndividual,
      { ageMax: c.ageMax, gender: c.groupGender as any },
      { birthDate: c.birthDate, gender: c.gender },
      c.maxAthletes,
      c.expected,
    );
  }
}

// ============================================================
// 输出汇总
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`总计：${totalCases} 个断言`);
console.log(`通过：${passedCases}`);
console.log(`失败：${failedCases.length}`);
console.log('='.repeat(60));

if (failedCases.length > 0) {
  console.log('\n【失败用例】');
  // 按失败类型分组
  const byType: Record<string, typeof failedCases> = {};
  for (const f of failedCases) {
    const key = f.note || '其他';
    if (!byType[key]) byType[key] = [];
    byType[key].push(f);
  }
  for (const [type, items] of Object.entries(byType)) {
    console.log(`\n--- ${type} (${items.length} 条) ---`);
    for (const it of items) {
      console.log(`  ✗ ${it.name}`);
      console.log(`    预期: ${it.expected} | FE: ${it.actualFE} | BE: ${it.actualBE}`);
    }
  }
  process.exit(1);
} else {
  console.log('\n✅ 全部通过');
  process.exit(0);
}
