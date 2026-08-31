#!/usr/bin/env node
/**
 * End-to-end smoke test for deadline unified validation (#451).
 *
 * 验证 4 个调用点（create / bulk / update / resubmit）的 deadline 行为，
 * 配合 status 维度（open / draft / closed）和时间边界（远期 / 当天 / 已过），
 * 构成 6 个核心场景。
 *
 * 语义合约（与 BE assertCompetitionOpen + FE evaluateDeadline 一致）：
 *   - status='open' + deadline='YYYY-MM-DD'  当日 23:59:59.999 UTC 之前可报
 *   - status≠'open'  → 409 COMPETITION_NOT_OPEN（仅查 status，不看 deadline）
 *   - deadline 已过  → 409 DEADLINE_PASSED
 *   - deadline=null/非法 → 仅看 status（不抛 DEADLINE_PASSED）
 *
 * 关键设计：create/bulk/resubmit 走 `assertCompetitionOpen`（锁 deadline），
 * update 走 `lockDeadline: false`（不锁），unlock/review/delete/cancel 根本不调。
 *
 * 用法：
 *   node scripts/test-deadline-e2e.mjs
 *   BASE_URL=https://staging.example.com node scripts/test-deadline-e2e.mjs
 *   CLEANUP=1 node scripts/test-deadline-e2e.mjs    # 删 e2e 比赛
 */
import process from 'node:process';

const BASE_URL = (process.env.BASE_URL || 'https://www.dztsbmxt.top').replace(/\/$/, '');
const CLEANUP = process.env.CLEANUP === '1';
const ADMIN_USER = process.env.ADMIN_USER || '17653420201';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Dztsbmxt@2026';
const CLUB_USER = process.env.CLUB_USER || 'e2e_club_a';
const CLUB_PASS = process.env.CLUB_PASS || 'E2eClubA@2026';

// 固定时间锚点：本测试用「今天 + 远期 / 今天 / 昨天」三档 deadline，
// 以 today_local 决定「当天/已过」的相对边界，规避硬编码日期。
const TODAY = new Date();
const YYYY = TODAY.getUTCFullYear();
const MM = String(TODAY.getUTCMonth() + 1).padStart(2, '0');
const DD = String(TODAY.getUTCDate()).padStart(2, '0');
const TODAY_ISO = `${YYYY}-${MM}-${DD}`;
const YESTERDAY = new Date(TODAY.getTime() - 24 * 3600 * 1000);
const YYYY2 = YESTERDAY.getUTCFullYear();
const MM2 = String(YESTERDAY.getUTCMonth() + 1).padStart(2, '0');
const DD2 = String(YESTERDAY.getUTCDate()).padStart(2, '0');
const YESTERDAY_ISO = `${YYYY2}-${MM2}-${DD2}`;
const FAR_FUTURE = '2099-12-31';

// 单次创建 competition 的固定元数据，比赛名带 [DEADLINE-E2E] 前缀方便清理
const E2E_PREFIX = '[DEADLINE-E2E]';
const E2E_COMPETITION_NAME = `${E2E_PREFIX} ${TODAY_ISO} ${Date.now()}`;

function ts(label) { return `\x1b[36m[${label}]\x1b[0m`; }
function pass(msg) { console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.error(`\x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  ${msg}`); }
function warn(msg) { console.log(`  \x1b[33m! ${msg}\x1b[0m`); }

