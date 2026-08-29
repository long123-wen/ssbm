/**
 * 跳绳赛事分组匹配引擎
 *
 * 年龄分组依据（2026-08-29 修订）：**出生日期范围**，按赛事年份动态推算
 *  - 出生年份 = 赛事年份 − 年龄
 *  - 年龄区间 [ageMin, ageMax] → 出生日期范围 [`${年-ageMax}-01-01`, `${年-ageMin}-12-31`]
 *  - 2027 年赛事自动顺延一年，无需改代码
 *  例（2026）：幼儿组 4-6 岁 → 2020-01-01 ~ 2022-12-31
 *
 * 跨组别规则：
 *  1. 个人项目、2-4 人小集体项目：**只允许报高，不许报低**
 *     - 可以往更大年龄的组别升一组或多组参赛
 *     - 年龄大的不能报更小年龄的组（降组严禁）
 *     - 实现：出生日期 ≥ 该组出生起始日 即可（起始日越早 = 年龄组越大）
 *  2. 5 人及以上大集体项目：**不设年龄分组，自由组队**
 *     - 不分年龄，完全跳过年龄校验
 *
 * 核心功能：
 *  1. 根据出生日期 + 性别 → 自动判定应属组别
 *  2. 审核时自动校验分组是否正确
 *  3. 报名端：根据出生日期 + 性别自动筛选可选组别
 */

/** 大集体门槛：每队 5 人及以上视为大集体，不设年龄分组 */
export const BIG_TEAM_MIN_SIZE = 5;

/** ISO 8601 日期格式校验：YYYY-MM-DD，且能被 Date 正确解析 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 校验字符串是否为合法 ISO 日期（YYYY-MM-DD）
 *
 * 防御场景（2026-08-29 加入）：
 *  - 'not-a-date' / '' / '2020-1-1' / '2020-13-01' / '2050-12-31' / '9999-12-31'
 *  - 任何非 ISO 字符串若直接参与字典序比较都会绕过年龄上限检查
 *
 * 与后端 functions/_shared/workflows.ts 的 isValidISODate 必须保持完全一致
 */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // 防止 '2020-13-01' 这种格式正确但日期非法的情况
  return d.toISOString().slice(0, 10) === value;
}

/**
 * 判断项目是否为大集体（5 人及以上）
 * 大集体不设年龄分组，自由组队
 */
export function isBigTeamEvent(maxAthletes?: number): boolean {
  return typeof maxAthletes === 'number' && maxAthletes >= BIG_TEAM_MIN_SIZE;
}
import { PRESET_COMBINED_GROUPS, PRESET_AGE_GROUPS, birthRangeForAge, type CombinedGroupPreset } from './presets';

// ========================
// 工具函数
// ========================

/**
 * 计算周岁年龄（以比赛日期为基准）
 * @param birthDate      'YYYY-MM-DD'
 * @param competitionDate 'YYYY-MM-DD'
 */
export function calcAge(birthDate: string, competitionDate: string): number {
  if (!birthDate || !competitionDate) return 0;
  const birth = new Date(birthDate);
  const comp = new Date(competitionDate);
  let age = comp.getFullYear() - birth.getFullYear();
  const mDiff = comp.getMonth() - birth.getMonth();
  if (mDiff < 0 || (mDiff === 0 && comp.getDate() < birth.getDate())) {
    age--;
  }
  return Math.max(0, age);
}

/**
 * 判断某个 EventGroup（数据库中的分组）是否对指定运动员开放
 * 依据：ageMin/ageMax/gender 字段
 *
 * @param maxAthletes 项目每队最多人数；>= 5 视为大集体，跳过年龄校验
 */
export function isGroupEligible(
  group: { ageMin?: number; ageMax?: number; gender?: string },
  birthDate: string,
  gender: 'male' | 'female',
  competitionDate: string,
  maxAthletes?: number,
): boolean {
  // 大集体（5 人及以上）：不设年龄分组，自由组队
  if (isBigTeamEvent(maxAthletes)) {
    return isGenderEligible(group, gender);
  }
  return canEnterGroup(group, birthDate, gender, competitionDate);
}

/**
 * 性别是否匹配（mixed 表示不限制；未设置也不限制）
 */
