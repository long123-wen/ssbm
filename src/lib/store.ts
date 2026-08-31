// ========================
// Supabase 云端数据层
// ========================

import { supabase, TABLES, apiAuth, apiWorkflow } from '@/lib/supabase';
import { toast } from 'sonner';
import type {
  Competition, Event, EventGroup, ClubAccount,
  TeamLeader, Coach, Athlete, Registration, OrderEntry, AdminUser, TeamProfile, LimitConfig, UserRole, Gender, GroupType, RegistrationStatus,
} from '@/types';

// ========== 工具函数 ==========
const uid = () => crypto.randomUUID?.() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

// 简单内存缓存（SWR 风格，默认 TTL 30 秒）
const _cache = new Map<string, { data: any; ts: number }>();
function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return Promise.resolve(entry.data as T);
  return fetcher().then(data => { _cache.set(key, { data, ts: Date.now() }); return data; });
}
function invalidate(prefix: string) {
  for (const k of _cache.keys()) { if (k.startsWith(prefix)) _cache.delete(k); }
}
export function clearCache() { _cache.clear(); _clubNameCache = null; }
// ========== 共享俱乐部名称缓存（消除 N+1 查询） ==========
let _clubNameCache: { map: Map<string, string>; ts: number } | null = null;
const CLUB_NAME_CACHE_TTL = 60000; // 1 分钟
async function getClubNameMap(): Promise<Map<string, string>> {
  if (_clubNameCache && Date.now() - _clubNameCache.ts < CLUB_NAME_CACHE_TTL) return _clubNameCache.map;
  const { data: clubs } = await supabase.from(TABLES.clubs).select('id, club_name');
  const map = new Map<string, string>((clubs || []).map((c: Record<string, unknown>) => [c.id as string, c.club_name as string]));
  _clubNameCache = { map, ts: Date.now() };
  return map;
}
// ========== 密码哈希（客户端 SHA-256，生产环境请迁移至 Supabase Auth + bcrypt） ==========
async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ========== 赛事 ==========
export const competitionStore = {
  async getAll(): Promise<Competition[]> {
    return cached('comp:all', 30000, async () => {
      const { data } = await supabase.from(TABLES.competitions).select('*').order('created_at', { ascending: false });
      return (data || []).map(mapCompetition);
    });
  },
  async getById(id: string): Promise<Competition | null> {
    const { data } = await supabase.from(TABLES.competitions).select('*').eq('id', id).single();
    return data ? mapCompetition(data) : null;
  },
  async create(input: Omit<Competition, 'id' | 'createdAt' | 'updatedAt'>): Promise<Competition> {
    const { data, error } = await supabase.from(TABLES.competitions).insert({
      name: input.name, subtitle: input.subtitle, venue: input.venue,
      start_date: input.startDate, end_date: input.endDate,
      registration_deadline: input.registrationDeadline,
      status: input.status, description: input.description, logo_url: input.logoUrl,
      max_individual_events: input.maxIndividualEvents ?? null,
      max_team_events: input.maxTeamEvents ?? null,
    } as any).select().single();
    if (error) throw error;
    invalidate('comp:');
    return mapCompetition(data);
  },
  async update(id: string, input: Partial<Competition>): Promise<Competition | null> {
    const patch: Record<string, any> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.subtitle !== undefined) patch.subtitle = input.subtitle;
    if (input.venue !== undefined) patch.venue = input.venue;
    if (input.startDate !== undefined) patch.start_date = input.startDate;
    if (input.endDate !== undefined) patch.end_date = input.endDate;
    if (input.registrationDeadline !== undefined) patch.registration_deadline = input.registrationDeadline;
    if (input.status !== undefined) patch.status = input.status;
    if (input.description !== undefined) patch.description = input.description;
    if (input.logoUrl !== undefined) patch.logo_url = input.logoUrl;
    if (input.maxIndividualEvents !== undefined) patch.max_individual_events = input.maxIndividualEvents;
    if (input.maxTeamEvents !== undefined) patch.max_team_events = input.maxTeamEvents;
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from(TABLES.competitions).update(patch).eq('id', id).select().single();
    if (error) throw error;
    invalidate('comp:');
    return data ? mapCompetition(data) : null;
  },
  async delete(id: string): Promise<void> {
    await supabase.from(TABLES.competitions).delete().eq('id', id);
    invalidate('comp:');
  },
};

// ========== 项目 ==========
export const eventStore = {
  async getAll(): Promise<Event[]> {
    return cached(`event:all`, 30000, async () => {
      const { data } = await supabase.from(TABLES.events).select('*').order('order_index');
      return (data || []).map(mapEvent);
    });
  },
  async getByCompetition(cid: string): Promise<Event[]> {
    return cached(`event:comp:${cid}`, 30000, async () => {
      const { data } = await supabase.from(TABLES.events).select('*').eq('competition_id', cid).order('order_index');
      return (data || []).map(mapEvent);
    });
  },
  async getById(id: string): Promise<Event | null> {
    const { data } = await supabase.from(TABLES.events).select('*').eq('id', id).single();
    return data ? mapEvent(data) : null;
  },
  async create(input: Omit<Event, 'id' | 'createdAt'>): Promise<Event> {
    const { data, error } = await supabase.from(TABLES.events).insert({
      competition_id: input.competitionId, name: input.name, code: input.code,
      category: input.category, description: input.description,
      max_athletes: input.maxAthletes, is_individual: input.isIndividual ?? true,
      order_index: input.orderIndex,
    }).select().single();
    if (error) throw error;
    invalidate('event:');
    return mapEvent(data);
  },
  async update(id: string, input: Partial<Event>): Promise<Event | null> {
    const patch: Record<string, any> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.code !== undefined) patch.code = input.code;
    if (input.category !== undefined) patch.category = input.category;
    if (input.description !== undefined) patch.description = input.description;
    if (input.maxAthletes !== undefined) patch.max_athletes = input.maxAthletes;
    if (input.isIndividual !== undefined) patch.is_individual = input.isIndividual;
    if (input.orderIndex !== undefined) patch.order_index = input.orderIndex;

    const { data, error } = await supabase.from(TABLES.events).update(patch).eq('id', id).select().single();
    if (error) throw error;
    invalidate('event:');
    return data ? mapEvent(data) : null;
  },
  async delete(id: string): Promise<void> {
    await supabase.from(TABLES.events).delete().eq('id', id);
    invalidate('event:');
  },
};

// ========== 分组 ==========
export const groupStore = {
  async getByEvent(eid: string): Promise<EventGroup[]> {
    return cached(`group:event:${eid}`, 30000, async () => {
      const { data } = await supabase.from(TABLES.event_groups).select('*').eq('event_id', eid).order('order_index');
      return (data || []).map(mapGroup);
    });
  },
  async getById(id: string): Promise<EventGroup | null> {
    const { data } = await supabase.from(TABLES.event_groups).select('*').eq('id', id).single();
    return data ? mapGroup(data) : null;
  },
  async create(input: Omit<EventGroup, 'id'>): Promise<EventGroup> {
    const { data, error } = await supabase.from(TABLES.event_groups).insert({
      event_id: input.eventId, name: input.name, type: input.type, gender: input.gender,
      age_min: input.ageMin, age_max: input.ageMax,
      max_registrations: input.maxRegistrations, current_count: input.currentCount,
      order_index: input.orderIndex,
    }).select().single();
    if (error) throw error;
    invalidate('group:');
    return mapGroup(data);
  },
  async update(id: string, input: Partial<EventGroup>): Promise<EventGroup | null> {
    const patch: Record<string, any> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.type !== undefined) patch.type = input.type;
    if (input.gender !== undefined) patch.gender = input.gender;
    if (input.ageMin !== undefined) patch.age_min = input.ageMin;
    if (input.ageMax !== undefined) patch.age_max = input.ageMax;
    if (input.maxRegistrations !== undefined) patch.max_registrations = input.maxRegistrations;
    if (input.currentCount !== undefined) patch.current_count = input.currentCount;
    if (input.orderIndex !== undefined) patch.order_index = input.orderIndex;

    const { data, error } = await supabase.from(TABLES.event_groups).update(patch).eq('id', id).select().single();
    if (error) throw error;
    invalidate('group:');
    return data ? mapGroup(data) : null;
  },
  async delete(id: string): Promise<void> {
    await supabase.from(TABLES.event_groups).delete().eq('id', id);
    invalidate('group:');
  },
  // 使用数据库 RPC 原子操作，避免并发报名时计数竞态
  async incrementCount(id: string): Promise<void> {
    const { error } = await supabase.rpc('increment_group_count', { group_id: id });
    if (error) {
      // ⚠️ 非原子回退：RPC 未部署。请执行 db/migration.sql 创建 increment_group_count 函数
      console.warn('[store] RPC increment_group_count unavailable, falling back to read-modify-write (non-atomic).');
      const group = await this.getById(id);
      if (group) {
        await supabase.from(TABLES.event_groups).update({ current_count: group.currentCount + 1 }).eq('id', id);
      }
    }
  },
  async decrementCount(id: string): Promise<void> {
    const { error } = await supabase.rpc('decrement_group_count', { group_id: id });
    if (error) {
      console.warn('[store] RPC decrement_group_count unavailable, falling back to read-modify-write (non-atomic).');
      const group = await this.getById(id);
      if (group && group.currentCount > 0) {
        await supabase.from(TABLES.event_groups).update({ current_count: group.currentCount - 1 }).eq('id', id);
      }
    }
  },
};

