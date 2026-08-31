#!/usr/bin/env node
/**
 * End-to-end smoke test for the private athlete-avatar storage endpoint.
 *
 * Setup:
 *  - Logs in as admin.
 *  - Creates two test clubs (A and B) with known passwords (idempotent —
 *    re-uses any existing clubs with the same usernames).
 *  - Logs in as club A and club B.
 *
 * Scenarios:
 *  1. Anonymous GET → 401 (storage is no longer public).
 *  2. Club B reads club A's avatar → 403 FORBIDDEN_RESOURCE.
 *  3. Club A reads its own avatar → 200, Content-Type=image/*, Cache-Control=private.
 *  4. Admin reads any avatar → 200 (admin role bypasses ownership).
 *  5. Anonymous PUT to a non-owned path → 401.
 *  6. Club A PUT to a foreign club's path → 403 FORBIDDEN_RESOURCE.
 *  7. Club A PUT to its own path → 200.
 *
 * Usage:
 *   node scripts/test-avatar-private.mjs
 *   BASE_URL=https://staging.example.com node scripts/test-avatar-private.mjs
 *   CLEANUP=1 node scripts/test-avatar-private.mjs    # delete the test clubs at the end
 */
import process from 'node:process';

const BASE_URL = (process.env.BASE_URL || 'https://www.dztsbmxt.top').replace(/\/$/, '');
const CLEANUP = process.env.CLEANUP === '1';

const ADMIN_USER = process.env.ADMIN_USER || '17653420201';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Dztsbmxt@2026';
const CLUB_A_USER = process.env.CLUB_A_USER || 'e2e_club_a';
const CLUB_A_PASS = process.env.CLUB_A_PASS || 'E2eClubA@2026';
const CLUB_B_USER = process.env.CLUB_B_USER || 'e2e_club_b';
const CLUB_B_PASS = process.env.CLUB_B_PASS || 'E2eClubB@2026';

// Build a tiny 1x1 transparent PNG so we can PUT a real image and GET it
// back. 67 bytes hex-encoded.
const TINY_PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63FCFFFF3F0300050001' +
  'D5E0F38B0000000049454E44AE426082',
  'hex',
);

function ts(label) { return `\x1b[36m[${label}]\x1b[0m`; }
function pass(msg) { console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.error(`\x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  ${msg}`); }

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
  // Pass set-cookie through a follow-up request via the Cookie header. Node's
  // fetch exposes set-cookie as a single header string (joined by \n in some
  // runtimes) but we just need the token portion.
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

async function getOrCreateClub(adminToken, username, password) {
  const existing = await queryData('clubs', {
    action: 'select',
    columns: 'id,username,club_name,is_approved',
    filters: [{ op: 'eq', column: 'username', value: username }],
    limit: 1,
  }, adminToken);
  if (existing && existing.length) {
    return { row: existing[0], created: false };
  }
  const hash = await ensureClubPasswordHash(password);
  const created = await queryData('clubs', {
    action: 'insert',
    payload: {
      id: crypto.randomUUID(),
      username,
      password_hash: hash,
      club_name: `E2E ${username}`,
      contact_name: 'E2E',
      phone: '13800000000',
      is_approved: 1,
    },
  }, adminToken);
  // `data` from insert may return either a single row or an array.
  const row = Array.isArray(created) ? created[0] : created;
  return { row, created: true };
}