function isGenderEligible(
  group: { gender?: string },
  gender: 'male' | 'female',
): boolean {
  if (group.gender && group.gender !== 'mixed') {
    return group.gender === gender;
  }
  return true;
}

/**
 * 判断某运动员能否进入该组别 —— 「报高不报低」
 *
 * 判定依据：出生日期范围（随赛事年份动态推算），而非周岁
 *  - 出生日期 ≥ 该组出生起始日 → 可报名（年龄足够小，可往大年龄组升）
 *  - 出生日期 < 该组出生起始日 → 拒绝（年龄偏大，严禁降组报更小的组）
 *
 * 例（2026 年赛事，出生年份 = 2026 − 年龄）：
 *  - 2016 年出生（10 岁）报 儿童乙组(2014~2016)：2016 ≥ 2014 ✓
 *  - 2016 年出生（10 岁）报 少年甲组(2011~2013)：2016 ≥ 2011 ✓（升组允许）
 *  - 2013 年出生（13 岁）报 儿童乙组(2014~2016)：2013 < 2014 ✗（降组禁止）
 *
 * @param competitionDate 赛事开始日期，用于推算出生日期范围
 */
export function canEnterGroup(
  group: { ageMin?: number; ageMax?: number; gender?: string },
  birthDate: string,
  gender: 'male' | 'female',
  competitionDate: string,
): boolean {
  if (!isGenderEligible(group, gender)) return false;
  if (!isValidISODate(birthDate)) return false;
  const { start } = birthRangeForAge(group.ageMin, group.ageMax, competitionDate);
  // 报高不报低：出生日期不早于该组起始日即可（起始日越早 = 年龄组越大）
  return birthDate >= start;
}

/**
 * 运动员的出生日期是否精确落在该组别区间内（不跨组）
 */
export function isBirthInGroupRange(
  group: { ageMin?: number; ageMax?: number },
  birthDate: string,
  competitionDate: string,
): boolean {
  if (!isValidISODate(birthDate)) return false;
  const { start, end } = birthRangeForAge(group.ageMin, group.ageMax, competitionDate);
  return birthDate >= start && birthDate <= end;
}

// ========================
// 核心：根据出生日期 + 性别获取符合条件的组别（基于预设）
// ========================

/**
 * 根据出生日期和性别获取【本组】的预设组别列表
 * 判定依据：出生日期落在 [赛事年份-ageMax, 赛事年份-ageMin] 区间内
 */
export function getExactPresetGroups(
  birthDate: string,
  gender: 'male' | 'female',
  competitionDate: string,
): CombinedGroupPreset[] {
  const result: CombinedGroupPreset[] = [];

  // 1. 匹配标准年龄组（按出生日期范围）
  const matchedAgeIds = new Set<string>();
  for (const ag of PRESET_AGE_GROUPS) {
    if (ag.ageMin !== undefined && ag.ageMax !== undefined) {
      if (isBirthInGroupRange({ ageMin: ag.ageMin, ageMax: ag.ageMax }, birthDate, competitionDate)) {
        matchedAgeIds.add(ag.id);
      }
    }
  }

  // 2. 特教组：无年龄限制，始终匹配
  matchedAgeIds.add('age_8');

  // 3. 根据匹配的年龄组 + 性别，找到对应的组合组别
  for (const ageId of matchedAgeIds) {
    const candidates = PRESET_COMBINED_GROUPS.filter(
      (g) => g.ageGroup.id === ageId && !g.isStandalone,
    );
    for (const c of candidates) {
      if (c.gender === gender) {
        result.push(c);
      }
    }
  }

  return result;
}

/**
 * 获取【可升级】的组别列表 —— 「报高不报低」
 * 规则：出生日期 ≥ 该组出生起始日 的组别均可报名（含本组与更高年龄组）
 */
export function getCrossPresetGroups(
  birthDate: string,
  gender: 'male' | 'female',
  competitionDate: string,
): CombinedGroupPreset[] {
  const result: CombinedGroupPreset[] = [];

  for (const cg of PRESET_COMBINED_GROUPS) {
    if (cg.isStandalone) continue;
    if (cg.gender !== gender) continue;
    if (!canEnterGroup({ ageMin: cg.ageMin, ageMax: cg.ageMax, gender: cg.gender }, birthDate, gender, competitionDate)) continue;
    result.push(cg);
  }

  // 特教组无年龄限制，始终可报
  const special = PRESET_COMBINED_GROUPS.filter(
    (cg) => cg.ageGroup?.id === 'age_8' && cg.gender === gender,
  );
  const seen = new Set(result.map((g) => g.id));
  for (const cg of special) {
    if (!seen.has(cg.id)) result.push(cg);
  }
  return result;
}

