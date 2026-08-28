// ==============================
// 中国居民身份证号码校验器
// 标准：GB 11643-1999
// ==============================

/** 校验结果：ok 或 错误原因 */
export interface IdCardResult {
  valid: boolean;
  error?: string;
}

/** 加权因子：前17位的权重 */
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];

/** 校验码映射表：余数 → 校验码 */
const CHECK_MAP = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

/**
 * 校验中国居民身份证号码合法性
 *
 * 校验规则：
 * 1. 长度为18位
 * 2. 前17位必须为数字
 * 3. 第18位为数字或大写字母 X
 * 4. 校验码算法验证（ISO 7064:1983 MOD 11-2）
 * 5. 出生日期合法性校验
 */
export function validateIdCard(idCard: string): IdCardResult {
  // 移除首尾空白
  const cleaned = (idCard || '').trim().toUpperCase();

  // ---- 1. 空值检查 ----
  if (!cleaned) {
    return { valid: false, error: '请输入身份证号码' };
  }

  // ---- 2. 长度检查 ----
  if (cleaned.length !== 18) {
    return { valid: false, error: `身份证号必须为18位，当前为 ${cleaned.length} 位` };
  }

  // ---- 3. 前17位必须为数字 ----
  if (!/^\d{17}$/.test(cleaned.slice(0, 17))) {
    return { valid: false, error: '身份证号前17位必须为数字' };
  }

  // ---- 4. 第18位为数字或 X ----
  if (!/^[\dX]$/.test(cleaned[17])) {
    return { valid: false, error: '身份证号第18位必须为数字或大写字母 X' };
  }

  // ---- 5. 出生日期合法性 ----
  const birthStr = cleaned.slice(6, 14);
  const year = parseInt(birthStr.slice(0, 4), 10);
  const month = parseInt(birthStr.slice(4, 6), 10);
  const day = parseInt(birthStr.slice(6, 8), 10);

  // 年份范围
  if (year < 1900 || year > new Date().getFullYear()) {
    return { valid: false, error: `身份证号出生年份不合法: ${year}` };
  }
  // 月份范围
  if (month < 1 || month > 12) {
    return { valid: false, error: `身份证号出生月份不合法: ${month}` };
  }
  // 日期范围
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return { valid: false, error: `身份证号出生日期不合法: ${month}月${day}日` };
  }
  // 不能是未来日期
  const birthDate = new Date(year, month - 1, day);
  if (birthDate > new Date()) {
    return { valid: false, error: '身份证号出生日期不能是未来日期' };
  }

  // ---- 6. 校验码算法验证 ----
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += parseInt(cleaned[i], 10) * WEIGHTS[i];
  }
  const remainder = sum % 11;
  const expectedCheck = CHECK_MAP[remainder];

  if (cleaned[17] !== expectedCheck) {
    return { valid: false, error: `身份证号校验码不正确，期望 "${expectedCheck}"，实际 "${cleaned[17]}"` };
  }

  return { valid: true };
}

/**
 * 从身份证号提取出生日期 (YYYY-MM-DD)
 * 仅在号码格式正确时返回有效值
 */
export function extractBirthDate(idCard: string): string | null {
  const cleaned = (idCard || '').trim();
  if (cleaned.length !== 18 || !/^\d{17}[\dXx]$/.test(cleaned)) return null;
  const year = cleaned.slice(6, 10);
  const month = cleaned.slice(10, 12);
  const day = cleaned.slice(12, 14);
  return `${year}-${month}-${day}`;
}

/**
 * 从身份证号提取性别
 * 第17位：奇数为男，偶数为女
 */
export function extractGender(idCard: string): 'male' | 'female' | null {
  const cleaned = (idCard || '').trim();
  if (cleaned.length !== 18 || !/^\d{17}[\dXx]$/.test(cleaned)) return null;
  const genderDigit = parseInt(cleaned[16], 10);
  return genderDigit % 2 === 1 ? 'male' : 'female';
}
