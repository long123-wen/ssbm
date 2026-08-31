// ========================
// 预设组别 & 预设项目
// 基于《全国跳绳竞赛规则》预设数据
// ========================

/**
 * 命名体系（同一场比赛只能使用其中一套，不可混用）
 *  - 'zh'：中文命名（幼儿组 / 儿童甲组 / 少年甲组 ... 成年组）
 *  - 'u' ：U 系列命名（U6 / U9 / U12 / U15 / U18 / 19+ / 26+）
 *  - 'common'：通用组别（特教组 / 亲子组 / 不分组别），两套体系均可共存
 */
export type NamingSystem = 'zh' | 'u' | 'common';

export interface PresetGroup {
  id: string;
  name: string;
  type: 'gender' | 'age' | 'level' | 'team';
  gender?: 'male' | 'female' | 'mixed';
  ageMin?: number;
  ageMax?: number;
  birthStart?: string;   // 出生日期范围（起）
  birthEnd?: string;     // 出生日期范围（止）
  description?: string;
  appliesTo?: 'individual' | 'team_small' | 'team_large' | 'all'; // 适用的项目类型
  subCategory?: string;  // 亲子等特殊子类
  /** 所属命名体系，缺省视为 'zh' */
  namingSystem?: NamingSystem;
}

export interface PresetEvent {
  id: string;
  name: string;
  code: string;
  category: string;      // 计数赛/花样赛/民族跳绳操/亲子赛/挑战赛
  subCategory: string;   // 个人速度赛/集体速度赛/个人花样等
  description?: string;
  maxAthletes: number;   // 每队最多人数
  isIndividual: boolean; // 是否个人项目
  note?: string;         // 特殊说明（如12周岁以上）
}

