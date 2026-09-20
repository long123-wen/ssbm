#!/usr/bin/env node
/**
 * force_open（特殊情况强制开放）端到端验证。
 *
 * 场景：
 *   F1  status=open + deadline=昨天 + force_open=0 → create 应 409 DEADLINE_PASSED
 *   F2  同上但 force_open=1                        → create 应 201
 *   F3  还原 force_open=0                          → create 再被挡 409
 *
 * 复用 e2e club（e2e_club_a）与真实比赛（有 event/group 的 open 比赛），
 * 结束后把 deadline/status/force_open 还原并清空测试报名。
 *
 * 运行：node scripts/test-force-open-e2e.mjs
 */
import process from 'node:process';

const BASE_URL = (process.env.BASE_URL || 'https://www.dztsbmxt.top').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || '17653420201';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Dztsbmxt@2026';
const CLUB_USER = process.env.CLUB_USER || 'e2e_club_a';
const CLUB_PASS = process.env.CLUB_PASS || 'E2eClubA@2026';
// 原始比赛截止时间（测试完还原）
const ORIGINAL_DEADLINE = process.env.ORIGINAL_DEADLINE || '2026-09-19';

const TODAY = new Date();
const YESTERDAY = new Date(TODAY.getTime() - 24 * 3600 * 1000);
const YESTERDAY_ISO = YESTERDAY.toISOString().slice(0, 10);

function ts(label) { return `\x1b[36m[${label}]\x1b[0m`; }
function pass(msg) { console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.error(`\x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  ${msg}`); }

async function login(role, username, password) {
  const res = await fetch(`${BASE_URL}/api/auth/${role}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${role} failed: ${res.status} ${await res.text().catch(() => '')}`);
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  // 按角色拆分的 cookie：admin → __Host-rj_admin_session，club → __Host-rj_club_session（兼容 legacy __Host-rj_session）
  const cookie = setCookie.find(c => c && c.startsWith('__Host-rj_')) || '';
  const token = cookie.match(/__Host-rj_[a-z_]*session=([^;]+)/);
  if (!token) throw new Error(`login ${role}: no session cookie`);
  return decodeURIComponent(token[1]);
}