// ========== 俱乐部账号 ==========
const CLUB_PUBLIC_COLUMNS = 'id, username, club_name, contact_name, phone, email, province, city, created_at, is_approved';

export const clubStore = {
  async getAll(): Promise<ClubAccount[]> {
    const { data } = await supabase.from(TABLES.clubs).select(CLUB_PUBLIC_COLUMNS).order('created_at', { ascending: false });
    return (data || []).map(mapClub);
  },
  async getById(id: string): Promise<ClubAccount | null> {
    const { data } = await supabase.from(TABLES.clubs).select(CLUB_PUBLIC_COLUMNS).eq('id', id).single();
    return data ? mapClub(data) : null;
  },
  async getByUsername(username: string): Promise<ClubAccount | null> {
    const { data } = await supabase.from(TABLES.clubs).select(CLUB_PUBLIC_COLUMNS).eq('username', username).single();
    return data ? mapClub(data) : null;
  },
  async login(username: string, password: string): Promise<ClubAccount | null> {
    const { data, error } = await apiAuth.clubLogin(username, password);
    if (error) {
      if (error.status === 401 || error.status === 403 || error.status === 404) return null;
      throw error;
    }
    if (!data) return null;
    const row = ((data as Record<string, unknown>).club || (data as Record<string, unknown>).user || data) as Record<string, unknown>;
    return mapClub(row);
  },
  async create(input: Omit<ClubAccount, 'id' | 'createdAt' | 'isApproved'> & { password: string }): Promise<ClubAccount> {
    // 检查用户名是否已存在
    const exist = await this.getByUsername(input.username);
    if (exist) throw new Error('用户名已存在');

    const { data, error } = await supabase.from(TABLES.clubs).insert({
      username: input.username,
      password_hash: await hashPassword(input.password),
      club_name: input.clubName,
      contact_name: input.contactName,
      phone: input.phone, email: input.email,
      province: input.province, city: input.city,
      is_approved: true,
    } as any).select(CLUB_PUBLIC_COLUMNS).single();
    if (error) throw error;
    // 注册成功后立即建立 HttpOnly 服务端会话，避免仅依赖本地存储身份。
    const { data: loginData, error: loginError } = await apiAuth.clubLogin(input.username, input.password);
    if (loginError || !loginData) throw loginError || new Error('账号已创建，但自动登录失败，请返回登录页重新登录');
    const row = ((loginData as Record<string, unknown>).club || (loginData as Record<string, unknown>).user || loginData) as Record<string, unknown>;
    return mapClub(row);
  },
  async update(id: string, input: Partial<ClubAccount>): Promise<ClubAccount | null> {
    const patch: Record<string, any> = {};
    if (input.clubName !== undefined) patch.club_name = input.clubName;
    if (input.contactName !== undefined) patch.contact_name = input.contactName;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.email !== undefined) patch.email = input.email;
    if (input.province !== undefined) patch.province = input.province;
    if (input.city !== undefined) patch.city = input.city;

    const { data, error } = await supabase.from(TABLES.clubs).update(patch).eq('id', id).select(CLUB_PUBLIC_COLUMNS).single();
    if (error) throw error;
    return data ? mapClub(data) : null;
  },
  setCurrent(club: ClubAccount | null): void {
    if (club) localStorage.setItem('rj_current_club', JSON.stringify(club));
    else {
      localStorage.removeItem('rj_current_club');
      apiAuth.logoutKeepalive();
    }
  },
  getCurrent(): ClubAccount | null {
    try { return JSON.parse(localStorage.getItem('rj_current_club') || 'null'); } catch { return null; }
  },
  async restoreSession(): Promise<ClubAccount | null> {
    const { data, error } = await apiAuth.session();
    if (error || !data || (data as Record<string, unknown>).role !== 'club') {
      localStorage.removeItem('rj_current_club');
      return null;
    }
    const user = (data as Record<string, unknown>).user;
    if (!user || typeof user !== 'object') return null;
    const club = mapClub(user as Record<string, unknown>);
    localStorage.setItem('rj_current_club', JSON.stringify(club));
    return club;
  },
  /** 注销账号（删除账号本身 + 级联删除所有关联数据） */
  async delete(id: string): Promise<{ deleted: Record<string, number>; errors: string[] }> {
    const deleted: Record<string, number> = {};
    const errors: string[] = [];
    const steps: [string, { then(onfulfilled: (v: any) => any): any }][] = [
      ['team_leaders', supabase.from(TABLES.team_leaders).delete().eq('club_id', id).then(r => ({ error: r.error, count: r.count }))],
      ['coaches', supabase.from(TABLES.coaches).delete().eq('club_id', id).then(r => ({ error: r.error, count: r.count }))],
      ['athletes', supabase.from(TABLES.athletes).delete().eq('club_id', id).then(r => ({ error: r.error, count: r.count }))],
      ['registrations', supabase.from(TABLES.registrations).delete().eq('club_id', id).then(r => ({ error: r.error, count: r.count }))],
      ['team_profiles', supabase.from(TABLES.team_profiles).delete().eq('club_id', id).then(r => ({ error: r.error, count: r.count }))],
    ];
    for (const [name, queryPromise] of steps) {
      const { error, count } = await queryPromise;
      if (error) {
        console.warn(`[clubStore.delete] 删除 ${name} 失败:`, error.message);
        errors.push(`${name}: ${error.message}`);
      } else {
        deleted[name] = count ?? 0;
      }
    }
    // 删除账号本身
    const { error } = await supabase.from(TABLES.clubs).delete().eq('id', id);
    if (error) { errors.push(`clubs: ${error.message}`); throw new Error(errors.join('; ')); }
    return { deleted, errors };
  },

  /**
   * 清理孤儿数据：删除 club_id 在 clubs 表中不存在的记录
   * 当 RLS 阻止级联删除后，可用此方法清理残留数据
   */
  async cleanupOrphanedData(): Promise<{ cleaned: Record<string, number>; errors: string[] }> {
    // 获取所有有效的 club ID
    const { data: allClubs } = await supabase.from(TABLES.clubs).select('id');
    const validClubIds = new Set((allClubs || []).map((c: Record<string, unknown>) => c.id as string));
    const cleaned: Record<string, number> = {};
    const errors: string[] = [];

    const tables = [
      TABLES.team_profiles,
      TABLES.team_leaders,
      TABLES.coaches,
      TABLES.athletes,
      TABLES.registrations,
    ];

    for (const table of tables) {
      // 先查出孤儿记录
      const { data: orphans, error: fetchError } = await supabase.from(table).select('id');
      if (fetchError) { errors.push(`${table} 查询失败: ${fetchError.message}`); continue; }

      // 由于无法用 NOT IN 子查询（RLS限制），需要逐条检查 club_id
      const { data: orphanRows, error: listError } = await supabase.from(table).select('id, club_id');
      if (listError) { errors.push(`${table} 列表查询失败: ${listError.message}`); continue; }

      const orphanIds = (orphanRows || [])
        .filter((r: Record<string, unknown>) => r.club_id && !validClubIds.has(r.club_id as string))
        .map((r: Record<string, unknown>) => r.id as string);

      if (orphanIds.length === 0) { cleaned[table] = 0; continue; }

      // 分批删除（每批100条）
      for (let i = 0; i < orphanIds.length; i += 100) {
        const batch = orphanIds.slice(i, i + 100);
        const { error: delError } = await supabase.from(table).delete().in('id', batch);
        if (delError) {
          errors.push(`${table} 删除失败(${batch.length}条): ${delError.message}`);
          // 尝试逐条删除
          for (const bid of batch) {
            const { error: singleErr } = await supabase.from(table).delete().eq('id', bid);
            if (singleErr) errors.push(`${table} 单条删除 ${bid} 失败: ${singleErr.message}`);
            else cleaned[table] = (cleaned[table] || 0) + 1;
          }
        } else {
          cleaned[table] = (cleaned[table] || 0) + batch.length;
        }
      }
    }
    return { cleaned, errors };
  },
};