// ========================
// 预设年龄分组（全国跳绳竞赛规则 年龄分组）
// ========================
export const PRESET_AGE_GROUPS: PresetGroup[] = [
  {
    id: 'age_1',
    namingSystem: 'zh',
    name: '幼儿组',
    type: 'age',
    ageMin: 4,
    ageMax: 6,
    birthStart: '2020-01-01',
    birthEnd: '2022-12-31',
    description: '4-6岁',
  },
  {
    id: 'age_2',
    namingSystem: 'zh',
    name: '儿童甲组',
    type: 'age',
    ageMin: 7,
    ageMax: 9,
    birthStart: '2017-01-01',
    birthEnd: '2019-12-31',
    description: '7-9岁',
  },
  {
    id: 'age_3',
    namingSystem: 'zh',
    name: '儿童乙组',
    type: 'age',
    ageMin: 10,
    ageMax: 12,
    birthStart: '2014-01-01',
    birthEnd: '2016-12-31',
    description: '10-12岁',
  },
  {
    id: 'age_4',
    namingSystem: 'zh',
    name: '少年甲组',
    type: 'age',
    ageMin: 13,
    ageMax: 15,
    birthStart: '2011-01-01',
    birthEnd: '2013-12-31',
    description: '13-15岁',
  },
  {
    id: 'age_5',
    namingSystem: 'zh',
    name: '少年乙组',
    type: 'age',
    ageMin: 16,
    ageMax: 18,
    birthStart: '2008-01-01',
    birthEnd: '2010-12-31',
    description: '16-18岁',
  },
  {
    id: 'age_6',
    namingSystem: 'zh',
    name: '青年组',
    type: 'age',
    ageMin: 19,
    ageMax: 25,
    birthStart: '2001-01-01',
    birthEnd: '2007-12-31',
    description: '19-25岁',
  },
  {
    id: 'age_7',
    namingSystem: 'zh',
    name: '成年组',
    type: 'age',
    ageMin: 26,
    // 无上限
    birthStart: '1900-01-01',
    birthEnd: '2000-12-31',
    description: '26岁及以上（2000-12-31 之前出生）',
  },
  {
    id: 'age_8',
    namingSystem: 'common',
    name: '特教组',
    type: 'age',
    // 无年龄限制
    description: '无年龄限制',
  },
  {
    id: 'age_9',
    namingSystem: 'common',
    name: '亲子甲组',
    type: 'team',
    ageMin: 3,
    ageMax: 6,
    description: '1名3-6岁幼儿+1名家长',
    subCategory: '亲子组',
  },
  {
    id: 'age_10',
    namingSystem: 'common',
    name: '亲子乙组',
    type: 'team',
    ageMin: 3,
    ageMax: 6,
    description: '1名3-6岁幼儿+1名教练',
    subCategory: '亲子组',
  },

  // ========================
  // 第二套命名体系：U 系列（与上方 1-7 组完全等价，仅名称不同）
  //   U6  = 幼儿组（4-6 岁）
  //   U9  = 儿童甲组（7-9 岁）
  //   U12 = 儿童乙组（10-12 岁）
  //   U15 = 少年甲组（13-15 岁）
  //   U18 = 少年乙组（16-18 岁）
  //   19+ = 青年组（19-25 岁）
  //   26+ = 成年组（26 岁及以上）
  // 出生日期范围仍按赛事年份动态推算（见下方 birthRangeForAge）
  // ========================
  { id: 'age_u_6',  namingSystem: 'u', name: 'U6',  type: 'age', ageMin: 4,  ageMax: 6,  description: '4-6 岁' },
  { id: 'age_u_9',  namingSystem: 'u', name: 'U9',  type: 'age', ageMin: 7,  ageMax: 9,  description: '7-9 岁' },
  { id: 'age_u_12', namingSystem: 'u', name: 'U12', type: 'age', ageMin: 10, ageMax: 12, description: '10-12 岁' },
  { id: 'age_u_15', namingSystem: 'u', name: 'U15', type: 'age', ageMin: 13, ageMax: 15, description: '13-15 岁' },
  { id: 'age_u_18', namingSystem: 'u', name: 'U18', type: 'age', ageMin: 16, ageMax: 18, description: '16-18 岁' },
  { id: 'age_u_19', namingSystem: 'u', name: '19+', type: 'age', ageMin: 19, ageMax: 25, description: '19-25 岁' },
  { id: 'age_u_26', namingSystem: 'u', name: '26+', type: 'age', ageMin: 26, description: '26 岁及以上' },
];

// ========================
// 命名体系互斥检测
// ========================

/**
 * 根据赛事中已存在的分组名称，推断该赛事正在使用的命名体系。
 *
 * 规则：同一场比赛只能使用一套命名体系（中文 / U 系列），不可混用。
 * 通用组别（特教组 / 亲子组 / 不分组别）不参与体系判定，两套体系都能共存。
 *
 * @param groupNames 该赛事下已有分组的名称列表
 * @returns 'zh' | 'u' | null（null = 尚未确定，两套都可选）
 */
export function detectNamingSystem(groupNames: string[]): 'zh' | 'u' | null {
  let hasZh = false;
  let hasU = false;
  for (const g of PRESET_COMBINED_GROUPS) {
    if (g.namingSystem !== 'zh' && g.namingSystem !== 'u') continue;
    if (!groupNames.includes(g.name)) continue;
    if (g.namingSystem === 'zh') hasZh = true;
    else hasU = true;
  }
  if (hasZh && !hasU) return 'zh';
  if (hasU && !hasZh) return 'u';
  // 同时存在两套（理论上不该发生）→ 以中文体系为准，要求先清理另一套
  if (hasZh) return 'zh';
  return null;
}

/** 体系显示名 */
export function namingSystemLabel(s: 'zh' | 'u' | null): string {
  return s === 'u' ? 'U 系列命名' : s === 'zh' ? '中文命名' : '未选择';
}

// ========================
// 出生日期范围（按赛事年份动态推算）
// ========================