/**
 * 报名时获取可选组别
 *
 * @param isIndividual 是否单人项目
 * @param maxAthletes  每队最多人数；>= 5 的大集体不设年龄分组，返回全部组别
 */
export function getAvailablePresetGroups(
  birthDate: string,
  gender: 'male' | 'female',
  competitionDate: string,
  isIndividual: boolean,
  maxAthletes?: number,
): CombinedGroupPreset[] {
  // 大集体（5 人及以上）：自由组队，不分年龄
  if (!isIndividual && isBigTeamEvent(maxAthletes)) {
    return PRESET_COMBINED_GROUPS.filter((cg) => cg.gender === gender || cg.gender === undefined);
  }
  // 个人项目、2-4 人小集体：报高不报低
  return getCrossPresetGroups(birthDate, gender, competitionDate);
}

// ========================
// 报名端：根据已选运动员过滤可选分组（对接 EventGroup）
// ========================

/**
 * 根据已选运动员列表，过滤出所有运动员均可报的组别
 *
 * - 大集体（5 人及以上）：不设年龄分组，全部组别开放（仍校验性别）
 * - 个人项目、2-4 人小集体：报高不报低（年龄 ≤ ageMax）
 *
 * @param groups        该赛事项目下的所有分组（EventGroup[]）
 * @param athletes     已选择的运动员列表 [{ birthDate, gender }]
 * @param isIndividual 是否单人项目
 * @param competitionDate 比赛日期
 * @param maxAthletes  每队最多人数，用于区分大/小集体
 * @returns           过滤后的分组列表
 */
export function filterEligibleGroups(
  groups: { id: string; name: string; ageMin?: number; ageMax?: number; gender?: string }[],
  athletes: { birthDate: string; gender: 'male' | 'female' }[],
  isIndividual: boolean,
  competitionDate: string,
  maxAthletes?: number,
): { id: string; name: string; ageMin?: number; ageMax?: number; gender?: string }[] {
  if (athletes.length === 0) return groups; // 未选运动员，显示全部

  return groups.filter((group) => {
    // 所有已选运动员都必须符合该分组要求
    return athletes.every((ath) =>
      isGroupEligible(group, ath.birthDate, ath.gender, competitionDate, maxAthletes),
    );
  });
}

// ========================
// 审核校验
// ========================

export interface GroupValidationResult {
  valid: boolean;
  /** 是否因跨组而通过（多人项目） */
  isCross?: boolean;
  /** 提示信息 */
  message: string;
  /** 建议的正确组别名称列表 */
  suggestedNames: string[];
}

/**
 * 审核时校验一条报名记录的分组是否正确
 *
 * 规则：
 *  - 大集体（5 人及以上）：不设年龄分组，只要性别符合即通过
 *  - 个人项目、2-4 人小集体：报高不报低（年龄 ≤ ageMax）
 *
 * @param birthDate       运动员出生日期
 * @param gender          运动员性别
 * @param registeredGroup 报名时选择的分组（EventGroup 类型）
 * @param isIndividual    所报项目是否单人项目
 * @param competitionDate 比赛日期
 * @param maxAthletes     每队最多人数，用于区分大/小集体
 */