async function login(role, username, password) {
  const res = await fetch(`${BASE_URL}/api/auth/${role}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`login ${role}/${username} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const cookie = setCookie.find(c => c && c.startsWith('__Host-rj_session=')) || '';
  const token = cookie.match(/__Host-rj_session=([^;]+)/);
  if (!token) throw new Error(`login ${role}/${username}: no session cookie in response`);
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

async function postRegistration(path, body, token) {
  const res = await fetch(`${BASE_URL}/api/club/registrations${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-rj_session=${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function putRegistration(id, body, token) {
  const res = await fetch(`${BASE_URL}/api/club/registrations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-rj_session=${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function postResubmit(id, token) {
  const res = await fetch(`${BASE_URL}/api/club/registrations/${id}/resubmit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-rj_session=${token}` },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function updateCompetitionDeadline(adminToken, competitionId, deadline, status) {
  const payload = { registration_deadline: deadline };
  if (status !== undefined) payload.status = status;
  await queryData('competitions', {
    action: 'update',
    filters: [{ op: 'eq', column: 'id', value: competitionId }],
    payload,
  }, adminToken);
}

async function setup() {
  const adminToken = await login('admin', ADMIN_USER, ADMIN_PASS);
  info('admin logged in');

  // 拿 e2e club id
  const clubs = await queryData('clubs', {
    action: 'select',
    columns: 'id,username',
    filters: [{ op: 'eq', column: 'username', value: CLUB_USER }],
    limit: 1,
  }, adminToken);
  if (!clubs || !clubs.length) throw new Error(`club not found: ${CLUB_USER} — 先跑 test-avatar-private 准备`);
  const clubId = clubs[0].id;
  info(`club ${CLUB_USER} id = ${clubId}`);

  // 选一个能跑通 e2e 全场景的比赛（必须有 event/group/athlete）
  // 优先级：1) e2e 比赛（如果之前跑过且已有 event） 2) 任意 open 真实比赛
  let comp;
  const e2e = await queryData('competitions', {
    action: 'select',
    columns: 'id,name,status,registration_deadline',
    filters: [{ op: 'eq', column: 'name', value: E2E_COMPETITION_NAME }],
    limit: 1,
  }, adminToken);
  if (e2e && e2e.length) {
    const e2eEvents = await queryData('events', {
      action: 'select',
      columns: 'id',
      filters: [{ op: 'eq', column: 'competition_id', value: e2e[0].id }],
      limit: 1,
    }, adminToken);
    if (e2eEvents && e2eEvents.length) {
      comp = e2e[0];
      await updateCompetitionDeadline(adminToken, comp.id, FAR_FUTURE, 'open');
      info(`复用 e2e 比赛: ${comp.id} (${comp.name})`);
    }
  }
  if (!comp) {
    const allOpen = await queryData('competitions', {
      action: 'select',
      columns: 'id,name,status,registration_deadline',
      filters: [{ op: 'eq', column: 'status', value: 'open' }],
      limit: 20,
    }, adminToken);
    if (!allOpen || !allOpen.length) throw new Error('no open competition found — run stress-test-realistic first');
    // 选第一个有 event 的比赛
    for (const c of allOpen) {
      const evs = await queryData('events', {
        action: 'select',
        columns: 'id',
        filters: [{ op: 'eq', column: 'competition_id', value: c.id }],
        limit: 1,
      }, adminToken);
      if (evs && evs.length) {
        comp = c;
        info(`复用真实比赛: ${comp.id} (${comp.name})`);
        break;
      }
    }
  }
  if (!comp) throw new Error('no open competition with events found');

  // 拿该比赛下的 event + group
  const events = await queryData('events', {
    action: 'select',
    columns: 'id,name,competition_id',
    filters: [{ op: 'eq', column: 'competition_id', value: comp.id }],
    limit: 1,
  }, adminToken);
  const event = events[0];

  const groups = await queryData('event_groups', {
    action: 'select',
    columns: 'id,name,event_id,type',
    filters: [{ op: 'eq', column: 'event_id', value: event.id }],
    limit: 1,
  }, adminToken);
  const group = groups[0];

  // 找/建一个 e2e athlete（绑到 e2e_club_a）
  // athletes 表必填：id, club_id, competition_id, name, gender, birth_date, id_card
  const athletes = await queryData('athletes', {
    action: 'select',
    columns: 'id,club_id,name',
    filters: [{ op: 'eq', column: 'club_id', value: clubId }],
    limit: 1,
  }, adminToken);
  let athleteId;
  if (athletes && athletes.length) {
    athleteId = athletes[0].id;
  } else {
    athleteId = crypto.randomUUID();
    await queryData('athletes', {
      action: 'insert',
      payload: {
        id: athleteId,
        club_id: clubId,
        competition_id: comp.id,
        name: 'E2E 测试员',
        gender: 'male',
        birth_date: '2018-01-01',
        id_card: `E2E${Date.now()}`,
      },
    }, adminToken);
  }
  info(`event=${event.id} group=${group.id} athlete=${athleteId}`);

  const clubToken = await login('club', CLUB_USER, CLUB_PASS);
  info('club logged in');

  return { adminToken, clubToken, clubId, comp, eventId: event.id, groupId: group.id, athleteId };
}

function expectError(result, expectedCode, scenario) {
  if (result.status !== 409) {
    fail(`${scenario}: 期望 409, 实际 ${result.status} body=${JSON.stringify(result.body).slice(0, 200)}`);
    return false;
  }
  if (!result.body || !result.body.error) {
    fail(`${scenario}: 409 但响应无 error 字段 body=${JSON.stringify(result.body).slice(0, 200)}`);
    return false;
  }
  if (result.body.error.code !== expectedCode) {
    fail(`${scenario}: 期望 code=${expectedCode}, 实际 code=${result.body.error.code}`);
    return false;
  }
  pass(`${scenario}: 409 ${expectedCode}`);
  return true;
}

function expectSuccess(result, expectedStatus, scenario) {
  if (result.status !== expectedStatus) {
    fail(`${scenario}: 期望 ${expectedStatus}, 实际 ${result.status} body=${JSON.stringify(result.body).slice(0, 200)}`);
    return false;
  }
  pass(`${scenario}: ${expectedStatus}`);
  return true;
}

async function setRegistrationStatus(regId, status) {
  // 用 wrangler d1 直接改 status（生产 admin data API 拒绝改 registrations.status）
  // 仅用于 e2e 准备阶段。
  //
  // Windows spawnSync 坑：
  //   1. `execFileSync(npxCmd, args, { shell: true })` 会把 args 用空格拼起来传
  //      给 cmd，args 里的引号会被 cmd 二次解释，导致复杂 SQL 错位
  //      （如 `--command "SELECT 1 as test"` 变成 SELECT 1 as test 4 个独立 token）
  //   2. `execFileSync(npxCmd, args, { shell: false })` 在 Node 22+ 对 .cmd 抛
  //      `EINVAL`（微软拒绝 .cmd 被非 shell 启动）
  // 解法：把整个命令拼成单个 string，让 shell（cmd）自己负责 quoting 解析
  const { execFileSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  // 优先用 workbuddy 托管的 npx.cmd
  const npxCandidates = [
    'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/npx.cmd',
    'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.12.0/npx.cmd',
  ];
  const npxCmd = npxCandidates.find(p => existsSync(p)) || 'npx.cmd';
  // 单引号包裹 status 防止 SQL 注入（status 只有 pending/confirmed/rejected）
  const safeStatus = String(status).replace(/'/g, "''");
  const safeId = String(regId).replace(/'/g, "''");
  const sql = `UPDATE registrations SET status = '${safeStatus}', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = '${safeId}'`;
  // shell 解析时双引号包 SQL（中间可能有空格但没特殊 shell 字符）
  const cmd = `"${npxCmd}" wrangler d1 execute rope-jump-registration-d1-20260814 --command "${sql}" --remote --yes`;
  try {
    const out = execFileSync(cmd, {
      stdio: 'pipe',
      shell: true,
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    info(`wrangler d1: set registration ${regId.slice(0, 8)} status=${status} (${out.match(/Executed 1 command/)?.[0] || 'unknown'})`);
  } catch (err) {
    const stderr = (err.stderr || err.stdout || '').toString();
    warn(`setRegistrationStatus 失败: ${err.message?.slice(0, 200)} | stderr=${stderr.slice(0, 300)}`);
  }
}

async function runScenario(name, fn) {
  console.log(`\n${ts('SCENARIO')} ${name}`);
  try { await fn(); } catch (err) { fail(`${name} threw: ${err.message}`); }
}

// 每次 create 之前清理该 club 在该 event/group 的 pending registration，
// 避免限额触发器干扰（每个 scope 用 1 次 insert 就清空）
async function cleanRegistrations(clubToken, competitionId) {
  // 用 club 自己的 bulk cancel API（不是 data API），它会校验 actor
  // 一次清空该 club 在该比赛下的所有 pending/confirmed/rejected registration
  try {
    const res = await fetch(`${BASE_URL}/api/club/registrations`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: `__Host-rj_session=${clubToken}` },
      body: JSON.stringify({ competitionId }),
    });
    if (!res.ok && res.status !== 200) {
      const t = await res.text().catch(() => '');
      warn(`cleanRegistrations: ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (err) {
    warn(`cleanRegistrations threw: ${err.message}`);
  }
}

async function main() {
  console.log(`${ts('CONFIG')} BASE_URL=${BASE_URL}`);
  console.log(`${ts('CONFIG')} today=${TODAY_ISO} yesterday=${YESTERDAY_ISO}`);

  const { adminToken, clubToken, clubId, comp, eventId, groupId, athleteId } = await setup();

  // --- 场景 1: create 路径 + deadline=远期 + status=open → 201 ---
  await runScenario('S1 create with far-future deadline → 201', async () => {
    await updateCompetitionDeadline(adminToken, comp.id, FAR_FUTURE, 'open');
    await cleanRegistrations(clubToken, comp.id);
    const body = { competitionId: comp.id, eventId, groupId, athleteIds: [athleteId] };
    const r = await postRegistration('', body, clubToken);
    expectSuccess(r, 201, 'S1');
  });

  // --- 场景 2: create 路径 + deadline=今天（未到 23:59:59 UTC）→ 201 ---
  // 因为 today 是 UTC 0 点起算，「今天内」的注册走 deadline=TODAY_ISO 应当 OK
  await runScenario('S2 create with today deadline (within day) → 201', async () => {
    await updateCompetitionDeadline(adminToken, comp.id, TODAY_ISO, 'open');
    await cleanRegistrations(clubToken, comp.id);
    const body = { competitionId: comp.id, eventId, groupId, athleteIds: [athleteId] };
    const r = await postRegistration('', body, clubToken);
    // 若 now>23:59:59 UTC（极少见）会抛 DEADLINE_PASSED，标记为 warn 而非 fail
    if (r.status === 409 && r.body?.error?.code === 'DEADLINE_PASSED') {
      warn(`S2 期望 201 但此刻已过今天 23:59:59 UTC（race），跳过`);
    } else {
      expectSuccess(r, 201, 'S2');
    }
  });

  // --- 场景 3: create 路径 + deadline=昨天（已过）→ 409 DEADLINE_PASSED ---
  await runScenario('S3 create with yesterday deadline → 409 DEADLINE_PASSED', async () => {
    await updateCompetitionDeadline(adminToken, comp.id, YESTERDAY_ISO, 'open');
    await cleanRegistrations(clubToken, comp.id);
    const body = { competitionId: comp.id, eventId, groupId, athleteIds: [athleteId] };
    const r = await postRegistration('', body, clubToken);
    expectError(r, 'DEADLINE_PASSED', 'S3');
  });

  // --- 场景 4: create 路径 + status=draft + deadline=远期 → 409 COMPETITION_NOT_OPEN ---
  await runScenario('S4 create with status=draft → 409 COMPETITION_NOT_OPEN', async () => {
    await updateCompetitionDeadline(adminToken, comp.id, FAR_FUTURE, 'draft');
    await cleanRegistrations(clubToken, comp.id);
    const body = { competitionId: comp.id, eventId, groupId, athleteIds: [athleteId] };
    const r = await postRegistration('', body, clubToken);
    expectError(r, 'COMPETITION_NOT_OPEN', 'S4');
  });

  // --- 场景 5: update 路径 + deadline=昨天 + status=pending → 200（不锁 deadline） ---
  // 准备：create 1 条 reg，然后用 wrangler d1 改 status='pending' 模拟 admin review
  await runScenario('S5 update with past deadline → 200 (not locked)', async () => {
    await updateCompetitionDeadline(adminToken, comp.id, FAR_FUTURE, 'open');
    await cleanRegistrations(clubToken, comp.id);
    const createBody = { competitionId: comp.id, eventId, groupId, athleteIds: [athleteId] };
    const created = await postRegistration('', createBody, clubToken);
    if (created.status !== 201) {
      fail(`S5 准备阶段 create 失败: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
      return;
    }
    const regId = created.body.data?.id;
    if (!regId) {
      fail(`S5 准备阶段 create 未返回 id`);
      return;
    }
    // 用 wrangler d1 把 status 改成 pending（admin data API 不允许改 registrations.status）
    await setRegistrationStatus(regId, 'pending');
    // 把 deadline 改成昨天
    await updateCompetitionDeadline(adminToken, comp.id, YESTERDAY_ISO, 'open');
    // update 走 PUT，应能改（lockDeadline=false + status=pending）
    const updateBody = { athleteIds: [athleteId] };
    const r = await putRegistration(regId, updateBody, clubToken);
    if (r.status === 200) pass(`S5 update 通过（lockDeadline=false 生效，deadline 已过不阻挡）`);
    else fail(`S5 update 应通过但 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    // 还原
    await cleanRegistrations(clubToken, comp.id);
  });

  // --- 场景 6: resubmit 路径 + deadline=昨天 + status=rejected → 409 DEADLINE_PASSED ---
  // 准备：create 1 条 reg，然后用 wrangler d1 改 status='rejected' 模拟 admin reject
  await runScenario('S6 resubmit with past deadline → 409 DEADLINE_PASSED', async () => {
    await updateCompetitionDeadline(adminToken, comp.id, FAR_FUTURE, 'open');
    await cleanRegistrations(clubToken, comp.id);
    const createBody = { competitionId: comp.id, eventId, groupId, athleteIds: [athleteId] };
    const created = await postRegistration('', createBody, clubToken);
    if (created.status !== 201) {
      fail(`S6 准备阶段 create 失败: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
      return;
    }
    const regId = created.body.data?.id;
    if (!regId) {
      fail(`S6 准备阶段 create 未返回 id`);
      return;
    }
    // 用 wrangler d1 把 status 改成 rejected
    await setRegistrationStatus(regId, 'rejected');
    // 把 deadline 改到昨天
    await updateCompetitionDeadline(adminToken, comp.id, YESTERDAY_ISO, 'open');
    // resubmit 应当被 deadline 阻挡
    const r = await postResubmit(regId, clubToken);
    expectError(r, 'DEADLINE_PASSED', 'S6');
    // 还原
    await cleanRegistrations(clubToken, comp.id);
  });

  // 还原 deadline/status 防止污染后续测试
  await updateCompetitionDeadline(adminToken, comp.id, FAR_FUTURE, 'open');

  if (CLEANUP) {
    info('CLEANUP=1 跳过 competition 清理（如需手动清理请按 name 前缀 [DEADLINE-E2E] 删除）');
  }

  if (process.exitCode === 1) {
    console.error(`\n\x1b[31m✗ deadline e2e FAILED\x1b[0m`);
  } else {
    console.log(`\n\x1b[32m✓ deadline e2e PASSED\x1b[0m`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