/**
 * 根据赛事日期动态推算某年龄组的出生日期范围。
 *
 * 规则（全国跳绳竞赛规则）：出生年份 = 赛事年份 − 年龄
 *  - 年龄区间 [ageMin, ageMax]
 *    → 出生年份区间 [赛事年份 − ageMax, 赛事年份 − ageMin]
 *    → 出生日期范围 [`${年-ageMax}-01-01`, `${年-ageMin}-12-31`]
 *
 * 例（2026 年赛事）：
 *  - 幼儿组 4-6 岁   → 2020-01-01 ~ 2022-12-31
 *  - 儿童甲组 7-9 岁 → 2017-01-01 ~ 2019-12-31
 *  - 成年组 26 岁+   → ~ 2000-12-31（无下限）
 *
 * 2027 年赛事自动顺延一年（幼儿组 → 2021-01-01 ~ 2023-12-31），无需改代码。
 *
 * @param ageMin         最小年龄（undefined = 不限）
 * @param ageMax         最大年龄（undefined = 不限）
 * @param competitionDate 赛事开始日期 'YYYY-MM-DD'
 */
export function birthRangeForAge(
  ageMin: number | undefined,
  ageMax: number | undefined,
  competitionDate: string,
): { start: string; end: string } {
  const year = competitionDate ? new Date(competitionDate).getFullYear() : new Date().getFullYear();
  const FAR_PAST = '1900-01-01';
  const start =
    ageMax === undefined || ageMax === null
      ? FAR_PAST
      : `${year - Number(ageMax)}-01-01`;
  const end =
    ageMin === undefined || ageMin === null
      ? `${year}-12-31`
      : `${year - Number(ageMin)}-12-31`;
  return { start, end };
}

// ========================
// 预设性别分组
// ========================
export const PRESET_GENDER_GROUPS: PresetGroup[] = [
  { id: 'gender_m', name: '男子组', type: 'gender', gender: 'male', description: '仅限男子参赛', appliesTo: 'all' },
  { id: 'gender_f', name: '女子组', type: 'gender', gender: 'female', description: '仅限女子参赛', appliesTo: 'all' },
  { id: 'gender_x', name: '混合组', type: 'gender', gender: 'mixed', description: '必须有一名异性', appliesTo: 'team_small' },
];