export function validateGroupRegistration(
  birthDate: string,
  gender: 'male' | 'female',
  registeredGroup: { ageMin?: number; ageMax?: number; gender?: string; name: string },
  isIndividual: boolean,
  competitionDate: string,
  maxAthletes?: number,
): GroupValidationResult {
  const age = calcAge(birthDate, competitionDate);
  const genderText = gender === 'male' ? '男' : '女';

  // 大集体：不设年龄分组，自由组队
  if (!isIndividual && isBigTeamEvent(maxAthletes)) {
    if (!isGenderEligible(registeredGroup, gender)) {
      return {
        valid: false,
        message: `性别不符！该运动员为${genderText}，当前选择的是「${registeredGroup.name}」`,
        suggestedNames: [],
      };
    }
    return {
      valid: true,
      message: `分组正确（大集体项目，${maxAthletes} 人，自由组队不区分年龄）`,
      suggestedNames: [registeredGroup.name],
    };
  }

  // 个人项目 / 小集体：报高不报低（按出生日期范围判定）
  if (!isValidISODate(birthDate)) {
    return {
      valid: false,
      message: `出生日期格式无效（${JSON.stringify(birthDate)}），无法校验分组`,
      suggestedNames: [],
    };
  }
  if (canEnterGroup(registeredGroup, birthDate, gender, competitionDate)) {
    const isExactMatch = isBirthInGroupRange(registeredGroup, birthDate, competitionDate);
    return {
      valid: true,
      isCross: !isExactMatch,
      message: isExactMatch
        ? `分组正确（${birthDate} 出生，完全匹配 ${registeredGroup.name}）`
        : `分组正确（${birthDate} 出生，升组报名 ${registeredGroup.name}）`,
      suggestedNames: [registeredGroup.name],
    };
  }

  // 不合法：出生日期早于该组起始日（= 年龄偏大，降组）
  const allowed = getCrossPresetGroups(birthDate, gender, competitionDate);
  const { start } = birthRangeForAge(registeredGroup.ageMin, registeredGroup.ageMax, competitionDate);
  const overLimit = isValidISODate(birthDate) && birthDate < start;
  return {
    valid: false,
    message: overLimit
      ? `分组错误！该运动员出生日期 ${birthDate} 早于「${registeredGroup.name}」的起始日 ${start}，不允许降组报名。可报 ${allowed.map((g) => `「${g.name}」`).join('、')}`
      : `分组错误！该运动员（${birthDate} 出生/${genderText}）可报 ${allowed.map((g) => `「${g.name}」`).join('、')}，当前选择的是「${registeredGroup.name}」`,
    suggestedNames: allowed.map((g) => g.name),
  };
}

/**
 * 批量校验：一条报名记录中多名运动员的分组是否都合法
 * 返回每个运动员的校验结果
 */
export function validateRegistrationBatch(
  athletes: { birthDate: string; gender: 'male' | 'female'; name: string }[],
  registeredGroup: { ageMin?: number; ageMax?: number; gender?: string; name: string },
  isIndividual: boolean,
  competitionDate: string,
  maxAthletes?: number,
): ValidationResultPerAthlete[] {
  return athletes.map((ath) => ({
    ...ath,
    ...validateGroupRegistration(ath.birthDate, ath.gender, registeredGroup, isIndividual, competitionDate, maxAthletes),
  }));
}

export interface ValidationResultPerAthlete {
  name: string;
  birthDate: string;
  gender: 'male' | 'female';
  valid: boolean;
  isCross?: boolean;
  message: string;
  suggestedNames: string[];
}

/**
 * 根据组别名称校验（便捷版 — 通过组别名称反查预设里的年龄/性别约束，再校验）
 * 适用于 Registration.athletes 只有 name 的场景
 */
export function validateGroupByName(
  athleteBirthDate: string,
  athleteGender: 'male' | 'female',
  groupName: string,
  isIndividual: boolean,
  competitionDate: string,
  maxAthletes?: number,
): GroupValidationResult {
  const presetGroup = PRESET_COMBINED_GROUPS.find((g) => g.name === groupName);
  if (!presetGroup) {
    return {
      valid: false,
      message: `分组「${groupName}」不在预设组别中，无法自动校验`,
      suggestedNames: [],
    };
  }
  return validateGroupRegistration(
    athleteBirthDate,
    athleteGender,
    {
      ageMin: presetGroup.ageMin,
      ageMax: presetGroup.ageMax,
      gender: presetGroup.gender,
      name: presetGroup.name,
    },
    isIndividual,
    competitionDate,
    maxAthletes,
  );
}

/**
 * 根据组别名称做批量校验（便捷版）
 */
export function validateRegistrationByName(
  athletes: { birthDate: string; gender: 'male' | 'female'; name: string }[],
  groupName: string,
  isIndividual: boolean,
  competitionDate: string,
  maxAthletes?: number,
): ValidationResultPerAthlete[] {
  return athletes.map((ath) => ({
    ...ath,
    ...validateGroupByName(ath.birthDate, ath.gender, groupName, isIndividual, competitionDate, maxAthletes),
  }));
}
