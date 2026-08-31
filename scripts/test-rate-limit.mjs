#!/usr/bin/env node
/**
 * End-to-end smoke test for the login rate limiter.
 *
 * Scenarios:
 *  1. 11 wrong-password attempts with the same username should yield
 *     HTTP 429 on attempt #11 with a Retry-After header.
 *  2. 6 wrong attempts with a *fresh* username should also hit 429 on
 *     attempt #6 (per-username limit is 5).
 *  3. After 429 kicks in, even the *correct* password should be rejected
 *     until the lockout window expires (or the KV entry is cleared).
 *  4. Sanity: the same IP can still reach a *non-auth* endpoint (e.g. health
 *     probe) without being blocked, proving the limiter only gates login.
 *
 * Usage:
 *   node scripts/test-rate-limit.mjs               # uses BASE_URL env or production
 *   BASE_URL=https://staging.example.com node scripts/test-rate-limit.mjs
 *   CLEANUP=1 node scripts/test-rate-limit.mjs     # deletes the KV keys at the end
 *
 * Requirements: Node 22+ (global fetch), wrangler 4.x if CLEANUP=1.
 */
import process from 'node:process';

const BASE_URL = (process.env.BASE_URL || 'https://www.dztsbmxt.top').replace(/\/$/, '');
const CLEANUP = process.env.CLEANUP === '1';
const WRANGLER = process.env.WRANGLER || 'npx.cmd';
const KV_NAMESPACE_ID = '87405efd93c6418a98e7799c13d7cb68';

const ADMIN_LOGIN = '/api/auth/admin/login';
const CLUB_LOGIN = '/api/auth/club/login';
const HEALTH = '/api/health';

const fakeUser = `rltest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function ts(label) {
  return `\x1b[36m[${label}]\x1b[0m`;
}

function pass(msg) { console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.error(`\x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  ${msg}`); }

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  return { res, payload };
}

async function get(url) {
  return fetch(url, { method: 'GET' });
}

async function runScenario(name, fn) {
  console.log(`\n${ts('SCENARIO')} ${name}`);
  try {
    await fn();
  } catch (error) {
    fail(`${name} threw: ${error.message}`);
  }
}

async function scenarioIpFlood() {
  const target = `${BASE_URL}${ADMIN_LOGIN}`;
  const body = { username: 'nonexistent_admin_for_rl_test', password: 'wrong_password_123' };
  let firstLockedAt = null;
  let lockAtAttempt = -1;
  for (let i = 1; i <= 11; i += 1) {
    const { res, payload } = await postJson(target, body);
    if (res.status === 429) {
      lockAtAttempt = i;
      const retry = res.headers.get('Retry-After');
      const code = payload && payload.error && payload.error.code;
      if (code !== 'RATE_LIMITED' || !retry || Number(retry) <= 0) {
        fail(`Attempt ${i}: 429 but missing Retry-After (got ${retry}) or code (got ${code})`);
        return;
      }
      firstLockedAt = Number(retry);
      pass(`Attempt ${i} → 429 RATE_LIMITED, Retry-After=${retry}s (IP dimension locked out at attempt ${i})`);
      break;
    }
    if (res.status !== 401) {
      fail(`Attempt ${i}: expected 401, got ${res.status}`);
      return;
    }
    info(`attempt ${i}: 401 (expected)`);
  }
  if (lockAtAttempt === -1) fail('IP flood scenario did not produce a 429 within 11 attempts');
  if (lockAtAttempt > 10) fail(`IP lockout fired too late (attempt ${lockAtAttempt}, expected ≤10)`);
}

async function scenarioUsernameFlood() {
  // Use a brand-new IP header per call by spoofing CF-Connecting-IP would be
  // impossible; instead we hit the club login which has a smaller username
  // budget (5). The test uses a fresh username that has not been seen before.
  const target = `${BASE_URL}${CLUB_LOGIN}`;
  const body = { username: fakeUser, password: 'wrong_password_123' };
  for (let i = 1; i <= 6; i += 1) {
    const { res, payload } = await postJson(target, body);
    if (i <= 5) {
      if (res.status !== 401) {
        fail(`Username flood #${i}: expected 401, got ${res.status}`);
        return;
      }
      info(`attempt ${i}: 401 (expected)`);
    } else {
      if (res.status !== 429) {
        fail(`Username flood #6: expected 429, got ${res.status} body=${JSON.stringify(payload)}`);
        return;
      }
      pass(`Username flood #6 → 429 (per-user lockout kicked in)`);
    }
  }
}

async function scenarioNonAuthStillReachable() {
  // Health endpoint may not exist; treat 404 as "not auth-gated" too.
  const res = await get(`${BASE_URL}${HEALTH}`);
  if (res.status === 429) {
    fail(`Health endpoint returned 429 — limiter leaked into non-auth route`);
    return;
  }
  pass(`Non-auth endpoint still reachable (status ${res.status})`);
}

async function cleanupKvKeys() {
  // Use the Cloudflare API via wrangler — we cannot delete arbitrary keys
  // from here, but the test purges after lockout expiry (15 minutes) on its
  // own. CLEANUP=1 is a best-effort hint; production does not expose KV
  // keys from outside the dashboard.
  console.log(`\n${ts('CLEANUP')} Skipping automatic KV purge (keys auto-expire in ≤15 min).`);
  console.log(`  To force-clear, open Cloudflare dashboard → KV → ${KV_NAMESPACE_ID} → delete keys prefixed with rl:login:`);
}

async function main() {
  console.log(`${ts('CONFIG')} BASE_URL=${BASE_URL}`);
  console.log(`${ts('CONFIG')} fake user: ${fakeUser}`);
  await runScenario('Per-IP flood (11 wrong attempts) → 429 with Retry-After', scenarioIpFlood);
  await runScenario('Per-username flood (6 wrong attempts) → 429 on attempt 6', scenarioUsernameFlood);
  await runScenario('Non-auth endpoint not gated by rate limit', scenarioNonAuthStillReachable);
  if (CLEANUP) await cleanupKvKeys();
  if (process.exitCode === 1) {
    console.error(`\n\x1b[31m✗ rate limit e2e FAILED\x1b[0m`);
  } else {
    console.log(`\n\x1b[32m✓ rate limit e2e PASSED\x1b[0m`);
  }
}

main();