// ========================
// 预设竞赛项目（全国跳绳竞赛规则）
// ========================
export const PRESET_EVENTS: PresetEvent[] = [
  // ---- 1. 计数赛 > 个人速度赛 ----
  { id: 'ev_1',  name: '30秒单摇跳',                    code: 'SR-S30',  category: '计数赛', subCategory: '个人速度赛', maxAthletes: 1, isIndividual: true },
  { id: 'ev_2',  name: '30秒双摇跳',                    code: 'DR-S30',  category: '计数赛', subCategory: '个人速度赛', maxAthletes: 1, isIndividual: true },
  { id: 'ev_3',  name: '1分钟交替交叉单摇跳',            code: 'AC-S60',  category: '计数赛', subCategory: '个人速度赛', maxAthletes: 1, isIndividual: true, description: '单龙花' },
  { id: 'ev_4',  name: '1分钟双脚交替连续跳',            code: 'AF-S60',  category: '计数赛', subCategory: '个人速度赛', maxAthletes: 1, isIndividual: true, description: '一根绳' },
  { id: 'ev_5',  name: '1分钟侧身旋转换接绳',            code: 'SS-S60',  category: '计数赛', subCategory: '个人速度赛', maxAthletes: 1, isIndividual: true, description: '飞龙在天' },
  { id: 'ev_6',  name: '连续三摇跳',                     code: 'TR-C',    category: '计数赛', subCategory: '个人速度赛', maxAthletes: 1, isIndividual: true, note: '12周岁以上' },
  { id: 'ev_7',  name: '30秒间隔交叉后摇跳',             code: 'IC-S30',  category: '计数赛', subCategory: '个人速度赛', maxAthletes: 1, isIndividual: true },
  { id: 'ev_8',  name: '3分钟单摇跳',                    code: 'SR-S180', category: '计数赛', subCategory: '个人速度赛', maxAthletes: 1, isIndividual: true },

  // ---- 1. 计数赛 > 集体速度赛 ----
  { id: 'ev_9',  name: '4×30秒单摇接力',                 code: 'SR-R4x30',  category: '计数赛', subCategory: '集体速度赛', maxAthletes: 4, isIndividual: false },
  { id: 'ev_10', name: '2×30秒双摇接力',                 code: 'DR-R2x30',  category: '计数赛', subCategory: '集体速度赛', maxAthletes: 2, isIndividual: false },
  { id: 'ev_11', name: '30秒一带一单摇跳',               code: 'SR-P30',    category: '计数赛', subCategory: '集体速度赛', maxAthletes: 2, isIndividual: false },
  { id: 'ev_12', name: '1分钟交互绳换接绳跳',            code: 'IR-C60',    category: '计数赛', subCategory: '集体速度赛', maxAthletes: 4, isIndividual: false, description: '凌波微步' },
  { id: 'ev_13', name: '3×30秒三人协同接力跳',           code: 'CR-R3x30',  category: '计数赛', subCategory: '集体速度赛', maxAthletes: 3, isIndividual: false, description: '二龙戏珠' },
  { id: 'ev_14', name: '30秒单双摇协同跳',               code: 'SD-C30',    category: '计数赛', subCategory: '集体速度赛', maxAthletes: 2, isIndividual: false, description: '如影随形' },
  { id: 'ev_15', name: '2×30秒10人网绳接力跳',           code: 'NR-R2x30',  category: '计数赛', subCategory: '集体速度赛', maxAthletes: 10, isIndividual: false, description: '同心协力' },
  { id: 'ev_16', name: '1分钟10人长绳集体跳',            code: 'LR-C60',    category: '计数赛', subCategory: '集体速度赛', maxAthletes: 10, isIndividual: false },
  { id: 'ev_17', name: '1分钟10人长绳"8"字跳',           code: 'LR8-C60',   category: '计数赛', subCategory: '集体速度赛', maxAthletes: 10, isIndividual: false },

  // ---- 2. 花样赛 > 个人花样 ----
  { id: 'ev_18', name: '民族个人花样步法高（一级）',     code: 'MF-1',  category: '花样赛', subCategory: '个人花样', maxAthletes: 1, isIndividual: true },
  { id: 'ev_19', name: '民族个人花样步法高（二级）',     code: 'MF-2',  category: '花样赛', subCategory: '个人花样', maxAthletes: 1, isIndividual: true },
  { id: 'ev_20', name: '民族个人花样步法高（三级）',     code: 'MF-3',  category: '花样赛', subCategory: '个人花样', maxAthletes: 1, isIndividual: true },
  { id: 'ev_21', name: '个人花样自编',                   code: 'FS-C',  category: '花样赛', subCategory: '个人花样', maxAthletes: 1, isIndividual: true, description: '自编套路' },

  // ---- 2. 花样赛 > 两人车轮花样 ----
  { id: 'ev_22', name: '两人中国轮花样赛',               code: 'CF-2',  category: '花样赛', subCategory: '两人车轮花样', maxAthletes: 2, isIndividual: false },

  // ---- 3. 民族跳绳操项目 ----
  { id: 'ev_23', name: '民族跳绳操规定套路一级',          code: 'ND-1',  category: '民族跳绳操', subCategory: '规定套路', maxAthletes: 16, isIndividual: false, description: '90~120秒，8-16人' },
  { id: 'ev_24', name: '民族跳绳操规定套路二级',          code: 'ND-2',  category: '民族跳绳操', subCategory: '规定套路', maxAthletes: 16, isIndividual: false, description: '90~120秒，8-16人' },
  { id: 'ev_25', name: '民族跳绳操规定套路三级',          code: 'ND-3',  category: '民族跳绳操', subCategory: '规定套路', maxAthletes: 16, isIndividual: false, description: '90~120秒，8-16人' },
  { id: 'ev_26', name: '民族跳绳操自编套路',              code: 'NF-C',  category: '民族跳绳操', subCategory: '自编套路', maxAthletes: 16, isIndividual: false, description: '4~8分钟，8-16人' },

  // ---- 4. 亲子赛 ----
  { id: 'ev_27', name: '30秒两人一单一摇跳',              code: 'PR-1S30',  category: '亲子赛', subCategory: '亲子速度', maxAthletes: 2, isIndividual: false },
  { id: 'ev_28', name: '2×30秒单摇接力（亲子）',          code: 'PR-R2x30', category: '亲子赛', subCategory: '亲子速度', maxAthletes: 2, isIndividual: false },
  { id: 'ev_29', name: '30秒两人和谐单摇跳',              code: 'PR-HS30',  category: '亲子赛', subCategory: '亲子速度', maxAthletes: 2, isIndividual: false },

  // ---- 5. 挑战赛 ----
  { id: 'ev_30', name: '个人绳一对一挑战赛',              code: 'VS-1v1',   category: '挑战赛', subCategory: '一对一', maxAthletes: 2, isIndividual: true, description: '1v1斗绳' },

  // ---- 6. 规定赛 > 个人花样集体规定套路 ----
  { id: 'ev_31', name: '个人花样集体规定套路初级',          code: 'PR-E1',   category: '规定赛', subCategory: '个人花样集体规定套路', maxAthletes: 8, isIndividual: false },
  { id: 'ev_32', name: '个人花样集体规定套路中级',          code: 'PR-E2',   category: '规定赛', subCategory: '个人花样集体规定套路', maxAthletes: 8, isIndividual: false },
  { id: 'ev_33', name: '个人花样集体规定套路高级',          code: 'PR-E3',   category: '规定赛', subCategory: '个人花样集体规定套路', maxAthletes: 8, isIndividual: false },

  // ---- 6. 规定赛 > 车轮花样集体规定套路 ----
  { id: 'ev_34', name: '车轮花样集体规定基础套路',          code: 'PR-W1',   category: '规定赛', subCategory: '车轮花样集体规定套路', maxAthletes: 2, isIndividual: false },
  { id: 'ev_35', name: '车轮花样集体规定提高套路',          code: 'PR-W2',   category: '规定赛', subCategory: '车轮花样集体规定套路', maxAthletes: 2, isIndividual: false },

  // ---- 6. 规定赛 > 交互绳花样集体规定套路 ----
  { id: 'ev_36', name: '交互绳花样集体规定基础套路',        code: 'PR-I1',   category: '规定赛', subCategory: '交互绳花样集体规定套路', maxAthletes: 4, isIndividual: false },
  { id: 'ev_37', name: '交互绳花样集体规定提高套路',        code: 'PR-I2',   category: '规定赛', subCategory: '交互绳花样集体规定套路', maxAthletes: 4, isIndividual: false },
];