// ========== 领队 ==========
export const leaderStore = {
  async getAll(): Promise<TeamLeader[]> {
    const { data: leaders } = await supabase.from(TABLES.team_leaders).select('*').order('name');
    const clubMap = await getClubNameMap();
    return (leaders || []).map((row: Record<string, unknown>) => mapLeaderWithClub(row, clubMap));
  },
  async getByClub(clubId: string): Promise<TeamLeader[]> {
    const { data } = await supabase.from(TABLES.team_leaders).select('*').eq('club_id', clubId);
    return (data || []).map(mapLeader);
  },
  /** 按赛事查询领队（数据隔离核心方法） */
  async getByCompetition(cid: string): Promise<TeamLeader[]> {
    const { data: leaders, error } = await supabase.from(TABLES.team_leaders).select('*').eq('competition_id', cid).order('name');
    if (error && error.message?.includes('competition_id')) return [];
    if (error) throw error;
    const clubMap = await getClubNameMap();
    return (leaders || []).map((row: Record<string, unknown>) => mapLeaderWithClub(row, clubMap));
  },
  /** 按赛事+俱乐部查询（俱乐部端专用） */
  async getByCompetitionAndClub(cid: string, clubId: string): Promise<TeamLeader[]> {
    const { data: leaders, error } = await supabase.from(TABLES.team_leaders)
      .select('*').eq('competition_id', cid).eq('club_id', clubId).order('name');
    if (error && error.message?.includes('competition_id')) return [];
    if (error) throw error;
    return (leaders || []).map(mapLeader);
  },
  /** 按赛事+俱乐部+队伍查询（多队伍数据隔离专用） */
  async getByCompetitionClubAndTeam(cid: string, clubId: string, teamProfileId: string): Promise<TeamLeader[]> {
    const { data: leaders, error } = await supabase.from(TABLES.team_leaders)
      .select('*').eq('competition_id', cid).eq('club_id', clubId).eq('team_profile_id', teamProfileId).order('name');
    if (error && (error.message?.includes('team_profile_id') || error.message?.includes('competition_id'))) {
      // 列不存在时返回空数组（不回退到未隔离查询，避免数据泄露）
      console.warn('[leaderStore] team_profile_id 列不存在，请执行数据库迁移：db/migration-team-profile-id.sql');
      return [];
    }
    if (error) throw error;
    return (leaders || []).map(mapLeader);
  },
  async create(input: Omit<TeamLeader, 'id'>): Promise<TeamLeader> {
    const insertRow: Record<string, any> = {
      club_id: input.clubId, name: input.name, phone: input.phone, position: input.position,
    };
    if (input.competitionId) insertRow.competition_id = input.competitionId;
    if (input.teamProfileId) insertRow.team_profile_id = input.teamProfileId;
    const { data, error } = await supabase.from(TABLES.team_leaders).insert(insertRow).select().single();
    if (error) {
      const removeCompetition = error.message?.includes('competition_id') && insertRow.competition_id;
      const removeTeamProfile = error.message?.includes('team_profile_id') && insertRow.team_profile_id;
      if (removeCompetition || removeTeamProfile) {
        if (removeCompetition) delete insertRow.competition_id;
        if (removeTeamProfile) { delete insertRow.team_profile_id; console.warn('[store] team_profile_id 列不存在，记录将在无队伍标识下创建。请执行 Supabase 数据库迁移：db/migration-team-profile-id.sql'); }
        const { data: d2, error: e2 } = await supabase.from(TABLES.team_leaders).insert(insertRow).select().single();
        if (e2) throw e2;
        return mapLeader(d2);
      }
      throw error;
    }
    return mapLeader(data);
  },
  // 批量创建领队
  async batchCreate(inputs: Omit<TeamLeader, 'id'>[]): Promise<TeamLeader[]> {
    if (inputs.length === 0) return [];
    const buildRows = (includeCompId: boolean, includeTeamProfileId: boolean) => inputs.map(input => {
      const row: Record<string, any> = {
        club_id: input.clubId, name: input.name, phone: input.phone, position: input.position,
      };
      if (includeCompId && input.competitionId) row.competition_id = input.competitionId;
      if (includeTeamProfileId && input.teamProfileId) row.team_profile_id = input.teamProfileId;
      return row;
    });
    const { data, error } = await supabase.from(TABLES.team_leaders).insert(buildRows(true, true)).select();
    if (error) {
      const removeCompetition = error.message?.includes('competition_id');
      const removeTeamProfile = error.message?.includes('team_profile_id');
      if (removeCompetition || removeTeamProfile) {
        const { data: d2, error: e2 } = await supabase.from(TABLES.team_leaders)
          .insert(buildRows(!removeCompetition, !removeTeamProfile)).select();
        if (e2) throw e2;
        return (d2 || []).map((row: Record<string, unknown>) => mapLeader(row));
      }
      throw error;
    }
    return (data || []).map((row: Record<string, unknown>) => mapLeader(row));
  },
  async update(id: string, input: Partial<TeamLeader>): Promise<TeamLeader | null> {
    const patch: Record<string, any> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.position !== undefined) patch.position = input.position;

    const { data } = await supabase.from(TABLES.team_leaders).update(patch).eq('id', id).select().single();
    return data ? mapLeader(data) : null;
  },
  async delete(id: string): Promise<void> {
    await supabase.from(TABLES.team_leaders).delete().eq('id', id);
  },
};