async function ensureClubPasswordHash(password) {
  // The admin-side data API only accepts 64-char hex SHA-256 strings for
  // password_hash. The login route (auth.ts) verifies a stored SHA-256 hash
  // directly, so writing this format works end-to-end without touching the
  // PBKDF2 path. After the first successful login the system will silently
  // upgrade the hash to PBKDF2 on the next UPDATE, but for the e2e window
  // SHA-256 is sufficient.
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function setClubPasswordViaAdmin(adminToken, clubId, password) {
  const hash = await ensureClubPasswordHash(password);
  await queryData('clubs', {
    action: 'update',
    filters: [{ op: 'eq', column: 'id', value: clubId }],
    payload: { password_hash: hash },
  }, adminToken);
}

async function getObject(path, token) {
  const url = `${BASE_URL}/storage/athlete-avatars/object/${path}`;
  const headers = {};
  if (token) headers.Cookie = `__Host-rj_session=${token}`;
  return fetch(url, { method: 'GET', headers });
}

async function putObject(path, body, token, contentType = 'image/png') {
  const url = `${BASE_URL}/storage/athlete-avatars/object/${path}`;
  const headers = { 'Content-Type': contentType };
  if (token) headers.Cookie = `__Host-rj_session=${token}`;
  const res = await fetch(url, { method: 'PUT', headers, body });
  return res;
}

async function uploadAvatar(clubId, token) {
  const path = `${clubId}/e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;
  const res = await putObject(path, TINY_PNG, token);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`PUT failed: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return path;
}

async function runScenario(name, fn) {
  console.log(`\n${ts('SCENARIO')} ${name}`);
  try { await fn(); } catch (err) { fail(`${name} threw: ${err.message}`); }
}

async function scenarioAnonymousDenied() {
  const res = await getObject('no-such-club/whatever.png', null);
  if (res.status !== 401) {
    fail(`Anonymous GET should be 401, got ${res.status}`);
    return;
  }
  pass(`Anonymous GET → 401 (storage is private)`);
}

async function scenarioClubReadsOwn(clubAToken) {
  const filePath = await uploadAvatar((await getClubId(CLUB_A_USER)), clubAToken);
  const res = await getObject(filePath, clubAToken);
  if (res.status !== 200) {
    fail(`Club A GET on own avatar → expected 200, got ${res.status}`);
    return;
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) {
    fail(`Club A GET content-type should start with image/, got ${ct}`);
    return;
  }
  const cc = res.headers.get('cache-control') || '';
  if (!/^private,/i.test(cc)) {
    fail(`Cache-Control should be private, got "${cc}"`);
    return;
  }
  pass(`Club A GET on own avatar → 200, Cache-Control: ${cc}`);
  return filePath;
}

async function scenarioAdminSeesAll(adminToken, clubAId) {
  const clubAToken = await login('club', CLUB_A_USER, CLUB_A_PASS);
  const filePath = await uploadAvatar(clubAId, clubAToken);
  const res = await getObject(filePath, adminToken);
  if (res.status !== 200) {
    fail(`Admin GET on club A avatar → expected 200, got ${res.status}`);
    return;
  }
  pass(`Admin GET on club A avatar → 200 (admin bypass)`);
}

async function scenarioCrossClubDenied(clubBToken, clubAId) {
  // Club A uploads a file, then club B (different id) tries to read it.
  const clubAToken = await login('club', CLUB_A_USER, CLUB_A_PASS);
  const filePath = await uploadAvatar(clubAId, clubAToken);
  const res = await getObject(filePath, clubBToken);
  if (res.status !== 403) {
    fail(`Club B GET on club A avatar → expected 403, got ${res.status}`);
    return;
  }
  const text = await res.text().catch(() => '');
  if (!/FORBIDDEN_RESOURCE/.test(text)) {
    fail(`Club B forbidden body should contain FORBIDDEN_RESOURCE, got ${text.slice(0, 200)}`);
    return;
  }
  pass(`Club B GET on club A avatar → 403 FORBIDDEN_RESOURCE`);
}

async function scenarioAnonymousPutDenied() {
  const res = await putObject(`no-such-club/${Date.now()}.png`, TINY_PNG, null);
  if (res.status !== 401) {
    fail(`Anonymous PUT should be 401, got ${res.status}`);
    return;
  }
  pass(`Anonymous PUT → 401`);
}

async function scenarioCrossClubPutDenied(clubBToken, clubAId) {
  const path = `${clubAId}/cross-${Date.now()}.png`;
  const res = await putObject(path, TINY_PNG, clubBToken);
  if (res.status !== 403) {
    fail(`Club B PUT to club A path → expected 403, got ${res.status}`);
    return;
  }
  pass(`Club B PUT to club A path → 403 FORBIDDEN_RESOURCE`);
}

async function getClubId(username) {
  // We re-login to admin to avoid leaking the admin token into the test body.
  const adminToken = await login('admin', ADMIN_USER, ADMIN_PASS);
  const rows = await queryData('clubs', {
    action: 'select',
    columns: 'id,username,club_name,is_approved',
    filters: [{ op: 'eq', column: 'username', value: username }],
    limit: 1,
  }, adminToken);
  if (!rows || !rows.length) throw new Error(`club not found: ${username}`);
  return rows[0].id;
}

async function cleanup(adminToken, ...ids) {
  for (const id of ids) {
    if (!id) continue;
    try {
      await queryData('clubs', {
        action: 'delete',
        filters: [{ op: 'eq', column: 'id', value: id }],
      }, adminToken);
      info(`cleaned up club ${id}`);
    } catch (err) {
      info(`cleanup of club ${id} failed: ${err.message}`);
    }
  }
}

async function main() {
  console.log(`${ts('CONFIG')} BASE_URL=${BASE_URL}`);
  console.log(`${ts('CONFIG')} admin=${ADMIN_USER}, clubA=${CLUB_A_USER}, clubB=${CLUB_B_USER}`);

  const adminToken = await login('admin', ADMIN_USER, ADMIN_PASS);
  info('admin logged in');

  // Setup test clubs (idempotent)
  const { row: clubA, created: createdA } = await getOrCreateClub(adminToken, CLUB_A_USER, CLUB_A_PASS);
  if (!clubA) {
    fail('failed to provision club A');
    return;
  }
  if (!createdA) {
    // Existing row — reset its password to the known value so login works.
    await setClubPasswordViaAdmin(adminToken, clubA.id, CLUB_A_PASS);
  }
  info(`club A id = ${clubA.id} ${createdA ? '(new)' : '(existing, password reset)'}`);

  const { row: clubB, created: createdB } = await getOrCreateClub(adminToken, CLUB_B_USER, CLUB_B_PASS);
  if (!clubB) {
    fail('failed to provision club B');
    return;
  }
  if (!createdB) {
    await setClubPasswordViaAdmin(adminToken, clubB.id, CLUB_B_PASS);
  }
  info(`club B id = ${clubB.id} ${createdB ? '(new)' : '(existing, password reset)'}`);

  if (clubA.id === clubB.id) {
    fail('club A and B have the same id — test setup is broken');
    return;
  }

  const clubAToken = await login('club', CLUB_A_USER, CLUB_A_PASS);
  const clubBToken = await login('club', CLUB_B_USER, CLUB_B_PASS);
  info('both clubs logged in');

  await runScenario('Anonymous GET → 401', scenarioAnonymousDenied);
  await runScenario('Anonymous PUT → 401', scenarioAnonymousPutDenied);
  await runScenario('Club A GET on own avatar → 200 + private cache', () => scenarioClubReadsOwn(clubAToken));
  await runScenario('Admin GET on club A avatar → 200 (admin bypass)', () => scenarioAdminSeesAll(adminToken, clubA.id));
  await runScenario('Club B GET on club A avatar → 403 FORBIDDEN_RESOURCE', () => scenarioCrossClubDenied(clubBToken, clubA.id));
  await runScenario('Club B PUT to club A path → 403 FORBIDDEN_RESOURCE', () => scenarioCrossClubPutDenied(clubBToken, clubA.id));

  if (CLEANUP) await cleanup(adminToken, clubA.id, clubB.id);

  if (process.exitCode === 1) {
    console.error(`\n\x1b[31m✗ avatar private e2e FAILED\x1b[0m`);
  } else {
    console.log(`\n\x1b[32m✓ avatar private e2e PASSED\x1b[0m`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