// ========================
// 组合式组别预设（年龄+性别 = 实际比赛组别）
// 例如：儿童乙组 + 男子组 = 儿童乙组男子组
// ========================
export interface CombinedGroupPreset {
  id: string;
  /** 最终显示名称，如 "儿童乙组男子组" */
  name: string;
  /** 年龄组信息 */
  ageGroup: PresetGroup;
  /** 性别分组（亲子组等独立组别为 null） */
  genderGroup: PresetGroup | null;
  /** 最终 group type */
  type: 'age' | 'team';
  /** 最终 gender */
  gender?: 'male' | 'female' | 'mixed';
  ageMin?: number;
  ageMax?: number;
  /** 简短描述，如 "10-12岁 · 男子" */
  description: string;
  /** 是否为独立组别（亲子组，不区分性别） */
  isStandalone: boolean;
  /** 所属命名体系（'zh' 中文 / 'u' U系列 / 'common' 通用） */
  namingSystem: NamingSystem;
}

/** 生成所有组合式组别（年龄组 × 性别分组） */
function buildCombinedGroups(): CombinedGroupPreset[] {
  const result: CombinedGroupPreset[] = [];

  // 性别映射
  const malePreset = PRESET_GENDER_GROUPS.find(g => g.id === 'gender_m')!;
  const femalePreset = PRESET_GENDER_GROUPS.find(g => g.id === 'gender_f')!;
  const mixedPreset = PRESET_GENDER_GROUPS.find(g => g.id === 'gender_x')!;

  // 不分组别（独立特殊分组）
  result.push({
    id: 'comb_none',
    name: '不分组别',
    ageGroup: {
      id: 'age_none',
      name: '不分组别',
      type: 'age',
      description: '不区分年龄和性别',
    },
    genderGroup: null,
    type: 'age',
    gender: undefined,
    description: '不区分年龄和性别',
    isStandalone: true,
    namingSystem: 'common',
  });

  // 标准年龄组（中文命名 + U 系列命名 + 特教组）→ 生成 男子组 / 女子组 / 混合组
  const standardAgeIds = new Set([
    'age_1', 'age_2', 'age_3', 'age_4', 'age_5', 'age_6', 'age_7', 'age_8',  // 中文命名
    'age_u_6', 'age_u_9', 'age_u_12', 'age_u_15', 'age_u_18', 'age_u_19', 'age_u_26',  // U 命名
  ]);
  for (const age of PRESET_AGE_GROUPS) {
    if (standardAgeIds.has(age.id)) {
      // 男子组
      result.push({
        id: `comb_${age.id}_gender_m`,
        name: `${age.name}男子组`,
        ageGroup: age,
        genderGroup: malePreset,
        type: 'age',
        gender: 'male',
        ageMin: age.ageMin,
        ageMax: age.ageMax,
        description: age.description || '',
        isStandalone: false,
        namingSystem: age.namingSystem || 'zh',
      });
      // 女子组
      result.push({
        id: `comb_${age.id}_gender_f`,
        name: `${age.name}女子组`,
        ageGroup: age,
        genderGroup: femalePreset,
        type: 'age',
        gender: 'female',
        ageMin: age.ageMin,
        ageMax: age.ageMax,
        description: age.description || '',
        isStandalone: false,
        namingSystem: age.namingSystem || 'zh',
      });
      // 混合组（男女合并）
      result.push({
        id: `comb_${age.id}_gender_x`,
        name: `${age.name}混合组`,
        ageGroup: age,
        genderGroup: mixedPreset,
        type: 'age',
        gender: 'mixed',
        ageMin: age.ageMin,
        ageMax: age.ageMax,
        description: (age.description || '') + ' · 男女混合',
        isStandalone: false,
        namingSystem: age.namingSystem || 'zh',
      });
    } else {
      // 亲子组等独立组别
      result.push({
        id: `comb_${age.id}_standalone`,
        name: age.name,
        ageGroup: age,
        genderGroup: null,
        type: 'team',
        gender: undefined,
        ageMin: age.ageMin,
        ageMax: age.ageMax,
        description: age.description || '',
        isStandalone: true,
        namingSystem: age.namingSystem || 'common',
      });
    }
  }
  return result;
}

/** 所有组合式预设组别 */
export const PRESET_COMBINED_GROUPS: CombinedGroupPreset[] = buildCombinedGroups();

/** 获取所有预设项目分类树 */
export function getEventCategoryTree() {
  const tree: Record<string, Record<string, PresetEvent[]>> = {};
  for (const ev of PRESET_EVENTS) {
    if (!tree[ev.category]) tree[ev.category] = {};
    if (!tree[ev.category][ev.subCategory]) tree[ev.category][ev.subCategory] = [];
    tree[ev.category][ev.subCategory].push(ev);
  }
  return tree;
}