// ========== 教练 ==========
export const coachStore = {
  async getAll(): Promise<Coach[]> {
    const { data: coaches } = await supabase.from(TABLES.coaches).select('*').order('name');
    const clubMap = await getClubNameMap();
    return (coaches || []).map((row: Record<string, unknown>) => mapCoachWithClub(row, clubMap));
  },
  async getByClub(clubId: string): Promise<Coach[]> {
    const { data } = await supabase.from(TABLES.coaches).select('*').eq('club_id', clubId);
    return (data || []).map(mapCoach);
  },
  /** 按俱乐部+队伍查询（多队伍数据隔离专用） */
  async getByClubAndTeam(clubId: string, teamProfileId: string): Promise<Coach[]> {
    const { data, error } = await supabase.from(TABLES.coaches)
      .select('*').eq('club_id', clubId).eq('team_profile_id', teamProfileId).order('name');
    if (error && error.message?.includes('team_profile_id')) {
      console.warn('[coachStore] team_profile_id 列不存在，请执行数据库迁移：db/migration-team-profile-id.sql');
      return [];
    }
    if (error) throw error;
    return (data || []).map(mapCoach);
  },
  /** 按赛事查询教练（数据隔离核心方法） */
  async getByCompetition(cid: string): Promise<Coach[]> {
    const { data: coaches, error } = await supabase.from(TABLES.coaches).select('*').eq('competition_id', cid).order('name');
    if (error && error.message?.includes('competition_id')) return [];
    if (error) throw error;
    const clubMap = await getClubNameMap();
    return (coaches || []).map((row: Record<string, unknown>) => mapCoachWithClub(row, clubMap));
  },
  /** 按赛事+俱乐部查询（俱乐部端专用） */
  async getByCompetitionAndClub(cid: string, clubId: string): Promise<Coach[]> {
    const { data: coaches, error } = await supabase.from(TABLES.coaches)
      .select('*').eq('competition_id', cid).eq('club_id', clubId).order('name');
    if (error && error.message?.includes('competition_id')) return [];
    if (error) throw error;
    return (coaches || []).map(mapCoach);
  },
  /** 按赛事+俱乐部+队伍查询（多队伍数据隔离专用） */
  async getByCompetitionClubAndTeam(cid: string, clubId: string, teamProfileId: string): Promise<Coach[]> {
    const { data: coaches, error } = await supabase.from(TABLES.coaches)
      .select('*').eq('competition_id', cid).eq('club_id', clubId).eq('team_profile_id', teamProfileId).order('name');
    if (error && (error.message?.includes('team_profile_id') || error.message?.includes('competition_id'))) {
      console.warn('[coachStore] team_profile_id 列不存在，请执行数据库迁移：db/migration-team-profile-id.sql');
      return [];
    }
    if (error) throw error;
    return (coaches || []).map(mapCoach);
  },
  async create(input: Omit<Coach, 'id'>): Promise<Coach> {
    const insertRow: Record<string, any> = {
      club_id: input.clubId, name: input.name, phone: input.phone,
    };
    if (input.competitionId) insertRow.competition_id = input.competitionId;
    if (input.teamProfileId) insertRow.team_profile_id = input.teamProfileId;
    const { data, error } = await supabase.from(TABLES.coaches).insert(insertRow).select().single();
    if (error) {
      const removeCompetition = error.message?.includes('competition_id') && insertRow.competition_id;
      const removeTeamProfile = error.message?.includes('team_profile_id') && insertRow.team_profile_id;
      if (removeCompetition || removeTeamProfile) {
        if (removeCompetition) delete insertRow.competition_id;
        if (removeTeamProfile) { delete insertRow.team_profile_id; console.warn('[store] team_profile_id 列不存在，记录将在无队伍标识下创建。请执行 Supabase 数据库迁移：db/migration-team-profile-id.sql'); }
        const { data: d2, error: e2 } = await supabase.from(TABLES.coaches).insert(insertRow).select().single();
        if (e2) throw e2;
        return mapCoach(d2);
      }
      throw error;
    }
    return mapCoach(data);
  },
  // 批量创建教练员
  async batchCreate(inputs: Omit<Coach, 'id'>[]): Promise<Coach[]> {
    if (inputs.length === 0) return [];
    const buildRows = (includeCompId: boolean, includeTeamProfileId: boolean) => inputs.map(input => {
      const row: Record<string, any> = {
        club_id: input.clubId, name: input.name, phone: input.phone,
      };
      if (includeCompId && input.competitionId) row.competition_id = input.competitionId;
      if (includeTeamProfileId && input.teamProfileId) row.team_profile_id = input.teamProfileId;
      return row;
    });
    const { data, error } = await supabase.from(TABLES.coaches).insert(buildRows(true, true)).select();
    if (error) {
      const removeCompetition = error.message?.includes('competition_id');
      const removeTeamProfile = error.message?.includes('team_profile_id');
      if (removeCompetition || removeTeamProfile) {
        const { data: d2, error: e2 } = await supabase.from(TABLES.coaches)
          .insert(buildRows(!removeCompetition, !removeTeamProfile)).select();
        if (e2) throw e2;
        return (d2 || []).map((row: Record<string, unknown>) => mapCoach(row));
      }
      throw error;
    }
    return (data || []).map((row: Record<string, unknown>) => mapCoach(row));
  },
  async update(id: string, input: Partial<Coach>): Promise<Coach | null> {
    const patch: Record<string, any> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.phone !== undefined) patch.phone = input.phone;

    const { data } = await supabase.from(TABLES.coaches).update(patch).eq('id', id).select().single();
    return data ? mapCoach(data) : null;
  },
  async delete(id: string): Promise<void> {
    await supabase.from(TABLES.coaches).delete().eq('id', id);
  },
};

// ========== 运动员 ==========
export const athleteStore = {
  async getAll(): Promise<Athlete[]> {
    const { data: athletes } = await supabase.from(TABLES.athletes).select('*').order('name');
    const clubMap = await getClubNameMap();
    return (athletes || []).map((row: Record<string, unknown>) => mapAthleteWithClub(row, clubMap));
  },
  async getByClub(clubId: string): Promise<Athlete[]> {
    const { data } = await supabase.from(TABLES.athletes).select('*').eq('club_id', clubId);
    return (data || []).map(mapAthlete);
  },
  /** 按俱乐部+队伍查询（多队伍数据隔离专用） */
  async getByClubAndTeam(clubId: string, teamProfileId: string): Promise<Athlete[]> {
    const { data, error } = await supabase.from(TABLES.athletes)
      .select('*').eq('club_id', clubId).eq('team_profile_id', teamProfileId).order('name');
    if (error && error.message?.includes('team_profile_id')) {
      console.warn('[athleteStore] team_profile_id 列不存在，请执行数据库迁移：db/migration-team-profile-id.sql');
      return [];
    }
    if (error) throw error;
    return (data || []).map(mapAthlete);
  },
  async getByCompetition(cid: string): Promise<Athlete[]> {
    const { data: athletes, error } = await supabase.from(TABLES.athletes).select('*').eq('competition_id', cid).order('name');
    // 如果 competition_id 列还不存在，返回空数组
    if (error && error.message?.includes('competition_id')) return [];
    if (error) throw error;
    const clubMap = await getClubNameMap();
    return (athletes || []).map((row: Record<string, unknown>) => mapAthleteWithClub(row, clubMap));
  },
  /** 按赛事+俱乐部查询（俱乐部端专用） */
  async getByCompetitionAndClub(cid: string, clubId: string): Promise<Athlete[]> {
    const { data: athletes, error } = await supabase.from(TABLES.athletes)
      .select('*').eq('competition_id', cid).eq('club_id', clubId).order('name');
    if (error && error.message?.includes('competition_id')) return [];
    if (error) throw error;
    return (athletes || []).map(mapAthlete);
  },
  /** 按赛事+俱乐部+队伍查询（多队伍数据隔离专用） */
  async getByCompetitionClubAndTeam(cid: string, clubId: string, teamProfileId: string): Promise<Athlete[]> {
    const { data: athletes, error } = await supabase.from(TABLES.athletes)
      .select('*').eq('competition_id', cid).eq('club_id', clubId).eq('team_profile_id', teamProfileId).order('name');
    if (error && (error.message?.includes('team_profile_id') || error.message?.includes('competition_id'))) {
      console.warn('[athleteStore] team_profile_id 列不存在，请执行数据库迁移：db/migration-team-profile-id.sql');
      return [];
    }
    if (error) throw error;
    return (athletes || []).map(mapAthlete);
  },
  async create(input: Omit<Athlete, 'id'>): Promise<Athlete> {
    const insertRow: Record<string, any> = {
      club_id: input.clubId, name: input.name, gender: input.gender,
      birth_date: input.birthDate, id_card: input.idCard,
      avatar_url: input.avatarUrl || null,
    };
    // competition_id 列可能尚未创建（需在 Supabase SQL Editor 执行迁移）
    if (input.competitionId) insertRow.competition_id = input.competitionId;
    if (input.teamProfileId) insertRow.team_profile_id = input.teamProfileId;

    const { data, error } = await supabase.from(TABLES.athletes).insert(insertRow).select().single();
    if (error) {
      // 如果 competition_id 或 team_profile_id 列不存在，尝试不带它们插入
      const removeCompetition = error.message?.includes('competition_id') && insertRow.competition_id;
      const removeTeamProfile = error.message?.includes('team_profile_id') && insertRow.team_profile_id;
      if (removeCompetition || removeTeamProfile) {
        if (removeCompetition) delete insertRow.competition_id;
        if (removeTeamProfile) { delete insertRow.team_profile_id; console.warn('[store] team_profile_id 列不存在，记录将在无队伍标识下创建。请执行 Supabase 数据库迁移：db/migration-team-profile-id.sql'); }
        const { data: d2, error: e2 } = await supabase.from(TABLES.athletes).insert(insertRow).select().single();
        if (e2) throw e2;
        return mapAthlete(d2);
      }
      throw error;
    }
    return mapAthlete(data);
  },
  // 批量创建运动员
  async batchCreate(inputs: Omit<Athlete, 'id'>[]): Promise<Athlete[]> {
    if (inputs.length === 0) return [];

    const buildRows = (includeCompId: boolean, includeTeamProfileId: boolean) => inputs.map(input => {
      const row: Record<string, any> = {
        club_id: input.clubId, name: input.name, gender: input.gender,
        birth_date: input.birthDate, id_card: input.idCard,
        avatar_url: input.avatarUrl || null,
      };
      if (includeCompId && input.competitionId) row.competition_id = input.competitionId;
      if (includeTeamProfileId && input.teamProfileId) row.team_profile_id = input.teamProfileId;
      return row;
    });

    const { data, error } = await supabase.from(TABLES.athletes).insert(buildRows(true, true)).select();
    if (error) {
      const removeCompetition = error.message?.includes('competition_id');
      const removeTeamProfile = error.message?.includes('team_profile_id');
      if (removeCompetition || removeTeamProfile) {
        const { data: d2, error: e2 } = await supabase.from(TABLES.athletes)
          .insert(buildRows(!removeCompetition, !removeTeamProfile)).select();
        if (e2) throw e2;
        return (d2 || []).map((row: Record<string, unknown>) => mapAthlete(row));
      }
      throw error;
    }
    return (data || []).map((row: Record<string, unknown>) => mapAthlete(row));
  },
  async update(id: string, input: Partial<Athlete>): Promise<Athlete | null> {
    const patch: Record<string, any> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.gender !== undefined) patch.gender = input.gender;
    if (input.birthDate !== undefined) patch.birth_date = input.birthDate;
    if (input.idCard !== undefined) patch.id_card = input.idCard;
    if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;

    const { data } = await supabase.from(TABLES.athletes).update(patch).eq('id', id).select().single();
    return data ? mapAthlete(data) : null;
  },
  async delete(id: string): Promise<void> {
    await supabase.from(TABLES.athletes).delete().eq('id', id);
  },
  /** 按ID列表批量查询运动员（用于验证等场景） */
  async getByIds(ids: string[]): Promise<Athlete[]> {
    if (ids.length === 0) return [];
    const { data } = await supabase.from(TABLES.athletes).select('*').in('id', ids);
    return (data || []).map(mapAthlete);
  },
};

