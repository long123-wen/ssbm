#!/usr/bin/env node
/**
 * datetime 截止时间端到端验证（临时脚本）：
 *   D1 deadline='过去时刻'（datetime）→ create 应 409 DEADLINE_PASSED
 *   D2 deadline='未来时刻'（datetime）→ create 应 201
 * 结束后还原比赛 deadline=2026-09-19 / force_open=0，并清空测试报名。
 */
import process from 'node:process';

const BASE_URL = process.env.BASE_URL || 'https://www.dztsbmxt.top';
const ADMIN_USER = '17653420201';
const ADMIN_PASS = 'Dztsbmxt@2026';
const CLUB_USER = 'e2e_club_a';
const CLUB_PASS = 'E2eClubA@2026';

function pass(m) { console.log(`\x1b[32m✓\x1b[0m ${m}`); }
function fail(m) { console.error(`\x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1; }
function info(m) { console.log(`  ${m}`); }

async function login(role, username, password) {
  const res = await fetch(`${BASE_URL}/api/auth/${role}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${role} failed: ${res.status}`);
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const cookie = setCookie.find(c => c && c.startsWith('__Host-rj_')) || '';
  const token = cookie.match(/__Host-rj_[a-z_]*session=([^;]+)/);
  if (!token) throw new Error(`login ${role}: no cookie`);
  return decodeURIComponent(token[1]);
}

async function queryData(table, payload, token) {
  const res = await fetch(`${BASE_URL}/api/data/${table}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-rj_session=${token}` },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`query ${table}: ${JSON.stringify(json).slice(0, 200)}`);
  return json.data;
}

async function postRegistration(body, token) {
  const res = await fetch(`${BASE_URL}/api/club/registrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-rj_session=${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function cleanRegistrations(clubToken, competitionId) {
  await fetch(`${BASE_URL}/api/club/registrations`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-rj_session=${clubToken}` },
    body: JSON.stringify({ competitionId }),
  });
}

async function setDeadline(adminToken, competitionId, deadline) {
  await queryData('competitions', {
    action: 'update',
    filters: [{ op: 'eq', column: 'id', value: competitionId }],
    payload: { registration_deadline: deadline },
  }, adminToken);
}

async function main() {
  const adminToken = await login('admin', ADMIN_USER, ADMIN_PASS);
  const clubToken = await login('club', CLUB_USER, CLUB_PASS);
  info('admin + club logged in');

  const clubs = await queryData('clubs', {
    action: 'select', columns: 'id', filters: [{ op: 'eq', column: 'username', value: CLUB_USER }], limit: 1,
  }, adminToken);
  const clubId = clubs[0].id;

  const compId = '86f84e31-0501-4f53-a5d1-38af13a1390a'; // 2026年德州市中小学生跳绳比赛
  const athletes = await queryData('athletes', {
    action: 'select', columns: 'id,gender', filters: [{ op: 'eq', column: 'club_id', value: clubId }], limit: 1,
  }, adminToken);
  const athleteId = athletes[0].id;
  const athleteGender = athletes[0].gender;
  // 遍历项目/组别，找一个该运动员符合资格的（性别不限或匹配）
  const events = await queryData('events', {
    action: 'select', columns: 'id,name', filters: [{ op: 'eq', column: 'competition_id', value: compId }], limit: 20,
  }, adminToken);
  let eventId = null, groupId = null;
  for (const ev of events) {
    const gs = await queryData('event_groups', {
      action: 'select', columns: 'id,name,type,gender', filters: [{ op: 'eq', column: 'event_id', value: ev.id }], limit: 10,
    }, adminToken);
    const ok = (gs || []).find(g => g.type !== 'gender' || !g.gender || g.gender === athleteGender);
    if (ok) { eventId = ev.id; groupId = ok.id; break; }
  }
  if (!eventId || !groupId) throw new Error('no eligible event/group found');
  const createBody = { competitionId: compId, eventId, groupId, athleteIds: [athleteId] };
  info(`event=${eventId} group=${groupId} athleteGender=${athleteGender}`);

  // D1: 过去的 datetime → 409
  await setDeadline(adminToken, compId, '2026-09-20T12:00');
  await cleanRegistrations(clubToken, compId);
  const r1 = await postRegistration(createBody, clubToken);
  if (r1.status === 409 && r1.body?.error?.code === 'DEADLINE_PASSED') pass(`D1 过期 datetime '2026-09-20T12:00' → 409 DEADLINE_PASSED ✓`);
  else fail(`D1 期望 409，实际 ${r1.status} ${JSON.stringify(r1.body).slice(0, 200)}`);

  // D2: 未来的 datetime → 201
  await setDeadline(adminToken, compId, '2099-01-01T12:00');
  await cleanRegistrations(clubToken, compId);
  const r2 = await postRegistration(createBody, clubToken);
  if (r2.status === 201) pass(`D2 未来 datetime '2099-01-01T12:00' → 201 创建成功 ✓`);
  else fail(`D2 期望 201，实际 ${r2.status} ${JSON.stringify(r2.body).slice(0, 200)}`);

  // 还原
  await cleanRegistrations(clubToken, compId);
  await setDeadline(adminToken, compId, '2026-09-19');
  await queryData('competitions', {
    action: 'update', filters: [{ op: 'eq', column: 'id', value: compId }],
    payload: { force_open: 0 },
  }, adminToken);
  info('已还原比赛 deadline=2026-09-19 force_open=0，测试报名已清空');

  if (process.exitCode === 1) console.error('\n✗ FAILED');
  else console.log('\n\x1b[32m✓ datetime deadline e2e PASSED\x1b[0m');
}

main().catch(err => { console.error(err); process.exit(1); });
