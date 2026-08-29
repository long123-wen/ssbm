// ========================
// 核心数据类型定义
// ========================

export type Gender = 'male' | 'female' | 'mixed';
export type GroupType = 'gender' | 'age' | 'level' | 'team';
export type RegistrationStatus = 'draft' | 'open' | 'closed' | 'completed';
export type UserRole = 'admin' | 'organizer' | 'club';

// ---- 管理员账号 ----
export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  mustResetPassword?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- 赛事 ----
export interface Competition {
  id: string;
  name: string;
  subtitle?: string;
  venue: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  status: RegistrationStatus;
  description?: string;
  logoUrl?: string;
  maxIndividualEvents?: number;  // 每名运动员个人项目限报项数（未设置则不限）
  maxTeamEvents?: number;        // 每名运动员集体项目限报项数（未设置则不限）
  createdAt: string;
  updatedAt: string;
}

// ---- 项目 ----
export interface Event {
  id: string;
  competitionId: string;
  name: string;
  code: string;           // 项目编码，如 SR001
  category: string;       // 单绳/车轮/交互绳等
  description?: string;
  maxAthletes: number;    // 每队最多参赛人数
  isIndividual: boolean;  // 是否单人项目（true=必须严格匹配组别，false=可跨低年龄组）
  orderIndex: number;     // 出场序号
  createdAt: string;
}

// ---- 分组 ----
export interface EventGroup {
  id: string;
  eventId: string;
  name: string;           // 如 男子组 / 甲组 / 小学组
  type: GroupType;
  gender?: Gender;
  ageMin?: number;
  ageMax?: number;
  maxRegistrations?: number; // 每组限报数量（已废弃，限报统一由 limit_configs 管理；不传时数据库 DEFAULT 20）
  currentCount: number;     // 当前报名数
  orderIndex: number;
}

// ---- 俱乐部/学校账号 ----
export interface ClubAccount {
  id: string;
  username: string;
  clubName: string;
  contactName: string;
  phone: string;
  email?: string;
  province?: string;
  city?: string;
  createdAt: string;
  isApproved: boolean;
}

// ---- 领队 ----
export interface TeamLeader {
  id: string;
  clubId: string;
  competitionId?: string;  // 所属赛事
  teamProfileId?: string;  // 所属队伍（可选，用于多队伍数据隔离）
  clubName?: string;
  name: string;
  phone: string;
  position: string;   // 职位（必填）
}

// ---- 教练员 ----
export interface Coach {
  id: string;
  clubId: string;
  competitionId?: string;  // 所属赛事
  teamProfileId?: string;  // 所属队伍（可选，用于多队伍数据隔离）
  clubName?: string;
  name: string;
  phone: string;
}

// ---- 运动员 ----
export interface Athlete {
  id: string;
  clubId: string;
  competitionId?: string;  // 所属赛事（运动员首次创建时的赛事）
  teamProfileId?: string;  // 所属队伍（可选，用于多队伍数据隔离）
  clubName?: string;
  name: string;
  gender: Gender;
  birthDate: string;
  idCard: string;          // 身份证号（必填）
  avatarUrl?: string;      // 运动员照片URL或base64
}

// ---- 报名记录 ----
export interface Registration {
  id: string;
  competitionId: string;
  clubId: string;
  teamProfileId?: string;  // 所属队伍（可选，用于多队伍数据隔离）
  clubName: string;
  eventId: string;
  eventName: string;
  groupId: string;
  groupName: string;
  athletes: { athleteId: string; name: string }[];
  coachId?: string | null;
  coachName?: string;
  status: 'pending' | 'confirmed' | 'rejected';
  rejectReason?: string;   // 拒绝原因（管理员填写）
  startOrder?: number;     // 出场顺序
  bibNumber?: string;      // 号码布
  editUnlocked?: boolean;  // 管理员已允许该队伍修改报名清单
  editUnlockedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- 出场顺序条目 ----
export interface OrderEntry {
  id: string;
  competitionId: string;
  eventId: string;
  eventName: string;
  groupId: string;
  groupName: string;
  startOrder: number;              // 全局顺序号（兼容旧数据）
  sessionLabel: string;            // 场次号-场地号，如 "1-1", "2-3"
  sessionNumber: number;           // 场次号
  venueNumber: number;             // 场地号
  bibNumber: string;
  clubId: string;                  // 注册账号ID
  clubName: string;
  athletes: string[];
  coachName?: string;
}

// ---- 限报人数配置 ----
export interface LimitConfig {
  id: string;
  competitionId: string;      // 所属赛事
  /** 维度类型 */
  scope: 'team' | 'event' | 'group';
  /** 目标ID：team=teamProfileId, event=eventId, group=groupId */
  targetId: string;
  /** 最大报名人数上限（null 或 0 表示不限制） */
  maxRegistrations: number | null;
  /** 当前已报名人数（运行时计算） */
  currentCount?: number;
  createdAt: string;
  updatedAt: string;
}

// ---- 队伍资料（报名端 — 每俱乐部每赛事唯一） ----
export interface TeamProfile {
  id: string;
  clubId: string;
  competitionId: string;
  teamName: string;       // 队伍名称
  slogan?: string;         // 队伍口号
  logoUrl?: string;        // 队徽图片URL
  maxAthletes?: number;    // 队伍最大报名运动员人数（null 或 0 表示不限制）
  createdAt: string;
  updatedAt: string;
}

// ---- 统计数据 ----
export interface CompetitionStats {
  totalClubs: number;
  totalAthletes: number;
  totalRegistrations: number;
  eventBreakdown: { eventName: string; count: number }[];
}