// ========== 报名 ==========
export const registrationStore = {
  async getAll(): Promise<Registration[]> {
    const { data } = await supabase.from(TABLES.registrations).select('*').order('created_at', { ascending: false });
    return (data || []).map(mapRegistration);
  },
  async getByClub(clubId: string): Promise<Registration[]> {
    const { data } = await supabase.from(TABLES.registrations).select('*').eq('club_id', clubId).order('created_at', { ascending: false });
    return (data || []).map(mapRegistration);
  },
  /** 按俱乐部+队伍查询（多队伍数据隔离专用） */
  async getByClubAndTeam(clubId: string, teamProfileId: string): Promise<Registration[]> {
    const { data, error } = await supabase.from(TABLES.registrations)
      .select('*').eq('club_id', clubId).eq('team_profile_id', teamProfileId).order('created_at', { ascending: false });
    if (error && error.message?.includes('team_profile_id')) {
      console.warn('[registrationStore] team_profile_id 列不存在，请执行数据库迁移：db/migration-team-profile-id.sql');
      return [];
    }
    if (error) throw error;
    return (data || []).map(mapRegistration);
  },
  async getByCompetition(cid: string): Promise<Registration[]> {
    const { data } = await supabase.from(TABLES.registrations).select('*').eq('competition_id', cid);
    return (data || []).map(mapRegistration);
  },
  async getAdminPage(input: { competitionId: string; page?: number; pageSize?: number; status?: Registration['status']; eventId?: string; groupId?: string; clubId?: string }): Promise<{ items: Registration[]; page: number; pageSize: number; total: number }> {
    const params = new URLSearchParams({
      competitionId: input.competitionId,
      page: String(input.page || 1),
      pageSize: String(input.pageSize || 50),
    });
    if (input.status) params.set('status', input.status);
    if (input.eventId) params.set('eventId', input.eventId);
    if (input.groupId) params.set('groupId', input.groupId);
    if (input.clubId) params.set('clubId', input.clubId);
    const { data, error } = await apiWorkflow<{ items?: Record<string, unknown>[]; page?: number; pageSize?: number; total?: number }>(`/admin/registrations?${params}`);
    if (error) throw error;
    return {
      items: (data?.items || []).map(mapRegistration),
      page: data?.page || input.page || 1,
      pageSize: data?.pageSize || input.pageSize || 50,
      total: data?.total || 0,
    };
  },
  async getByEvent(eid: string): Promise<Registration[]> {
    const { data } = await supabase.from(TABLES.registrations).select('*').eq('event_id', eid);
    return (data || []).map(mapRegistration);
  },
  async getByGroup(gid: string): Promise<Registration[]> {
    const { data } = await supabase.from(TABLES.registrations).select('*').eq('group_id', gid);
    return (data || []).map(mapRegistration);
  },
  /** 按赛事+俱乐部+队伍查询（多队伍数据隔离专用） */
  async getByCompetitionClubAndTeam(cid: string, clubId: string, teamProfileId: string): Promise<Registration[]> {
    const { data, error } = await supabase.from(TABLES.registrations)
      .select('*').eq('competition_id', cid).eq('club_id', clubId).eq('team_profile_id', teamProfileId).order('created_at', { ascending: false });
    if (error && error.message?.includes('team_profile_id')) {
      console.warn('[registrationStore] team_profile_id 列不存在，请执行数据库迁移：db/migration-team-profile-id.sql');
      return [];
    }
    if (error) throw error;
    return (data || []).map(mapRegistration);
  },
  async getEditState(competitionId: string, teamProfileId?: string): Promise<{ unlocked: boolean; unlockedAt?: string }> {
    const params = new URLSearchParams({ competitionId });
    if (teamProfileId) params.set('teamProfileId', teamProfileId);
    const { data, error } = await apiWorkflow<{ unlocked?: boolean; unlockedAt?: string | null }>(`/club/registrations/edit-state?${params}`);
    if (error) throw error;
    return { unlocked: Boolean(data?.unlocked), unlockedAt: data?.unlockedAt || undefined };
  },
  async replaceForUnlockedCompetition(input: { competitionId: string; teamProfileId?: string; registrations: Array<{ competitionId?: string; eventId: string; groupId: string; athleteIds: string[] }> }): Promise<{ replaced: number; deleted: number; status: Registration['status'] }> {
    const { data, error } = await apiWorkflow<{ replaced: number; deleted: number; status: Registration['status'] }>('/club/registrations/replace', input);
    if (error || !data) throw error || new Error('修改后的报名清单未返回结果');
    invalidate('group:');
    return data;
  },
  async unlockForAdmin(input: { competitionId: string; clubId: string; teamProfileId?: string }): Promise<void> {
    const { error } = await apiWorkflow('/admin/registrations/unlock', input);
    if (error) throw error;
  },
  async create(input: Omit<Registration, 'id' | 'createdAt' | 'updatedAt'>): Promise<Registration> {
    const { data, error } = await apiWorkflow<{ id: string; status: Registration['status'] }>('/club/registrations', {
      competitionId: input.competitionId,
      eventId: input.eventId,
      groupId: input.groupId,
      athleteIds: input.athletes.map(athlete => athlete.athleteId),
      ...(input.coachId ? { coachId: input.coachId } : {}),
      ...(input.teamProfileId ? { teamProfileId: input.teamProfileId } : {}),
    });
    if (error || !data) throw error || new Error('报名创建未返回结果');
    invalidate('group:');
    return {
      id: data.id, competitionId: input.competitionId, clubId: input.clubId, clubName: input.clubName,
      teamProfileId: input.teamProfileId, eventId: input.eventId, eventName: input.eventName,
      groupId: input.groupId, groupName: input.groupName, athletes: input.athletes,
      coachId: input.coachId, coachName: input.coachName, status: data.status,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  },
  async update(id: string, input: Partial<Registration>): Promise<Registration | null> {
    const athleteIds = input.athletes?.map(athlete => athlete.athleteId);
    if (input.status !== undefined || input.rejectReason !== undefined || input.startOrder !== undefined || input.bibNumber !== undefined || input.groupId !== undefined || input.groupName !== undefined || input.coachName !== undefined) {
      throw new Error('报名状态、分组、秩序号和显示名称仅能由受保护工作流维护');
    }
    if (athleteIds === undefined && input.coachId === undefined && input.coachId !== null) throw new Error('仅可更新运动员或教练');
    const { data, error } = await apiWorkflow<{ id: string; status: Registration['status'] }>(`/club/registrations/${encodeURIComponent(id)}`, {
      ...(athleteIds !== undefined ? { athleteIds } : {}),
      ...(input.coachId !== undefined ? { coachId: input.coachId } : {}),
    }, { method: 'PUT' });
    if (error || !data) throw error || new Error('报名更新未返回结果');
    return null;
  },
  async resubmit(id: string): Promise<{ id: string; status: Registration['status'] }> {
    const { data, error } = await apiWorkflow<{ id: string; status: Registration['status'] }>(`/club/registrations/${encodeURIComponent(id)}/resubmit`, {});
    if (error || !data) throw error || new Error('报名重提未返回结果');
    invalidate('group:');
    return data;
  },
  async delete(id: string): Promise<void> {
    const { error } = await apiWorkflow<{ id: string; deleted: boolean }>(`/club/registrations/${encodeURIComponent(id)}`, undefined, { method: 'DELETE' });
    if (error) throw error;
    invalidate('group:');
  },
  async cancelForClubCompetition(competitionId: string, teamProfileId?: string): Promise<{ deleted: number; ids: string[] }> {
    const { data, error } = await apiWorkflow<{ deleted: number; ids: string[] }>('/club/registrations', {
      competitionId,
      ...(teamProfileId ? { teamProfileId } : {}),
    }, { method: 'DELETE' });
    if (error || !data) throw error || new Error('取消报名未返回结果');
    invalidate('group:');
    return data;
  },
  async review(ids: string[], action: 'confirmed' | 'rejected', competitionId: string, rejectReason?: string): Promise<void> {
    if (!ids.length || ids.length > 50) throw new Error('每次最多审核 50 条待审核报名');
    const { error } = await apiWorkflow('/admin/registrations/review', {
      registrationType: 'club', action, ids, competitionId,
      ...(action === 'rejected' ? { rejectReason: rejectReason?.trim() || '管理员拒绝了此报名' } : {}),
    });
    if (error) throw error;
  },
};

// ========== 队伍资料（每俱乐部每赛事唯一） ==========
export const teamProfileStore = {
  /** 按赛事获取所有队伍资料 */
  async getByCompetition(cid: string): Promise<TeamProfile[]> {
    const { data, error } = await supabase.from(TABLES.team_profiles)
      .select('*').eq('competition_id', cid).order('created_at', { ascending: true });
    if (error && error.message?.includes('does not exist')) return [];
    if (error) throw error;
    return (data || []).map((r: Record<string, unknown>) => mapTeamProfile(r));
  },
  /** 按赛事+俱乐部获取所有队伍资料 */
  async getByCompetitionAndClub(cid: string, clubId: string): Promise<TeamProfile[]> {
    return this.getAllByClubAndCompetition(clubId, cid);
  },
  /** 按俱乐部+赛事获取所有队伍资料（兼容旧命名） */
  async getByClubAndCompetition(clubId: string, cid: string): Promise<TeamProfile[]> {
    return this.getAllByClubAndCompetition(clubId, cid);
  },
  /** 获取某俱乐部在某赛事下的所有队伍（多队伍场景） */
  async getAllByClubAndCompetition(clubId: string, cid: string): Promise<TeamProfile[]> {
    const { data, error } = await supabase.from(TABLES.team_profiles)
      .select('*').eq('competition_id', cid).eq('club_id', clubId).order('created_at', { ascending: true });
    if (error && error.message?.includes('does not exist')) return [];
    if (error) throw error;
    return (data || []).map((r: Record<string, unknown>) => mapTeamProfile(r));
  },
  async create(input: Omit<TeamProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<TeamProfile> {
    const { data, error } = await supabase.from(TABLES.team_profiles).insert({
      club_id: input.clubId,
      competition_id: input.competitionId,
      team_name: input.teamName,
      slogan: input.slogan || null,
      logo_url: input.logoUrl || null,
      max_athletes: input.maxAthletes || null,
    }).select().single();
    if (error) {
      if (error.message?.includes('does not exist')) {
        // 表不存在时返回模拟对象
        return {
          id: uid(),
          clubId: input.clubId,
          competitionId: input.competitionId,
          teamName: input.teamName,
          slogan: input.slogan,
          logoUrl: input.logoUrl,
          maxAthletes: input.maxAthletes,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      throw error;
    }
    return mapTeamProfile(data);
  },
  async update(id: string, input: Partial<Omit<TeamProfile, 'id' | 'clubId' | 'competitionId' | 'createdAt' | 'updatedAt'>>): Promise<TeamProfile | null> {
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.teamName !== undefined) patch.team_name = input.teamName;
    if (input.slogan !== undefined) patch.slogan = input.slogan;
    if (input.logoUrl !== undefined) patch.logo_url = input.logoUrl;
    if (input.maxAthletes !== undefined) patch.max_athletes = input.maxAthletes || null;

    const { data, error } = await supabase.from(TABLES.team_profiles).update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data ? mapTeamProfile(data) : null;
  },
};

// ========== 出场顺序生成 ==========
export const orderStore = {
  async generate(competitionId: string, venueCount: number = 8): Promise<{ id: string; competitionId: string; version: number; entryCount: number; status: string; stale: boolean }> {
    const { data, error } = await apiWorkflow<{ id: string; competitionId: string; version: number; entryCount: number; status: string; stale: boolean }>('/admin/order-books/generate', { competitionId, venueCount });
    if (error || !data) throw error || new Error('出场顺序生成未返回结果');
    return data;
  },
  async getByCompetition(cid: string): Promise<OrderEntry[]> {
    const { data, error } = await apiWorkflow<{ entries?: Record<string, unknown>[]; book?: { is_stale?: number } | null }>(`/admin/order-books/current?competitionId=${encodeURIComponent(cid)}`);
    if (error) throw error;
    return (data?.entries || []).map(mapOrderEntry);
  },
};

export interface ScorecardEntry {
  id: string;
  competition_id: string;
  registration_id: string;
  team_profile_id?: string | null;
  club_name: string;
  team_name?: string | null;
  event_name: string;
  group_name: string;
  session_label: string;
  session_number: number;
  venue_number: number;
  athlete_names: string[];
}

export const scorecardStore = {
  async importCurrent(competitionId: string): Promise<{ entryCount: number; sourceOrderBookVersion: number; reused: boolean }> {
    const { data, error } = await apiWorkflow<{ entryCount: number; sourceOrderBookVersion: number; reused: boolean }>('/admin/scorecards/import', { competitionId });
    if (error || !data) throw error || new Error('计分表数据导入失败');
    return data;
  },
  async getCurrentImport(competitionId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await apiWorkflow<{ import?: Record<string, unknown> | null }>(`/admin/scorecards/current?competitionId=${encodeURIComponent(competitionId)}`);
    if (error) throw error;
    return data?.import || null;
  },
  async unpublish(competitionId: string): Promise<{ id: string; competitionId: string; unpublished: boolean }> {
    const { data, error } = await apiWorkflow<{ id: string; competitionId: string; unpublished: boolean }>(`/admin/scorecards/current?competitionId=${encodeURIComponent(competitionId)}`, undefined, { method: 'DELETE' });
    if (error || !data) throw error || new Error('取消发布失败');
    return data;
  },
  async getForClub(competitionId: string, teamProfileId?: string, athleteName?: string): Promise<{ imported: Record<string, unknown> | null; entries: ScorecardEntry[] }> {
    const params = new URLSearchParams({ competitionId });
    if (teamProfileId) params.set('teamProfileId', teamProfileId);
    if (athleteName?.trim()) params.set('athleteName', athleteName.trim());
    const { data, error } = await apiWorkflow<{ import?: Record<string, unknown> | null; entries?: ScorecardEntry[] }>(`/club/scorecards/entries?${params.toString()}`);
    if (error) throw error;
    return { imported: data?.import || null, entries: data?.entries || [] };
  },
};

// ========== 管理员账号 ==========
const ADMIN_PUBLIC_COLUMNS = 'id, username, display_name, role, is_active, created_at, updated_at';

export const adminUserStore = {
  async getAll(): Promise<AdminUser[]> {
    const { data } = await supabase.from(TABLES.admin_users).select(ADMIN_PUBLIC_COLUMNS).order('created_at', { ascending: true });
    return (data || []).map(mapAdminUser);
  },
  async getById(id: string): Promise<AdminUser | null> {
    const { data } = await supabase.from(TABLES.admin_users).select(ADMIN_PUBLIC_COLUMNS).eq('id', id).single();
    return data ? mapAdminUser(data) : null;
  },
  async getByUsername(username: string): Promise<AdminUser | null> {
    const { data } = await supabase.from(TABLES.admin_users).select(ADMIN_PUBLIC_COLUMNS).eq('username', username).single();
    return data ? mapAdminUser(data) : null;
  },
  async login(username: string, password: string): Promise<AdminUser | null> {
    const { data, error } = await apiAuth.adminLogin(username, password);
    if (error) {
      if (error.status === 401 || error.status === 403 || error.status === 404) return null;
      throw error;
    }
    if (!data) return null;
    const payload = data as Record<string, unknown>;
    const row = (payload.admin || payload.user || data) as Record<string, unknown>;
    return mapAdminUser({ ...row, reset_required: payload.must_reset_password === true ? 1 : row.reset_required });
  },
  async resetPassword(password: string, confirmPassword: string): Promise<AdminUser> {
    const { data, error } = await apiAuth.adminResetPassword(password, confirmPassword);
    if (error || !data) throw error || new Error('密码修改失败');
    const payload = data as Record<string, unknown>;
    const user = payload.user;
    if (!user || typeof user !== 'object') throw new Error('密码修改后未返回管理员信息');
    return mapAdminUser({ ...(user as Record<string, unknown>), reset_required: 0 });
  },
  async create(input: { username: string; password: string; displayName: string; role?: string }): Promise<AdminUser> {
    const exist = await this.getByUsername(input.username);
    if (exist) throw new Error('管理员账号已存在');

    const { data, error } = await supabase.from(TABLES.admin_users).insert({
      username: input.username,
      password_hash: await hashPassword(input.password),
      display_name: input.displayName,
      role: input.role || 'organizer',
      is_active: true,
    }).select(ADMIN_PUBLIC_COLUMNS).single();
    if (error) throw error;
    return mapAdminUser(data);
  },
  async update(id: string, input: { password?: string; displayName?: string; role?: string; isActive?: boolean }): Promise<AdminUser | null> {
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.password !== undefined) patch.password_hash = await hashPassword(input.password);
    if (input.displayName !== undefined) patch.display_name = input.displayName;
    if (input.role !== undefined) patch.role = input.role;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const { data, error } = await supabase.from(TABLES.admin_users).update(patch).eq('id', id).select(ADMIN_PUBLIC_COLUMNS).single();
    if (error) throw error;
    return data ? mapAdminUser(data) : null;
  },
  async delete(id: string): Promise<void> {
    await supabase.from(TABLES.admin_users).delete().eq('id', id);
  },
};

// ========== 管理员认证 ==========
export const adminAuth = {
  _currentUser: null as AdminUser | null,

  async login(user: string, pass: string): Promise<boolean> {
    try {
      const adminUser = await adminUserStore.login(user, pass);
      if (adminUser) {
        this._currentUser = adminUser;
        localStorage.setItem('rj_admin_token', 'authenticated');
        localStorage.setItem('rj_admin_user', JSON.stringify(adminUser));
        return true;
      }
    } catch (e) {
      // 管理员登录失败
    }
    return false;
  },
  logout(): void {
    this._currentUser = null;
    localStorage.removeItem('rj_admin_token');
    localStorage.removeItem('rj_admin_user');
    apiAuth.logoutKeepalive();
  },
  isLoggedIn(): boolean { return localStorage.getItem('rj_admin_token') === 'authenticated'; },
  async restoreSession(): Promise<AdminUser | null> {
    const { data, error } = await apiAuth.session();
    if (error || !data || (data as Record<string, unknown>).role !== 'admin') {
      this._currentUser = null;
      localStorage.removeItem('rj_admin_token');
      localStorage.removeItem('rj_admin_user');
      return null;
    }
    const user = (data as Record<string, unknown>).user;
    if (!user || typeof user !== 'object') return null;
    const admin = mapAdminUser(user as Record<string, unknown>);
    this._currentUser = admin;
    localStorage.setItem('rj_admin_token', 'authenticated');
    localStorage.setItem('rj_admin_user', JSON.stringify(admin));
    return admin;
  },
  getCurrentUser(): AdminUser | null {
    if (this._currentUser) return this._currentUser;
    try {
      const raw = localStorage.getItem('rj_admin_user');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
};

// ========== 映射函数：Supabase snake_case → TS camelCase ==========
function mapCompetition(row: Record<string, unknown>): Competition {
  return {
    id: row.id as string, name: row.name as string, subtitle: row.subtitle as string, venue: row.venue as string,
    startDate: row.start_date as string, endDate: row.end_date as string,
    registrationDeadline: row.registration_deadline as string, status: row.status as RegistrationStatus,
    description: row.description as string, logoUrl: row.logo_url as string,
    maxIndividualEvents: row.max_individual_events as number,
    maxTeamEvents: row.max_team_events as number,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string,
  };
}
function mapEvent(row: Record<string, unknown>): Event {
  return {
    id: row.id as string, competitionId: row.competition_id as string, name: row.name as string, code: row.code as string,
    category: row.category as string, description: (row.description as string) || undefined,
    maxAthletes: row.max_athletes as number, isIndividual: (row.is_individual as boolean) ?? true,
    orderIndex: row.order_index as number, createdAt: row.created_at as string,
  };
}
function mapGroup(row: Record<string, unknown>): EventGroup {
  return {
    id: row.id as string, eventId: row.event_id as string, name: row.name as string, type: row.type as GroupType, gender: (row.gender as Gender) || undefined,
    ageMin: (row.age_min as number) || undefined, ageMax: (row.age_max as number) || undefined,
    maxRegistrations: row.max_registrations as number, currentCount: row.current_count as number, orderIndex: row.order_index as number,
  };
}
function mapClub(row: Record<string, unknown>): ClubAccount {
  return {
    id: row.id as string, username: row.username as string, clubName: row.club_name as string,
    contactName: row.contact_name as string, phone: row.phone as string, email: row.email as string,
    province: row.province as string, city: row.city as string,
    createdAt: row.created_at as string, isApproved: row.is_approved as boolean,
  };
}
function mapLeader(row: Record<string, unknown>): TeamLeader {
  return { id: row.id as string, clubId: row.club_id as string, competitionId: (row.competition_id as string) || undefined, teamProfileId: (row.team_profile_id as string) || undefined, name: row.name as string, phone: row.phone as string, position: row.position as string };
}
function mapLeaderWithClub(row: Record<string, unknown>, clubMap: Map<string, string>): TeamLeader {
  return { id: row.id as string, clubId: row.club_id as string, competitionId: (row.competition_id as string) || undefined, teamProfileId: (row.team_profile_id as string) || undefined, clubName: clubMap.get(row.club_id as string) || '未知俱乐部', name: row.name as string, phone: row.phone as string, position: row.position as string };
}
function mapCoach(row: Record<string, unknown>): Coach {
  return { id: row.id as string, clubId: row.club_id as string, competitionId: (row.competition_id as string) || undefined, teamProfileId: (row.team_profile_id as string) || undefined, name: row.name as string, phone: row.phone as string };
}
function mapCoachWithClub(row: Record<string, unknown>, clubMap: Map<string, string>): Coach {
  return { id: row.id as string, clubId: row.club_id as string, competitionId: (row.competition_id as string) || undefined, teamProfileId: (row.team_profile_id as string) || undefined, clubName: clubMap.get(row.club_id as string) || '未知俱乐部', name: row.name as string, phone: row.phone as string };
}
function mapAthlete(row: Record<string, unknown>): Athlete {
  return { id: row.id as string, clubId: row.club_id as string, competitionId: (row.competition_id as string) || undefined, teamProfileId: (row.team_profile_id as string) || undefined, name: row.name as string, gender: row.gender as Gender, birthDate: row.birth_date as string, idCard: row.id_card as string, avatarUrl: row.avatar_url as string };
}
function mapAthleteWithClub(row: Record<string, unknown>, clubMap: Map<string, string>): Athlete {
  return { id: row.id as string, clubId: row.club_id as string, competitionId: (row.competition_id as string) || undefined, teamProfileId: (row.team_profile_id as string) || undefined, clubName: clubMap.get(row.club_id as string) || '未知俱乐部', name: row.name as string, gender: row.gender as Gender, birthDate: row.birth_date as string, idCard: row.id_card as string, avatarUrl: row.avatar_url as string };
}
function mapRegistration(row: Record<string, unknown>): Registration {
  const rawAthletes = row.athletes;
  let athletes: { athleteId: string; name: string }[] = [];
  if (Array.isArray(rawAthletes)) {
    athletes = rawAthletes.filter((athlete): athlete is { athleteId: string; name: string } => Boolean(athlete) && typeof athlete === 'object' && typeof (athlete as { athleteId?: unknown }).athleteId === 'string' && typeof (athlete as { name?: unknown }).name === 'string');
  } else if (typeof rawAthletes === 'string') {
    try {
      const parsed: unknown = JSON.parse(rawAthletes);
      if (Array.isArray(parsed)) athletes = parsed.filter((athlete): athlete is { athleteId: string; name: string } => Boolean(athlete) && typeof athlete === 'object' && typeof (athlete as { athleteId?: unknown }).athleteId === 'string' && typeof (athlete as { name?: unknown }).name === 'string');
    } catch {
      athletes = [];
    }
  }
  return {
    id: row.id as string, competitionId: row.competition_id as string, clubId: row.club_id as string, teamProfileId: (row.team_profile_id as string) || undefined, clubName: row.club_name as string,
    eventId: row.event_id as string, eventName: row.event_name as string,
    groupId: row.group_id as string, groupName: row.group_name as string,
    athletes,
    coachId: row.coach_id as string | undefined, coachName: row.coach_name as string | undefined,
    status: row.status as 'pending' | 'confirmed' | 'rejected',
    rejectReason: (row.reject_reason as string) || undefined,
    startOrder: row.start_order as number | undefined,
    bibNumber: row.bib_number as string | undefined,
    editUnlocked: Boolean(row.edit_unlocked),
    editUnlockedAt: (row.unlocked_at as string) || undefined,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string,
  };
}
function mapOrderEntry(row: Record<string, unknown>): OrderEntry {
  // bib_number 格式为 "场次-场地"，如 "1-3"；兼容旧格式纯数字
  const rawBib = row.bib_number as string | number | undefined;
  const startOrderNum = row.start_order as number;
  const bib = rawBib || String(startOrderNum).padStart(3, '0');
  let sessionLabel: string = typeof bib === 'string' ? bib : String(bib);
  let sessionNumber: number = startOrderNum;
  let venueNumber = 1;
  if (typeof bib === 'string') {
    const m = bib.match(/^(\d+)-(\d+)$/);
    if (m) {
      sessionLabel = bib;
      sessionNumber = parseInt(m[1], 10);
      venueNumber = parseInt(m[2], 10);
    }
  }
  return {
    id: row.id as string, competitionId: row.competition_id as string, eventId: row.event_id as string, eventName: row.event_name as string,
    groupId: row.group_id as string, groupName: row.group_name as string,
    startOrder: startOrderNum,
    sessionLabel,
    sessionNumber,
    venueNumber,
    bibNumber: bib as string,
    clubId: (row.club_id as string) || '',
    clubName: row.club_name as string,
    athletes: Array.isArray(row.athletes)
      ? (row.athletes as unknown[]).map(athlete => typeof athlete === 'string' ? athlete : String((athlete as Record<string, unknown>)?.name || (athlete as Record<string, unknown>)?.athleteId || ''))
      : [],
    coachName: row.coach_name as string,
  };
}
function mapTeamProfile(row: Record<string, unknown>): TeamProfile {
  return {
    id: row.id as string, clubId: row.club_id as string, competitionId: row.competition_id as string,
    teamName: row.team_name as string, slogan: (row.slogan as string) || undefined,
    logoUrl: (row.logo_url as string) || undefined,
    maxAthletes: (row.max_athletes as number) || undefined,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string,
  };
}

function mapAdminUser(row: Record<string, unknown>): AdminUser {
  return {
    id: row.id as string, username: row.username as string, displayName: row.display_name as string,
    role: row.role as UserRole, isActive: Boolean(row.is_active),
    mustResetPassword: Boolean(Number(row.reset_required ?? row.must_reset_password ?? 0)),
    createdAt: row.created_at as string, updatedAt: row.updated_at as string,
  };
}

function mapLimitConfig(row: Record<string, unknown>): LimitConfig {
  return {
    id: row.id as string,
    competitionId: row.competition_id as string,
    scope: row.scope as 'team' | 'event' | 'group',
    targetId: row.target_id as string,
    maxRegistrations: (row.max_registrations as number) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ========== 限报人数配置 ==========
export const limitConfigStore = {
  /** 获取某赛事的所有限报配置 */
  async getByCompetition(cid: string): Promise<LimitConfig[]> {
    return cached(`limit:${cid}`, 30000, async () => {
      const { data, error } = await supabase.from(TABLES.limit_configs).select('*').eq('competition_id', cid);
      if (error) { console.warn('[limitConfigStore]', error.message); return []; }
      return (data || []).map(mapLimitConfig);
    });
  },
  /** 获取某赛事某维度的配置（单条） */
  async getByTarget(cid: string, scope: 'team' | 'event' | 'group', targetId: string): Promise<LimitConfig | null> {
    const all = await this.getByCompetition(cid);
    return all.find(c => c.scope === scope && c.targetId === targetId) || null;
  },
  /** 设置/更新某维度的限报人数 */
  async set(cid: string, scope: 'team' | 'event' | 'group', targetId: string, max: number | null): Promise<LimitConfig> {
    const existing = await this.getByTarget(cid, scope, targetId);
    if (existing) {
      const { data, error } = await supabase.from(TABLES.limit_configs)
        .update({ max_registrations: max, updated_at: new Date().toISOString() })
        .eq('id', existing.id).select().single();
      if (error) throw error;
      invalidate(`limit:${cid}`);
      return mapLimitConfig(data);
    } else {
      const { data, error } = await supabase.from(TABLES.limit_configs)
        .insert({ competition_id: cid, scope, target_id: targetId, max_registrations: max })
        .select().single();
      if (error) throw error;
      invalidate(`limit:${cid}`);
      return mapLimitConfig(data);
    }
  },
  /** 删除某维度的限报配置 */
  async remove(id: string, cid: string): Promise<void> {
    await supabase.from(TABLES.limit_configs).delete().eq('id', id);
    invalidate(`limit:${cid}`);
  },
};

// ========== 限报校验工具函数 ==========
/**
 * 校验某队伍在某赛事中的报名是否超限
 * @returns 超限提示数组（空数组表示未超限）
 */
export async function checkLimitViolations(
  competitionId: string,
  clubId: string,
  teamProfileId: string | undefined,
  eventId: string,
  groupId: string,
  existingRegs: any[],
): Promise<string[]> {
  const errors: string[] = [];
  try {
    const configs = await limitConfigStore.getByCompetition(competitionId);

    // 1. 队伍维度（teamProfileId 存在）
    if (teamProfileId) {
      const teamCfg = configs.find(c => c.scope === 'team' && c.targetId === teamProfileId);
      if (teamCfg && teamCfg.maxRegistrations && teamCfg.maxRegistrations > 0) {
        // 统计该队伍已报名人数（含 pending + confirmed）
        const teamRegs = existingRegs.filter(
          (r: any) => r.teamProfileId === teamProfileId && (r.status === 'pending' || r.status === 'confirmed')
        );
        if (teamRegs.length >= teamCfg.maxRegistrations) {
          errors.push(`队伍限报已达上限（${teamCfg.maxRegistrations}人）`);
        }
      }

      // 同时检查队伍资料本身的 maxAthletes 字段
      const { data: tpData } = await supabase.from(TABLES.team_profiles)
        .select('max_athletes').eq('id', teamProfileId).single();
      const tpMax = (tpData as any)?.max_athletes;
      if (tpMax && tpMax > 0) {
        const teamRegs = existingRegs.filter(
          (r: any) => r.teamProfileId === teamProfileId && (r.status === 'pending' || r.status === 'confirmed')
        );
        if (teamRegs.length >= tpMax) {
          errors.push(`队伍「${tpMax}人上限」已达`);
        }
      }
    }

    // 2. 项目维度
    const eventCfg = configs.find(c => c.scope === 'event' && c.targetId === eventId);
    if (eventCfg && eventCfg.maxRegistrations && eventCfg.maxRegistrations > 0) {
      const eventRegs = existingRegs.filter(
        (r: any) => r.eventId === eventId && (r.status === 'pending' || r.status === 'confirmed')
      );
      if (eventRegs.length >= eventCfg.maxRegistrations) {
        errors.push(`项目限报已达上限（${eventCfg.maxRegistrations}人）`);
      }
    }

    // 3. 分组维度（已有 group.maxRegistrations 字段，此处仅做补充提示）
    // 分组维度由 ClubRegForm 中已有的 grp.currentCount >= grp.maxRegistrations 处理

  } catch (e: any) {
    console.warn('[checkLimitViolations]', e.message);
  }
  return errors;
}