async function queryData(table, payload, token) {
  const res = await fetch(`${BASE_URL}/api/data/${table}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-rj_session=${token}` },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`query ${table} failed: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json.data;
}

async function postRegistration(body, token) {
  const res = await fetch(`${BASE_URL}/api/club/registrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-rj_session=${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function cleanRegistrations(clubToken, competitionId) {
  const res = await fetch(`${BASE_URL}/api/club/registrations`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-rj_session=${clubToken}` },
    body: JSON.stringify({ competitionId }),
  });
  if (!res.ok && res.status !== 200) info(`cleanRegistrations: ${res.status}（可能本就为空）`);
}

async function setForceOpen(adminToken, competitionId, value) {
  await queryData('competitions', {
    action: 'update',
    filters: [{ op: 'eq', column: 'id', value: competitionId }],
    payload: { force_open: value ? 1 : 0 },
  }, adminToken);
}

async function setCompDeadline(adminToken, competitionId, deadline, status) {
  const payload = { registration_deadline: deadline };
  if (status !== undefined) payload.status = status;
  await queryData('competitions', {
    action: 'update',
    filters: [{ op: 'eq', column: 'id', value: competitionId }],
    payload,
  }, adminToken);
}

async function main() {
  console.log(`${ts('CONFIG')} BASE_URL=${BASE_URL} yesterday=${YESTERDAY_ISO}`);

  const adminToken = await login('admin', ADMIN_USER, ADMIN_PASS);
  info('admin logged in');
  const clubToken = await login('club', CLUB_USER, CLUB_PASS);
  info('club logged in');

  // 找 e2e club
  const clubs = await queryData('clubs', {
    action: 'select', columns: 'id,username',
    filters: [{ op: 'eq', column: 'username', value: CLUB_USER }], limit: 1,
  }, adminToken);
  if (!clubs?.length) throw new Error(`club not found: ${CLUB_USER}`);
  const clubId = clubs[0].id;

  // 找一个有 event+group 的比赛（优先 [DEADLINE-E2E]，其次真实比赛）
  let comp = null;
  {
    const list = await queryData('competitions', {
      action: 'select', columns: 'id,name,status,registration_deadline,force_open',
      filters: [{ op: 'eq', column: 'status', value: 'open' }], limit: 20,
    }, adminToken);
    for (const c of (list || [])) {
      const evs = await queryData('events', {
        action: 'select', columns: 'id', filters: [{ op: 'eq', column: 'competition_id', value: c.id }], limit: 1,
      }, adminToken);
      if (evs?.length) { comp = c; break; }
    }
  }
  if (!comp) throw new Error('no competition with events found');
  info(`用比赛: ${comp.id} (${comp.name}) deadline=${comp.registration_deadline} force_open=${comp.force_open}`);

  const events = await queryData('events', {
    action: 'select', columns: 'id,name', filters: [{ op: 'eq', column: 'competition_id', value: comp.id }], limit: 1,
  }, adminToken);
  const eventId = events[0].id;
  const groups = await queryData('event_groups', {
    action: 'select', columns: 'id,name', filters: [{ op: 'eq', column: 'event_id', value: eventId }], limit: 1,
  }, adminToken);
  const groupId = groups[0].id;
  info(`event=${eventId} group=${groupId}`);

  // e2e athlete
  const athletes = await queryData('athletes', {
    action: 'select', columns: 'id,name', filters: [{ op: 'eq', column: 'club_id', value: clubId }], limit: 1,
  }, adminToken);
  let athleteId;
  if (athletes?.length) athleteId = athletes[0].id;
  else {
    athleteId = crypto.randomUUID();
    await queryData('athletes', {
      action: 'insert',
      payload: { id: athleteId, club_id: clubId, competition_id: comp.id, name: 'E2E 测试员', gender: 'male', birth_date: '2018-01-01', id_card: `E2E${Date.now()}` },
    }, adminToken);
  }
  info(`athlete=${athleteId}`);

  const createBody = { competitionId: comp.id, eventId, groupId, athleteIds: [athleteId] };

  // ===== 准备：deadline=昨天，status=open，force_open=0 =====
  await setCompDeadline(adminToken, comp.id, YESTERDAY_ISO, 'open');
  await setForceOpen(adminToken, comp.id, 0);
  await cleanRegistrations(clubToken, comp.id);

  // F1: 已过截止 + 无强制开放 → 409
  const r1 = await postRegistration(createBody, clubToken);
  if (r1.status === 409 && r1.body?.error?.code === 'DEADLINE_PASSED') pass(`F1 已过截止且 force_open=0 → 409 DEADLINE_PASSED ✓`);
  else fail(`F1 期望 409 DEADLINE_PASSED，实际 ${r1.status} ${JSON.stringify(r1.body).slice(0, 200)}`);

  // F2: 强制开放 → 201
  await setForceOpen(adminToken, comp.id, 1);
  const r2 = await postRegistration(createBody, clubToken);
  if (r2.status === 201) pass(`F2 force_open=1（已过截止）→ 201 创建成功 ✓`);
  else fail(`F2 期望 201，实际 ${r2.status} ${JSON.stringify(r2.body).slice(0, 200)}`);

  // F3: 取消强制开放 → 再挡
  await cleanRegistrations(clubToken, comp.id);
  await setForceOpen(adminToken, comp.id, 0);
  const r3 = await postRegistration(createBody, clubToken);
  if (r3.status === 409) pass(`F3 force_open 恢复 0 → 409 重新被挡 ✓`);
  else fail(`F3 期望 409，实际 ${r3.status} ${JSON.stringify(r3.body).slice(0, 200)}`);

  // ===== 还原 =====
  await cleanRegistrations(clubToken, comp.id);
  // 还原比赛：若是真实比赛恢复原 deadline/open；e2e 比赛也一并还原 force_open
  const orig = comp.registration_deadline || ORIGINAL_DEADLINE;
  await setCompDeadline(adminToken, comp.id, orig, comp.status || 'open');
  await setForceOpen(adminToken, comp.id, 0);
  info(`已还原比赛 deadline=${orig} status=${comp.status || 'open'} force_open=0`);

  if (process.exitCode === 1) console.error(`\n\x1b[31m✗ force_open e2e FAILED\x1b[0m`);
  else console.log(`\n\x1b[32m✓ force_open e2e PASSED\x1b[0m`);
}

main().catch(err => { console.error(err); process.exit(1); });
