import type { D1PreparedStatement, Env, Row, SessionPrincipal } from './types';
import { audit } from './auth';
import { HttpError, readJson } from './http';
import { assertCompetitionOpen } from './deadline';

const MAX_MUTATION_BYTES = 96 * 1024;
const MAX_REVIEW_IDS = 50;
const MAX_PAGE_SIZE = 100;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;

type ClubRegistrationInput = { competitionId: string; eventId: string; groupId: string; athleteIds: string[]; coachId?: string; teamProfileId?: string };
type ClubRegistrationReplaceInput = { competitionId: string; teamProfileId?: string; registrations: ClubRegistrationInput[] };
type ReviewType = 'club';
type ReviewAction = 'confirmed' | 'rejected';

function requiredId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new HttpError(422, `${field} is required`, 'INVALID_FIELD');
  return value;
}
function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredId(value, field);
}
function requiredText(value: unknown, field: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(422, `${field} is required`, 'INVALID_FIELD');
  return value.trim();
}
function parseAthletes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function athleteNames(value: unknown): string[] {
  return parseAthletes(value)
    .map(item => typeof item === 'string' ? item : item && typeof item === 'object' && typeof (item as Row).name === 'string' ? String((item as Row).name) : '')
    .map(name => name.trim())
    .filter(Boolean);
}
function ageAt(birthDate: string, referenceDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const reference = new Date(`${referenceDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return -1;
  let age = reference.getUTCFullYear() - birth.getUTCFullYear();
  if (reference.getUTCMonth() < birth.getUTCMonth() || (reference.getUTCMonth() === birth.getUTCMonth() && reference.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}
function parseClubInput(raw: unknown): ClubRegistrationInput {
  if (!raw || typeof raw !== 'object') throw new HttpError(422, 'A registration payload is required', 'INVALID_PAYLOAD');
  const body = raw as Record<string, unknown>;
  const athleteIds = Array.isArray(body.athleteIds) ? body.athleteIds.map(value => requiredId(value, 'athleteIds')) : [];
  if (!athleteIds.length || athleteIds.length > 50 || new Set(athleteIds).size !== athleteIds.length) {
    throw new HttpError(422, 'athleteIds must contain 1-50 unique athlete IDs', 'INVALID_ATHLETES');
  }
  return { competitionId: requiredId(body.competitionId, 'competitionId'), eventId: requiredId(body.eventId, 'eventId'), groupId: requiredId(body.groupId, 'groupId'), athleteIds, coachId: optionalId(body.coachId, 'coachId') || undefined, teamProfileId: optionalId(body.teamProfileId, 'teamProfileId') || undefined };
}
function parseClubRegistrationReplaceInput(raw: unknown): ClubRegistrationReplaceInput {
  if (!raw || typeof raw !== 'object') throw new HttpError(422, 'A replacement registration payload is required', 'INVALID_PAYLOAD');
  const body = raw as Record<string, unknown>;
  const competitionId = requiredId(body.competitionId, 'competitionId');
  const teamProfileId = optionalId(body.teamProfileId, 'teamProfileId') || undefined;
  if (!Array.isArray(body.registrations) || !body.registrations.length || body.registrations.length > 100) {
    throw new HttpError(422, 'registrations must contain 1-100 selections', 'INVALID_REGISTRATIONS');
  }
  // 替换接口的赛事和队伍作用域由外层请求体统一提供；兼容客户端清单项只携带项目、组别和运动员 ID。
  const registrations = body.registrations.map(item => {
    if (!item || typeof item !== 'object') return parseClubInput(item);
    const entry = item as Record<string, unknown>;
    return parseClubInput({
      ...entry,
      competitionId,
      ...(teamProfileId ? { teamProfileId } : {}),
    });
  });
  if (registrations.some(item => item.competitionId !== competitionId || (item.teamProfileId || undefined) !== teamProfileId)) {
    throw new HttpError(422, 'Every registration must use the selected competition and team', 'INVALID_REGISTRATIONS');
  }
  return { competitionId, teamProfileId, registrations };
}
async function getCompetition(env: Env, competitionId: string): Promise<Row> {
  const row = await env.REGISTRATION_DB.prepare('SELECT * FROM competitions WHERE id = ? LIMIT 1').bind(competitionId).first<Row>();
  if (!row) throw new HttpError(422, 'Competition does not exist', 'INVALID_COMPETITION');
  return row;
}
async function getEventGroup(env: Env, competitionId: string, eventId: string, groupId: string): Promise<Row> {
  const row = await env.REGISTRATION_DB.prepare(`SELECT e.*, g.id AS group_id, g.name AS group_name, g.gender AS group_gender, g.age_min, g.age_max, g.max_registrations, g.current_count
    FROM events e JOIN event_groups g ON g.event_id = e.id WHERE e.competition_id = ? AND e.id = ? AND g.id = ? LIMIT 1`).bind(competitionId, eventId, groupId).first<Row>();
  if (!row) throw new HttpError(422, 'Event and group must belong to the selected competition', 'INVALID_EVENT_GROUP');
  return row;
}
/**
 * 大集体门槛：每队 5 人及以上视为大集体，不设年龄分组（自由组队）
 */
const BIG_TEAM_MIN_SIZE = 5;

function isBigTeam(maxAthletes: unknown): boolean {
  const n = Number(maxAthletes);
  return Number.isFinite(n) && n >= BIG_TEAM_MIN_SIZE;
}

/**
 * ISO 8601 日期格式校验：YYYY-MM-DD，且能被 Date 正确解析
 * 防御场景：'not-a-date' / '2020-13-01' / '2050-12-31' / '9999-12-31' 等任意字符串
 * 必须与前端 src/lib/groupMatcher.ts 的 isValidISODate 保持完全一致
 */
function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

/**
 * 校验运动员是否可以报该组别。
 *
 * 跨组别规则（2026-08-29 修订，与前端 src/lib/groupMatcher.ts 保持一致）：
 *  - 5 人及以上大集体：不设年龄分组，自由组队 → 只校验性别，跳过年龄校验
 *  - 个人项目 / 2-4 人小集体：只允许报高，不许报低
 *      · 只校验年龄上限（年龄 ≤ age_max 即可），不校验下限
 *      · 年龄小的可升到更大年龄组；年龄大的严禁降组报更小的组
 *
 * @param group  事件 + 组别行（含 group_gender / age_min / age_max / max_athletes）
 * @param athlete 运动员行（含 gender / birth_date）
 * @param startDate 赛事开始日期，用于计算周岁
 * @param isIndividual 是否个人项目
 */
/**
 * 按赛事年份推算某年龄组的出生日期起始日（下限年份的 1 月 1 日）。
 * 规则：出生年份 = 赛事年份 − 年龄；年龄上限 age_max 对应最早出生年份。
 *  例：2026 年赛事，儿童乙组 10-12 岁 → 起始日 2014-01-01（2026 − 12）
 *      2027 年赛事自动变为 2015-01-01
 */
function birthStartOf(group: Row, startDate: string): string {
  const year = startDate ? new Date(startDate).getFullYear() : new Date().getFullYear();
  const ageMax = group.age_max === null || group.age_max === undefined ? null : Number(group.age_max);
  if (ageMax === null || !Number.isFinite(ageMax)) return '1900-01-01';
  return `${year - ageMax}-01-01`;
}

function assertEligible(group: Row, athlete: Row, startDate: string, isIndividual: boolean): void {
  if (group.group_gender && group.group_gender !== 'mixed' && athlete.gender !== group.group_gender) throw new HttpError(422, 'Athlete gender is not eligible for this group', 'ATHLETE_INELIGIBLE');
  // 大集体（5 人及以上）：不设年龄分组，自由组队，跳过年龄校验
  if (!isIndividual && isBigTeam(group.max_athletes)) return;
  const birthDate = String(athlete.birth_date || '');
  if (!birthDate) throw new HttpError(422, 'Athlete birth date is required', 'ATHLETE_INELIGIBLE');
  // ISO 日期合法性校验：防止 'not-a-date' / '2050-12-31' / '9999-12-31' 等任意字符串绕过年龄检查
  if (!isValidISODate(birthDate)) {
    throw new HttpError(422, `Athlete birth date is not a valid ISO date: ${birthDate}`, 'ATHLETE_INELIGIBLE');
  }
  // 报高不报低：出生日期须不早于该组起始日（起始日越早 = 年龄组越大）
  const start = birthStartOf(group, startDate);
  if (birthDate < start) {
    throw new HttpError(422, `Athlete birth date ${birthDate} is earlier than this group start date ${start} (only entering an older age group is allowed)`, 'ATHLETE_INELIGIBLE');
  }
}
async function assertLimits(env: Env, input: ClubRegistrationInput, event: Row, clubId: string, excludeRegistrationIds: string[] = []): Promise<void> {
  if (input.athleteIds.length > Number(event.max_athletes)) throw new HttpError(422, 'Selected athletes exceed this event capacity', 'EVENT_ATHLETE_LIMIT');
  const limits = await env.REGISTRATION_DB.prepare(`SELECT scope, target_id, max_registrations FROM limit_configs
    WHERE competition_id = ? AND ((scope = 'event' AND target_id = ?) OR (scope = 'group' AND target_id = ?) OR (scope = 'team' AND target_id = ?))`)
    .bind(input.competitionId, input.eventId, input.groupId, input.teamProfileId || clubId).all<Row>();
  for (const limit of limits.results || []) {
    if (limit.max_registrations === null) continue;
    const where = limit.scope === 'event' ? 'event_id = ?' : limit.scope === 'group' ? 'group_id = ?' : input.teamProfileId ? 'team_profile_id = ?' : 'club_id = ?';
    const target = limit.scope === 'event' ? input.eventId : limit.scope === 'group' ? input.groupId : input.teamProfileId || clubId;
    const exclusionSql = excludeRegistrationIds.length ? ` AND id NOT IN (${excludeRegistrationIds.map(() => '?').join(',')})` : '';
    const count = await env.REGISTRATION_DB.prepare(`SELECT COUNT(*) AS total FROM registrations WHERE competition_id = ? AND ${where} AND status IN ('pending','confirmed')${exclusionSql}`).bind(input.competitionId, target, ...excludeRegistrationIds).first<Row>();
    if (Number(count?.total || 0) >= Number(limit.max_registrations)) throw new HttpError(409, 'Registration quota has been reached', 'REGISTRATION_QUOTA_EXCEEDED');
  }
}
async function buildClubRegistration(
  env: Env,
  actor: SessionPrincipal,
  input: ClubRegistrationInput,
  excludeRegistrationIds: string[] = [],
  quotaReservations?: Map<string, number>,
  options: { lockDeadline?: boolean } = {},
): Promise<{ registration: Row; athletes: Row[] }> {
  const competition = await getCompetition(env, input.competitionId); assertCompetitionOpen(competition, new Date(), { lockDeadline: options.lockDeadline !== false });
  const event = await getEventGroup(env, input.competitionId, input.eventId, input.groupId);
  const club = await env.REGISTRATION_DB.prepare('SELECT club_name FROM clubs WHERE id = ? AND is_approved = 1').bind(actor.userId).first<Row>();
  if (!club) throw new HttpError(403, 'Club is not approved', 'CLUB_NOT_ELIGIBLE');
  if (input.teamProfileId) {
    const team = await env.REGISTRATION_DB.prepare('SELECT id FROM team_profiles WHERE id = ? AND club_id = ? AND competition_id = ?').bind(input.teamProfileId, actor.userId, input.competitionId).first<Row>();
    if (!team) throw new HttpError(422, 'Team does not belong to this club and competition', 'INVALID_OWNED_REFERENCE');
  }
  if (input.coachId) {
    const coach = await env.REGISTRATION_DB.prepare('SELECT id, name FROM coaches WHERE id = ? AND club_id = ? AND competition_id = ?').bind(input.coachId, actor.userId, input.competitionId).first<Row>();
    if (!coach) throw new HttpError(422, 'Coach does not belong to this club and competition', 'INVALID_OWNED_REFERENCE');
  }
  const placeholders = input.athleteIds.map(() => '?').join(',');
  const athleteRows = await env.REGISTRATION_DB.prepare(`SELECT id, name, gender, birth_date, team_profile_id FROM athletes WHERE id IN (${placeholders}) AND club_id = ? AND competition_id = ?`)
    .bind(...input.athleteIds, actor.userId, input.competitionId).all<Row>();
  const athletes = athleteRows.results || [];
  if (athletes.length !== input.athleteIds.length) throw new HttpError(422, 'Every athlete must belong to the current club and competition', 'INVALID_ATHLETE_OWNERSHIP');
  for (const athlete of athletes) {
    if (input.teamProfileId && athlete.team_profile_id !== input.teamProfileId) throw new HttpError(422, 'Athlete does not belong to the selected team', 'INVALID_ATHLETE_OWNERSHIP');
    assertEligible(event, athlete, String(competition.start_date), event.is_individual !== false && Number(event.is_individual) !== 0);
    const exclusionSql = excludeRegistrationIds.length ? ` AND r.id NOT IN (${excludeRegistrationIds.map(() => '?').join(',')})` : '';
    const duplicate = await env.REGISTRATION_DB.prepare(`SELECT r.id FROM registration_athletes ra JOIN registrations r ON r.id = ra.registration_id
      WHERE ra.athlete_id = ? AND r.competition_id = ? AND r.event_id = ? AND r.status IN ('pending','confirmed')${exclusionSql} LIMIT 1`).bind(athlete.id, input.competitionId, input.eventId, ...excludeRegistrationIds).first<Row>();
    if (duplicate) throw new HttpError(409, 'An athlete is already entered in this event', 'DUPLICATE_ENTRY');
    const isIndividual = event.is_individual !== false && Number(event.is_individual) !== 0;
    const max = Number(isIndividual ? competition.max_individual_events || 0 : competition.max_team_events || 0);
    if (max > 0) {
      const exclusionSql = excludeRegistrationIds.length ? ` AND r.id NOT IN (${excludeRegistrationIds.map(() => '?').join(',')})` : '';
      const entries = await env.REGISTRATION_DB.prepare(`SELECT COUNT(DISTINCT r.event_id) AS total
        FROM registration_athletes ra
        JOIN registrations r ON r.id = ra.registration_id
        JOIN events historical_event ON historical_event.id = r.event_id
        WHERE ra.athlete_id = ? AND r.competition_id = ? AND r.status IN ('pending','confirmed')
          AND historical_event.is_individual = ?${exclusionSql}`)
        .bind(athlete.id, input.competitionId, isIndividual ? 1 : 0, ...excludeRegistrationIds).first<Row>();
      const quotaKey = `${athlete.id}:${isIndividual ? 'individual' : 'team'}`;
      const reserved = quotaReservations?.get(quotaKey) || 0;
      if (Number(entries?.total || 0) + reserved >= max) {
        throw new HttpError(
          409,
          isIndividual ? 'Individual event quota has been reached' : 'Team event quota has been reached',
          isIndividual ? 'INDIVIDUAL_EVENT_QUOTA_EXCEEDED' : 'TEAM_EVENT_QUOTA_EXCEEDED',
        );
      }
      quotaReservations?.set(quotaKey, reserved + 1);
    }
  }
  await assertLimits(env, input, event, actor.userId, excludeRegistrationIds);
  const coach = input.coachId ? await env.REGISTRATION_DB.prepare('SELECT name FROM coaches WHERE id = ?').bind(input.coachId).first<Row>() : null;
  return { athletes, registration: { id: crypto.randomUUID(), competition_id: input.competitionId, club_id: actor.userId, team_profile_id: input.teamProfileId || null, club_name: String(club.club_name), event_id: input.eventId, event_name: String(event.name), group_id: input.groupId, group_name: String(event.group_name), athletes: JSON.stringify(input.athleteIds.map(athleteId => ({ athleteId, name: athletes.find(item => item.id === athleteId)?.name }))), coach_id: input.coachId || null, coach_name: coach?.name || null, status: 'pending' } };
}

async function cachedResponse(env: Env, actorType: string, actorId: string, operation: string, key: string | null): Promise<{ status: number; data: unknown } | null> {
  if (!key) return null;
  const cached = await env.REGISTRATION_DB.prepare('SELECT response_status, response_json FROM workflow_idempotency WHERE actor_type = ? AND actor_id = ? AND operation = ? AND idempotency_key = ?')
    .bind(actorType, actorId, operation, key).first<Row>();
  return cached ? { status: Number(cached.response_status), data: JSON.parse(String(cached.response_json)) } : null;
}
async function saveResponse(env: Env, actorType: string, actorId: string, operation: string, key: string | null, status: number, data: unknown): Promise<void> {
  if (!key) return;
  await env.REGISTRATION_DB.prepare(`INSERT OR IGNORE INTO workflow_idempotency (actor_type, actor_id, idempotency_key, operation, response_status, response_json)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(actorType, actorId, key, operation, status, JSON.stringify(data)).run();
}
function idempotencyKey(request: Request): string | null {
  const key = request.headers.get('Idempotency-Key');
  if (!key) return null;
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new HttpError(422, 'Invalid Idempotency-Key header', 'INVALID_IDEMPOTENCY_KEY');
  return key;
}

export async function createClubRegistration(request: Request, env: Env, actor: SessionPrincipal, requestId: string): Promise<{ status: number; data: unknown }> {
  const key = idempotencyKey(request); const operation = 'club.registration.create';
  const cached = await cachedResponse(env, actor.role, actor.userId, operation, key); if (cached) return cached;
  const prepared = await buildClubRegistration(env, actor, parseClubInput(await readJson(request, MAX_MUTATION_BYTES)));
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [env.REGISTRATION_DB.prepare(`INSERT INTO registrations (id,competition_id,club_id,team_profile_id,club_name,event_id,event_name,group_id,group_name,athletes,coach_id,coach_name,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(prepared.registration.id, prepared.registration.competition_id, prepared.registration.club_id, prepared.registration.team_profile_id, prepared.registration.club_name, prepared.registration.event_id, prepared.registration.event_name, prepared.registration.group_id, prepared.registration.group_name, prepared.registration.athletes, prepared.registration.coach_id, prepared.registration.coach_name, 'confirmed', now, now)];
  for (const athlete of prepared.athletes) statements.push(env.REGISTRATION_DB.prepare('INSERT INTO registration_athletes (registration_id, athlete_id) VALUES (?, ?)').bind(prepared.registration.id, athlete.id));
  statements.push(env.REGISTRATION_DB.prepare(`INSERT INTO registration_state_transitions (id,registration_type,registration_id,from_status,to_status,actor_type,actor_id,request_id,reason) VALUES (?,'club',?,NULL,'confirmed','system',NULL,?,'club_submission_auto_confirmed')`).bind(crypto.randomUUID(), prepared.registration.id, requestId));
  await env.REGISTRATION_DB.batch(statements);
  const data = { id: prepared.registration.id, status: 'confirmed' }; await saveResponse(env, actor.role, actor.userId, operation, key, 201, data);
  await audit(env, requestId, request, actor, operation, 'registrations', String(prepared.registration.id)); return { status: 201, data };
}

export async function replaceClubRegistrations(request: Request, env: Env, actor: SessionPrincipal, requestId: string): Promise<{ status: number; data: unknown }> {
  const key = idempotencyKey(request); const operation = 'club.registration.replace';
  const cached = await cachedResponse(env, actor.role, actor.userId, operation, key); if (cached) return cached;
  const input = parseClubRegistrationReplaceInput(await readJson(request, MAX_MUTATION_BYTES));
  const scope = input.teamProfileId || '';
  const unlock = await env.REGISTRATION_DB.prepare(`SELECT 1 FROM club_registration_edit_unlocks
    WHERE competition_id = ? AND club_id = ? AND team_scope = ? LIMIT 1`).bind(input.competitionId, actor.userId, scope).first<Row>();
  if (!unlock) throw new HttpError(409, 'This registration is not unlocked by an administrator', 'REGISTRATION_NOT_UNLOCKED');
  const existing = await env.REGISTRATION_DB.prepare(`SELECT id, status FROM registrations
    WHERE competition_id = ? AND club_id = ? AND COALESCE(team_profile_id, '') = ?`).bind(input.competitionId, actor.userId, scope).all<Row>();
  const existingIds = (existing.results || []).map(row => String(row.id));
  const prepared = [] as Array<{ registration: Row; athletes: Row[] }>;
  // 同一份替换清单会在删除旧记录前逐项预校验，预留计数防止多项合计绕过个人/集体限额。
  const quotaReservations = new Map<string, number>();
  const seenEntries = new Set<string>();
  const seenAthleteEvents = new Set<string>();
  for (const item of input.registrations) {
    const entryKey = `${item.eventId}:${item.groupId}:${[...item.athleteIds].sort().join(',')}`;
    if (seenEntries.has(entryKey)) throw new HttpError(409, 'Duplicate registration selections are not allowed', 'DUPLICATE_ENTRY');
    seenEntries.add(entryKey);
    for (const athleteId of item.athleteIds) {
      const athleteEventKey = `${athleteId}:${item.eventId}`;
      if (seenAthleteEvents.has(athleteEventKey)) throw new HttpError(409, 'An athlete may only enter an event once', 'DUPLICATE_ENTRY');
      seenAthleteEvents.add(athleteEventKey);
    }
    prepared.push(await buildClubRegistration(env, actor, item, existingIds, quotaReservations));
  }
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [env.REGISTRATION_DB.prepare(`UPDATE order_books SET is_stale = 1, stale_at = ? WHERE competition_id = ? AND is_current = 1`).bind(now, input.competitionId)];
  for (const row of existing.results || []) {
    const registrationId = String(row.id);
    statements.push(env.REGISTRATION_DB.prepare(`INSERT INTO registration_state_transitions
      (id,registration_type,registration_id,from_status,to_status,actor_type,actor_id,request_id,reason)
      VALUES (?,'club',? ,?,'rejected','club',?,?, 'club_registration_replaced')`).bind(crypto.randomUUID(), registrationId, row.status, actor.userId, requestId));
    statements.push(env.REGISTRATION_DB.prepare('DELETE FROM order_book_entries WHERE registration_id = ?').bind(registrationId));
    statements.push(env.REGISTRATION_DB.prepare('DELETE FROM registrations WHERE id = ? AND club_id = ?').bind(registrationId, actor.userId));
  }
  for (const item of prepared) {
    statements.push(env.REGISTRATION_DB.prepare(`INSERT INTO registrations
      (id,competition_id,club_id,team_profile_id,club_name,event_id,event_name,group_id,group_name,athletes,coach_id,coach_name,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(item.registration.id, item.registration.competition_id, item.registration.club_id, item.registration.team_profile_id, item.registration.club_name, item.registration.event_id, item.registration.event_name, item.registration.group_id, item.registration.group_name, item.registration.athletes, item.registration.coach_id, item.registration.coach_name, 'confirmed', now, now));
    for (const athlete of item.athletes) statements.push(env.REGISTRATION_DB.prepare('INSERT INTO registration_athletes (registration_id, athlete_id) VALUES (?, ?)').bind(item.registration.id, athlete.id));
    statements.push(env.REGISTRATION_DB.prepare(`INSERT INTO registration_state_transitions
      (id,registration_type,registration_id,from_status,to_status,actor_type,actor_id,request_id,reason)
      VALUES (?,'club',?,NULL,'confirmed','club',?,?, 'club_registration_replaced')`).bind(crypto.randomUUID(), item.registration.id, actor.userId, requestId));
  }
  statements.push(env.REGISTRATION_DB.prepare('DELETE FROM club_registration_edit_unlocks WHERE competition_id = ? AND club_id = ? AND team_scope = ?').bind(input.competitionId, actor.userId, scope));
  await env.REGISTRATION_DB.batch(statements);
  const data = { replaced: prepared.length, deleted: (existing.results || []).length, status: 'confirmed' };
  await saveResponse(env, actor.role, actor.userId, operation, key, 200, data);
  await audit(env, requestId, request, actor, operation, 'registrations', undefined, { competitionId: input.competitionId, teamProfileId: input.teamProfileId || null, replaced: prepared.length });
  return { status: 200, data };
}

export async function adminUnlockClubRegistration(request: Request, env: Env, actor: SessionPrincipal, requestId: string): Promise<{ status: number; data: unknown }> {
  const body = await readJson<Record<string, unknown>>(request, MAX_MUTATION_BYTES);
  const competitionId = requiredId(body.competitionId, 'competitionId');
  const clubId = requiredId(body.clubId, 'clubId');
  const teamProfileId = optionalId(body.teamProfileId, 'teamProfileId');
  const scope = teamProfileId || '';
  const count = await env.REGISTRATION_DB.prepare(`SELECT COUNT(*) AS total FROM registrations
    WHERE competition_id = ? AND club_id = ? AND COALESCE(team_profile_id, '') = ?`).bind(competitionId, clubId, scope).first<Row>();
  if (!Number(count?.total || 0)) throw new HttpError(404, 'No submitted registrations found for this team', 'NOT_FOUND');
  const now = new Date().toISOString();
  await env.REGISTRATION_DB.prepare(`INSERT INTO club_registration_edit_unlocks
    (competition_id,club_id,team_scope,unlocked_by,unlocked_at) VALUES (?,?,?,?,?)
    ON CONFLICT(competition_id,club_id,team_scope) DO UPDATE SET unlocked_by=excluded.unlocked_by, unlocked_at=excluded.unlocked_at`).bind(competitionId, clubId, scope, actor.userId, now).run();
  await audit(env, requestId, request, actor, 'admin.club_registration.unlock', 'registrations', undefined, { competitionId, clubId, teamProfileId: teamProfileId || null });
  return { status: 200, data: { competitionId, clubId, teamProfileId, unlocked: true, unlockedAt: now } };
}

export async function updateClubRegistration(request: Request, env: Env, actor: SessionPrincipal, registrationId: string, requestId: string): Promise<{ status: number; data: unknown }> {
  const key = idempotencyKey(request); const operation = 'club.registration.update';
  const cached = await cachedResponse(env, actor.role, actor.userId, `${operation}:${registrationId}`, key); if (cached) return cached;
  const existing = await env.REGISTRATION_DB.prepare('SELECT * FROM registrations WHERE id = ? AND club_id = ?').bind(registrationId, actor.userId).first<Row>();
  if (!existing) throw new HttpError(404, 'Registration not found', 'NOT_FOUND');
  if (existing.status !== 'pending') throw new HttpError(409, 'Only pending registrations may be edited; rejected registrations must be resubmitted', 'REGISTRATION_IMMUTABLE');
  const body = await readJson<Record<string, unknown>>(request, MAX_MUTATION_BYTES);
  if ('competitionId' in body || 'eventId' in body || 'groupId' in body || 'teamProfileId' in body) throw new HttpError(422, 'Competition, event, group, and team are immutable after submission', 'IMMUTABLE_FIELD');
  const athleteIds = Array.isArray(body.athleteIds) ? body.athleteIds.map(value => requiredId(value, 'athleteIds')) : null;
  const coachId = body.coachId === undefined ? undefined : optionalId(body.coachId, 'coachId');
  if (!athleteIds && coachId === undefined) throw new HttpError(422, 'Only athleteIds and coachId can be updated', 'EMPTY_UPDATE');
  if (athleteIds && (!athleteIds.length || athleteIds.length > 50 || new Set(athleteIds).size !== athleteIds.length)) throw new HttpError(422, 'athleteIds must contain 1-50 unique IDs', 'INVALID_ATHLETES');
  const statements: D1PreparedStatement[] = []; const now = new Date().toISOString();
  if (athleteIds) {
    const validation = await buildClubRegistration(env, actor, { competitionId: String(existing.competition_id), eventId: String(existing.event_id), groupId: String(existing.group_id), athleteIds, coachId: coachId === undefined ? String(existing.coach_id || '') || undefined : coachId || undefined, teamProfileId: String(existing.team_profile_id || '') || undefined }, [registrationId], undefined, { lockDeadline: false });
    statements.push(env.REGISTRATION_DB.prepare('DELETE FROM registration_athletes WHERE registration_id = ?').bind(registrationId));
    for (const athlete of validation.athletes) statements.push(env.REGISTRATION_DB.prepare('INSERT INTO registration_athletes (registration_id, athlete_id) VALUES (?, ?)').bind(registrationId, athlete.id));
    statements.push(env.REGISTRATION_DB.prepare('UPDATE registrations SET athletes = ?, coach_id = ?, coach_name = ?, updated_at = ? WHERE id = ? AND status = \'pending\'').bind(validation.registration.athletes, validation.registration.coach_id, validation.registration.coach_name, now, registrationId));
  } else if (coachId !== undefined) {
    let coachName: string | null = null;
    if (coachId) { const coach = await env.REGISTRATION_DB.prepare('SELECT name FROM coaches WHERE id = ? AND club_id = ? AND competition_id = ?').bind(coachId, actor.userId, existing.competition_id).first<Row>(); if (!coach) throw new HttpError(422, 'Coach does not belong to this club and competition', 'INVALID_OWNED_REFERENCE'); coachName = String(coach.name); }
    statements.push(env.REGISTRATION_DB.prepare('UPDATE registrations SET coach_id = ?, coach_name = ?, updated_at = ? WHERE id = ? AND status = \'pending\'').bind(coachId, coachName, now, registrationId));
  }
  await env.REGISTRATION_DB.batch(statements); const data = { id: registrationId, status: 'pending' }; await saveResponse(env, actor.role, actor.userId, `${operation}:${registrationId}`, key, 200, data); await audit(env, requestId, request, actor, operation, 'registrations', registrationId); return { status: 200, data };
}

export async function resubmitClubRegistration(request: Request, env: Env, actor: SessionPrincipal, registrationId: string, requestId: string): Promise<{ status: number; data: unknown }> {
  const key = idempotencyKey(request); const operation = `club.registration.resubmit:${registrationId}`; const cached = await cachedResponse(env, actor.role, actor.userId, operation, key); if (cached) return cached;
  const existing = await env.REGISTRATION_DB.prepare('SELECT * FROM registrations WHERE id = ? AND club_id = ?').bind(registrationId, actor.userId).first<Row>();
  if (!existing) throw new HttpError(404, 'Registration not found', 'NOT_FOUND'); if (existing.status !== 'rejected') throw new HttpError(409, 'Only rejected registrations may be resubmitted', 'INVALID_STATE_TRANSITION');
  assertCompetitionOpen(await getCompetition(env, String(existing.competition_id)));
  const result = await env.REGISTRATION_DB.batch([env.REGISTRATION_DB.prepare(`UPDATE registrations SET status = 'pending', reject_reason = NULL, updated_at = ? WHERE id = ? AND club_id = ? AND status = 'rejected'`).bind(new Date().toISOString(), registrationId, actor.userId), env.REGISTRATION_DB.prepare(`INSERT INTO registration_state_transitions (id,registration_type,registration_id,from_status,to_status,actor_type,actor_id,request_id) VALUES (?,'club',?,'rejected','pending','club',?,?)`).bind(crypto.randomUUID(), registrationId, actor.userId, requestId)]);
  if (!result[0].meta?.changes) throw new HttpError(409, 'Registration state changed; reload before resubmitting', 'STATE_CONFLICT'); const data = { id: registrationId, status: 'pending' }; await saveResponse(env, actor.role, actor.userId, operation, key, 200, data); await audit(env, requestId, request, actor, operation, 'registrations', registrationId); return { status: 200, data };
}

export async function deleteClubRegistration(request: Request, env: Env, actor: SessionPrincipal, registrationId: string, requestId: string): Promise<{ status: number; data: unknown }> {
  const existing = await env.REGISTRATION_DB.prepare('SELECT status FROM registrations WHERE id = ? AND club_id = ?').bind(registrationId, actor.userId).first<Row>();
  if (!existing) throw new HttpError(404, 'Registration not found', 'NOT_FOUND'); if (existing.status !== 'pending' && existing.status !== 'rejected') throw new HttpError(409, 'Confirmed registrations can only be withdrawn through the cancel-registration workflow', 'REGISTRATION_IMMUTABLE');
  await env.REGISTRATION_DB.prepare(`DELETE FROM registrations WHERE id = ? AND club_id = ? AND status IN ('pending','rejected')`).bind(registrationId, actor.userId).run(); await audit(env, requestId, request, actor, 'club.registration.delete', 'registrations', registrationId); return { status: 200, data: { id: registrationId, deleted: true } };
}

export async function cancelClubRegistrations(request: Request, env: Env, actor: SessionPrincipal, requestId: string): Promise<{ status: number; data: unknown }> {
  const body = await readJson<Record<string, unknown>>(request, MAX_MUTATION_BYTES);
  const competitionId = requiredId(body.competitionId, 'competitionId');
  const teamProfileId = optionalId(body.teamProfileId, 'teamProfileId');
  const rows = await env.REGISTRATION_DB.prepare(`SELECT id FROM registrations WHERE club_id = ? AND competition_id = ? AND COALESCE(team_profile_id, '') = COALESCE(?, '') AND status IN ('pending','confirmed','rejected')`).bind(actor.userId, competitionId, teamProfileId).all<Row>();
  const ids = (rows.results || []).map(row => String(row.id));
  if (!ids.length) return { status: 200, data: { deleted: 0, ids: [] } };
  const statements: D1PreparedStatement[] = [];
  for (const id of ids) {
    statements.push(env.REGISTRATION_DB.prepare(`INSERT INTO registration_state_transitions (id,registration_type,registration_id,from_status,to_status,actor_type,actor_id,request_id,reason) SELECT ?, 'club', id, status, 'rejected', 'club', ?, ?, 'club_cancelled' FROM registrations WHERE id = ?`).bind(crypto.randomUUID(), actor.userId, requestId, id));
    statements.push(env.REGISTRATION_DB.prepare('DELETE FROM order_book_entries WHERE registration_id = ?').bind(id));
    statements.push(env.REGISTRATION_DB.prepare('DELETE FROM registrations WHERE id = ? AND club_id = ?').bind(id, actor.userId));
  }
  await env.REGISTRATION_DB.batch(statements);
  for (const id of ids) await audit(env, requestId, request, actor, 'club.registration.cancel', 'registrations', id);
  return { status: 200, data: { deleted: ids.length, ids } };
}

function parseReview(requestBody: Record<string, unknown>): { registrationType: ReviewType; action: ReviewAction; rejectReason: string | null; ids: string[] } {
  const action = requestBody.action === 'confirmed' || requestBody.action === 'rejected' ? requestBody.action : null;
  if (!action) throw new HttpError(422, 'action is required', 'INVALID_REVIEW'); const rejectReason = action === 'rejected' ? requiredText(requestBody.rejectReason, 'rejectReason', 1000) : null; const ids = Array.isArray(requestBody.ids) ? requestBody.ids.map(value => requiredId(value, 'ids')) : [];
  if (!ids.length || ids.length > MAX_REVIEW_IDS || new Set(ids).size !== ids.length) throw new HttpError(422, `ids must contain 1-${MAX_REVIEW_IDS} unique IDs`, 'INVALID_REVIEW'); return { registrationType: 'club', action, rejectReason, ids };
}
export async function reviewBatch(request: Request, env: Env, actor: SessionPrincipal, requestId: string): Promise<{ status: number; data: unknown }> {
  const key = idempotencyKey(request); const body = await readJson<Record<string, unknown>>(request, MAX_MUTATION_BYTES); const input = parseReview(body); const operation = `admin.review.batch:${input.registrationType}`; const cached = await cachedResponse(env, actor.role, actor.userId, operation, key); if (cached) return cached;
  const table = 'registrations'; const jobId = crypto.randomUUID(); const now = new Date().toISOString(); const statements: D1PreparedStatement[] = [env.REGISTRATION_DB.prepare(`INSERT INTO review_jobs (id,registration_type,competition_id,requested_action,reject_reason,requested_by,request_id,total_count,status,completed_at) VALUES (?,?,?,?,?,?,?,?,?,'completed',?)`).bind(jobId,input.registrationType,typeof body.competitionId === 'string' ? body.competitionId : null,input.action,input.rejectReason,actor.userId,requestId,input.ids.length,now)];
  for (const registrationId of input.ids) { const transitionId = crypto.randomUUID(); statements.push(env.REGISTRATION_DB.prepare(`INSERT INTO registration_state_transitions (id,registration_type,registration_id,from_status,to_status,reason,actor_type,actor_id,request_id)
    SELECT ?,'${input.registrationType}',id,status,?,?, 'admin', ?, ? FROM ${table} WHERE id = ? AND status = 'pending'`).bind(transitionId,input.action,input.rejectReason,actor.userId,requestId,registrationId));
    const updateSql = `UPDATE registrations SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'`;
    const updateValues = [input.action, input.rejectReason, now, registrationId];
    statements.push(env.REGISTRATION_DB.prepare(updateSql).bind(...updateValues)); statements.push(env.REGISTRATION_DB.prepare(`INSERT INTO review_job_items (job_id,registration_id,result,detail) VALUES (?,?,CASE WHEN EXISTS(SELECT 1 FROM registration_state_transitions WHERE id = ?) THEN 'updated' ELSE 'skipped' END,CASE WHEN EXISTS(SELECT 1 FROM registration_state_transitions WHERE id = ?) THEN NULL ELSE 'not_pending_or_not_found' END)`).bind(jobId,registrationId,transitionId,transitionId)); }
  statements.push(env.REGISTRATION_DB.prepare(`UPDATE review_jobs SET processed_count = (SELECT COUNT(*) FROM review_job_items WHERE job_id = ? AND result = 'updated'), skipped_count = (SELECT COUNT(*) FROM review_job_items WHERE job_id = ? AND result = 'skipped') WHERE id = ?`).bind(jobId,jobId,jobId)); await env.REGISTRATION_DB.batch(statements); const items = await env.REGISTRATION_DB.prepare('SELECT registration_id, result, detail FROM review_job_items WHERE job_id = ? ORDER BY registration_id').bind(jobId).all<Row>(); const data = { jobId, registrationType: input.registrationType, action: input.action, results: items.results || [] }; await saveResponse(env, actor.role, actor.userId, operation, key, 200, data); await audit(env, requestId, request, actor, operation, 'review_jobs', jobId, { count: input.ids.length }); return { status: 200, data };
}

export async function getClubRegistrationEditState(request: Request, env: Env, actor: SessionPrincipal): Promise<{ status: number; data: unknown }> {
  const url = new URL(request.url);
  const competitionId = requiredId(url.searchParams.get('competitionId'), 'competitionId');
  const teamProfileId = optionalId(url.searchParams.get('teamProfileId'), 'teamProfileId');
  const scope = teamProfileId || '';
  const unlocked = await env.REGISTRATION_DB.prepare(`SELECT unlocked_at FROM club_registration_edit_unlocks
    WHERE competition_id = ? AND club_id = ? AND team_scope = ? LIMIT 1`).bind(competitionId, actor.userId, scope).first<Row>();
  return { status: 200, data: { unlocked: Boolean(unlocked), unlockedAt: unlocked?.unlocked_at || null } };
}

export async function listAdminRegistrations(request: Request, env: Env): Promise<{ status: number; data: unknown }> {
  const url = new URL(request.url); const competitionId = requiredId(url.searchParams.get('competitionId'), 'competitionId'); const page = Math.max(1, Number(url.searchParams.get('page') || '1')); const pageSize = Number(url.searchParams.get('pageSize') || '50'); if (!Number.isInteger(page) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new HttpError(422, `pageSize must be 1-${MAX_PAGE_SIZE}`, 'INVALID_PAGINATION');
  const filters: string[] = ['r.competition_id = ?']; const values: unknown[] = [competitionId]; for (const [param,column] of [['status','r.status'],['eventId','r.event_id'],['groupId','r.group_id'],['clubId','r.club_id']] as const) { const value = url.searchParams.get(param); if (value) { filters.push(`${column} = ?`); values.push(requiredId(value,param)); } }
  const where = `WHERE ${filters.join(' AND ')}`; const count = await env.REGISTRATION_DB.prepare(`SELECT COUNT(*) AS total FROM registrations r ${where}`).bind(...values).first<Row>(); const rows = await env.REGISTRATION_DB.prepare(`SELECT r.*, CASE WHEN u.competition_id IS NULL THEN 0 ELSE 1 END AS edit_unlocked, u.unlocked_at
    FROM registrations r LEFT JOIN club_registration_edit_unlocks u ON u.competition_id = r.competition_id AND u.club_id = r.club_id AND u.team_scope = COALESCE(r.team_profile_id, '')
    ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`).bind(...values,pageSize,(page - 1) * pageSize).all<Row>(); const items = (rows.results || []).map(row => ({ ...row, athletes: parseAthletes(row.athletes) })); return { status: 200, data: { items, page, pageSize, total: Number(count?.total || 0) } };
}

export async function getCurrentOrderBook(request: Request, env: Env): Promise<{ status: number; data: unknown }> {
  const url = new URL(request.url);
  const competitionId = requiredId(url.searchParams.get('competitionId'), 'competitionId');
  const book = await env.REGISTRATION_DB.prepare(`SELECT id, version, status, is_stale, entry_count, generated_at, published_at
    FROM order_books WHERE competition_id = ? AND is_current = 1 LIMIT 1`).bind(competitionId).first<Row>();
  if (!book) return { status: 200, data: { entries: [], book: null } };
  const rows = await env.REGISTRATION_DB.prepare(`SELECT id, competition_id, event_id, event_name, group_id, group_name,
    start_order, bib_number, session_label, session_number, venue_number, club_id, club_name, athletes, coach_name
    FROM order_book_entries WHERE order_book_id = ? ORDER BY start_order ASC LIMIT 5000`).bind(book.id).all<Row>();
  const entries = (rows.results || []).map(row => ({ ...row, athletes: typeof row.athletes === 'string' ? JSON.parse(String(row.athletes)) : row.athletes }));
  return { status: 200, data: { book, entries } };
}

export async function importScorecardOrderBook(request: Request, env: Env, actor: SessionPrincipal, requestId: string): Promise<{ status: number; data: unknown }> {
  const body = await readJson<Record<string, unknown>>(request, 16 * 1024);
  const competitionId = requiredId(body.competitionId, 'competitionId');
  const book = await env.REGISTRATION_DB.prepare(`SELECT id, version, status, is_current, is_stale, entry_count
    FROM order_books WHERE competition_id = ? AND is_current = 1 AND status = 'published' LIMIT 1`).bind(competitionId).first<Row>();
  if (!book) throw new HttpError(409, '请先生成并发布出场顺序', 'ORDER_BOOK_NOT_PUBLISHED');
  const existing = await env.REGISTRATION_DB.prepare('SELECT id, is_current, status FROM scorecard_imports WHERE competition_id = ? AND source_order_book_id = ? LIMIT 1').bind(competitionId, book.id).first<Row>();
  if (existing) {
    // 复用：把曾经取消发布（status=unpublished/is_current=0）的记录重新激活
    if (!existing.is_current || existing.status !== 'published') {
      await env.REGISTRATION_DB.prepare(`UPDATE scorecard_imports SET is_current = 0 WHERE competition_id = ?`).bind(competitionId).run();
      await env.REGISTRATION_DB.prepare(`UPDATE scorecard_imports SET is_current = 1, status = 'published', imported_at = ?, imported_by = ? WHERE id = ?`).bind(new Date().toISOString(), actor.userId, existing.id).run();
      await audit(env, requestId, request, actor, 'admin.scorecards.republish', 'scorecard_imports', String(existing.id), { competitionId, sourceOrderBookId: book.id });
    }
    const count = Number(book.entry_count || 0);
    return { status: 200, data: { id: existing.id, competitionId, sourceOrderBookId: book.id, sourceOrderBookVersion: Number(book.version || 0), entryCount: count, reused: true } };
  }
  const rows = await env.REGISTRATION_DB.prepare(`SELECT obe.id AS order_book_entry_id, obe.registration_id, obe.competition_id,
      obe.club_id, obe.club_name, obe.event_name, obe.group_name, obe.session_label, obe.session_number, obe.venue_number,
      obe.athletes, r.team_profile_id, tp.team_name
    FROM order_book_entries obe
    LEFT JOIN registrations r ON r.id = obe.registration_id
    LEFT JOIN team_profiles tp ON tp.id = r.team_profile_id
    WHERE obe.order_book_id = ? ORDER BY obe.start_order ASC`).bind(book.id).all<Row>();
  const importId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.REGISTRATION_DB.prepare(`UPDATE scorecard_imports SET is_current = 0 WHERE competition_id = ?`).bind(competitionId),
    env.REGISTRATION_DB.prepare(`INSERT INTO scorecard_imports (id,competition_id,source_order_book_id,source_order_book_version,status,is_current,entry_count,imported_by,imported_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(importId, competitionId, book.id, Number(book.version || 0), 'published', 1, rows.results?.length || 0, actor.userId, now),
  ];
  for (const row of rows.results || []) {
    statements.push(env.REGISTRATION_DB.prepare(`INSERT INTO scorecard_entries (id,scorecard_import_id,competition_id,order_book_entry_id,registration_id,team_profile_id,club_id,club_name,team_name,event_name,group_name,session_label,session_number,venue_number,athlete_names) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      crypto.randomUUID(), importId, competitionId, row.order_book_entry_id, row.registration_id, row.team_profile_id || null, row.club_id, row.club_name, row.team_name || null, row.event_name, row.group_name, row.session_label, Number(row.session_number || 0), Number(row.venue_number || 0), JSON.stringify(athleteNames(row.athletes)), 
    ));
  }
  for (let index = 0; index < statements.length; index += 100) await env.REGISTRATION_DB.batch(statements.slice(index, index + 100));
  await audit(env, requestId, request, actor, 'admin.scorecards.import', 'scorecard_imports', importId, { competitionId, sourceOrderBookId: book.id, entryCount: rows.results?.length || 0 });
  return { status: 201, data: { id: importId, competitionId, sourceOrderBookId: book.id, sourceOrderBookVersion: Number(book.version || 0), entryCount: rows.results?.length || 0, reused: false } };
}

export async function unpublishScorecardImport(env: Env, actor: SessionPrincipal, competitionId: string, requestId: string, request: Request): Promise<{ status: number; data: unknown }> {
  const existing = await env.REGISTRATION_DB.prepare('SELECT id FROM scorecard_imports WHERE competition_id = ? AND is_current = 1 LIMIT 1').bind(competitionId).first<Row>();
  if (!existing) throw new HttpError(404, '当前没有已发布的计分表数据', 'NO_CURRENT_IMPORT');
  const importId = String(existing.id);
  await env.REGISTRATION_DB.prepare(`UPDATE scorecard_imports SET is_current = 0, status = 'unpublished' WHERE id = ?`).bind(importId).run();
  await audit(env, requestId, request, actor, 'admin.scorecards.unpublish', 'scorecard_imports', importId, { competitionId });
  return { status: 200, data: { id: importId, competitionId, unpublished: true } };
}

export async function getCurrentScorecardImport(request: Request, env: Env, competitionId: string): Promise<{ status: number; data: unknown }> {
  const imported = await env.REGISTRATION_DB.prepare(`SELECT id, competition_id, source_order_book_id, source_order_book_version, status, entry_count, imported_at
    FROM scorecard_imports WHERE competition_id = ? AND is_current = 1 LIMIT 1`).bind(competitionId).first<Row>();
  return { status: 200, data: { import: imported || null } };
}

export async function getClubScorecardEntries(request: Request, env: Env, actor: SessionPrincipal): Promise<{ status: number; data: unknown }> {
  const url = new URL(request.url);
  const competitionId = requiredId(url.searchParams.get('competitionId'), 'competitionId');
  const teamProfileId = optionalId(url.searchParams.get('teamProfileId'), 'teamProfileId');
  const athleteName = (url.searchParams.get('athleteName') || '').trim().slice(0, 64);
  const imported = await env.REGISTRATION_DB.prepare(`SELECT id, source_order_book_version, entry_count, imported_at
    FROM scorecard_imports WHERE competition_id = ? AND is_current = 1 AND status = 'published' LIMIT 1`).bind(competitionId).first<Row>();
  if (!imported) return { status: 200, data: { import: null, entries: [] } };
  if (!teamProfileId) throw new HttpError(422, 'teamProfileId is required for club scorecard queries', 'TEAM_REQUIRED');
  const filters = ['se.competition_id = ?', 'se.club_id = ?', 'se.team_profile_id = ?', 'se.scorecard_import_id = ?'];
  const values: unknown[] = [competitionId, actor.userId, teamProfileId, imported.id];
  const rows = await env.REGISTRATION_DB.prepare(`SELECT id, competition_id, registration_id, team_profile_id, club_name, team_name, event_name, group_name, session_label, session_number, venue_number, athlete_names
    FROM scorecard_entries se WHERE ${filters.join(' AND ')} ORDER BY session_number ASC, venue_number ASC, id ASC`).bind(...values).all<Row>();
  const entries = (rows.results || []).map(row => ({ ...row, athlete_names: athleteNames(row.athlete_names) })).filter(row => {
    if (!athleteName) return true;
    return (row.athlete_names as string[]).some(name => name.includes(athleteName));
  });
  return { status: 200, data: { import: imported, entries } };
}

export async function generateOrderBook(request: Request, env: Env, actor: SessionPrincipal, requestId: string): Promise<{ status: number; data: unknown }> {
  const body = await readJson<Record<string, unknown>>(request, 16 * 1024); const competitionId = requiredId(body.competitionId, 'competitionId'); const venueCount = Number(body.venueCount || 8); if (!Number.isInteger(venueCount) || venueCount < 1 || venueCount > 100) throw new HttpError(422, 'venueCount must be 1-100', 'INVALID_FIELD'); const key = idempotencyKey(request); const operation = `admin.orderbook.generate:${competitionId}`; const cached = await cachedResponse(env, actor.role, actor.userId, operation, key); if (cached) return cached;
  const token = crypto.randomUUID(); const now = new Date().toISOString(); const lock = await env.REGISTRATION_DB.prepare(`INSERT INTO order_generation_locks (competition_id,lock_token,locked_by,acquired_at,expires_at) VALUES (?,?,?,?,?)
    ON CONFLICT(competition_id) DO UPDATE SET lock_token=excluded.lock_token, locked_by=excluded.locked_by, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at WHERE order_generation_locks.expires_at < excluded.acquired_at RETURNING lock_token`).bind(competitionId,token,actor.userId,now,new Date(Date.now() + 5 * 60_000).toISOString()).first<Row>();
  if (!lock || lock.lock_token !== token) throw new HttpError(409, 'Order generation is already running for this competition', 'ORDER_GENERATION_LOCKED');
  try {
    const competition = await getCompetition(env, competitionId); const versions = await env.REGISTRATION_DB.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM order_books WHERE competition_id = ?').bind(competitionId).first<Row>(); const orderBookId = crypto.randomUUID(); const version = Number(versions?.version || 0) + 1;
    await env.REGISTRATION_DB.prepare(`INSERT INTO order_books (id,competition_id,version,status,is_current,is_stale,generated_by,generated_at) VALUES (?,?,?,'building',0,0,?,?)`).bind(orderBookId,competitionId,version,actor.userId,now).run();
    const registrations = await env.REGISTRATION_DB.prepare(`SELECT r.* FROM registrations r JOIN events e ON e.id = r.event_id JOIN event_groups g ON g.id = r.group_id WHERE r.competition_id = ? AND r.status = 'confirmed' ORDER BY e.order_index ASC, g.age_min ASC, g.age_max ASC, CASE g.gender WHEN 'male' THEN 1 WHEN 'female' THEN 2 ELSE 3 END ASC, g.order_index ASC, r.created_at ASC, r.id ASC`).bind(competitionId).all<Row>();
    const rows = registrations.results || []; let order = 1; let session = 1; let venue = 1; let currentEventId = ''; const statements: D1PreparedStatement[] = [];
    for (const registration of rows) {
      // 切换项目时，无论上一项目使用了多少场地，均从下一场次的 1 号场地重新开始。
      if (currentEventId && currentEventId !== String(registration.event_id)) {
        if (venue !== 1) session += 1;
        venue = 1;
      }
      currentEventId = String(registration.event_id);
      const label = `${session}-${venue}`;
      statements.push(env.REGISTRATION_DB.prepare(`INSERT INTO order_book_entries (id,order_book_id,registration_id,competition_id,event_id,event_name,group_id,group_name,start_order,session_label,session_number,venue_number,bib_number,club_id,club_name,athletes,coach_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),orderBookId,registration.id,competitionId,registration.event_id,registration.event_name,registration.group_id,registration.group_name,order,label,session,venue,label,registration.club_id,registration.club_name,registration.athletes,registration.coach_name));
      order += 1;
      venue += 1;
      if (venue > venueCount) { session += 1; venue = 1; }
    }
    for (let index = 0; index < statements.length; index += 100) await env.REGISTRATION_DB.batch(statements.slice(index,index + 100));
    await env.REGISTRATION_DB.batch([env.REGISTRATION_DB.prepare(`UPDATE order_books SET is_current = 0 WHERE competition_id = ? AND is_current = 1`).bind(competitionId), env.REGISTRATION_DB.prepare(`UPDATE order_books SET status = 'published', is_current = 1, is_stale = 0, entry_count = ?, published_at = ? WHERE id = ? AND status = 'building'`).bind(rows.length,new Date().toISOString(),orderBookId)]);
    const data = { id: orderBookId, competitionId, version, entryCount: rows.length, status: 'published', stale: false, competition: competition.name }; await saveResponse(env, actor.role, actor.userId, operation, key, 201, data); await audit(env, requestId, request, actor, operation, 'order_books', orderBookId, { version, entryCount: rows.length }); return { status: 201, data };
  } catch (error) { throw error; } finally { await env.REGISTRATION_DB.prepare('DELETE FROM order_generation_locks WHERE competition_id = ? AND lock_token = ?').bind(competitionId,token).run(); }
}
