/**
 * Rate limit helpers for sensitive auth endpoints (login).
 *
 * Strategy: sliding-window counter stored in Cloudflare KV. The value keeps
 * a small JSON blob { failures, firstAt, lockedUntil }. Keys are namespaced
 * by dimension (ip / username) so a single attacker cannot bypass the
 * limiter by rotating usernames from one IP, and a single careless user
 * cannot lock out an entire NAT / corporate IP.
 *
 * Defaults (configurable via env):
 *   RATE_LIMIT_WINDOW_SECONDS   = 300   (5-minute observation window)
 *   RATE_LIMIT_IP_MAX           = 10    (max failures per IP per window)
 *   RATE_LIMIT_USER_MAX         = 5     (max failures per username per window)
 *   RATE_LIMIT_LOCKOUT_SECONDS  = 900   (15 minutes)
 *   ENABLE_RATE_LIMIT           = "1"   (set to "0" to disable at runtime)
 *
 * When RATE_LIMIT_KV is not bound, all helpers become no-ops (fail-open).
 * This keeps the local dev experience smooth and prevents accidental
 * hard-locks if a binding is misconfigured in production.
 */
import type { Env } from './types';
import { HttpError } from './http';

const DEFAULT_WINDOW_SECONDS = 300;
const DEFAULT_IP_MAX = 10;
const DEFAULT_USER_MAX = 5;
const DEFAULT_LOCKOUT_SECONDS = 900;

export interface RateLimitSnapshot {
  failures: number;
  firstAt: number;
  lockedUntil: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  limit: number;
  failures: number;
  lockedUntil: number;
}

interface RateLimitConfig {
  enabled: boolean;
  windowSeconds: number;
  lockoutSeconds: number;
  ipMax: number;
  userMax: number;
}

function readConfig(env: Env): RateLimitConfig {
  const enabled = (env as Env & { ENABLE_RATE_LIMIT?: string }).ENABLE_RATE_LIMIT !== '0';
  const envAny = env as Env & Record<string, string | undefined>;
  const toInt = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    enabled,
    windowSeconds: toInt(envAny.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
    lockoutSeconds: toInt(envAny.RATE_LIMIT_LOCKOUT_SECONDS, DEFAULT_LOCKOUT_SECONDS),
    ipMax: toInt(envAny.RATE_LIMIT_IP_MAX, DEFAULT_IP_MAX),
    userMax: toInt(envAny.RATE_LIMIT_USER_MAX, DEFAULT_USER_MAX),
  };
}

function kv(env: Env): KVNamespace | null {
  const binding = (env as Env & { RATE_LIMIT_KV?: KVNamespace }).RATE_LIMIT_KV;
  return binding || null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function loadSnapshot(store: KVNamespace, key: string): Promise<RateLimitSnapshot> {
  const raw = await store.get(key);
  if (!raw) return { failures: 0, firstAt: nowSeconds(), lockedUntil: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<RateLimitSnapshot>;
    return {
      failures: Number.isInteger(parsed.failures) ? Number(parsed.failures) : 0,
      firstAt: Number.isInteger(parsed.firstAt) ? Number(parsed.firstAt) : nowSeconds(),
      lockedUntil: Number.isInteger(parsed.lockedUntil) ? Number(parsed.lockedUntil) : 0,
    };
  } catch {
    return { failures: 0, firstAt: nowSeconds(), lockedUntil: 0 };
  }
}

async function saveSnapshot(store: KVNamespace, key: string, snapshot: RateLimitSnapshot, ttlSeconds: number): Promise<void> {
  await store.put(key, JSON.stringify(snapshot), { expirationTtl: Math.max(60, ttlSeconds) });
}

function buildKey(scope: 'login' | 'reset', dimension: 'ip' | 'user', value: string): string {
  // KV allows up to 512-byte keys; usernames are bounded by MAX_USERNAME_LENGTH (100)
  // but we still defensively normalise whitespace and case for the user dimension.
  const normalized = scope === 'login' && dimension === 'user' ? value.trim().toLowerCase() : value;
  return `rl:${scope}:${dimension}:${normalized}`;
}

function extractIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function checkSnapshot(snapshot: RateLimitSnapshot, limit: number, lockoutSeconds: number, now: number): RateLimitDecision {
  if (snapshot.lockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: snapshot.lockedUntil - now,
      limit,
      failures: snapshot.failures,
      lockedUntil: snapshot.lockedUntil,
    };
  }
  if (snapshot.failures >= limit) {
    // Reached threshold but lockout has not been written yet — treat as locked.
    const lockedUntil = now + lockoutSeconds;
    return {
      allowed: false,
      remaining: 0,
      retryAfter: lockedUntil - now,
      limit,
      failures: snapshot.failures,
      lockedUntil,
    };
  }
  return {
    allowed: true,
    remaining: Math.max(0, limit - snapshot.failures),
    retryAfter: 0,
    limit,
    failures: snapshot.failures,
    lockedUntil: 0,
  };
}

function pickStrictest(left: RateLimitDecision, right: RateLimitDecision): RateLimitDecision {
  if (!left.allowed) return left;
  if (!right.allowed) return right;
  return left.remaining <= right.remaining ? left : right;
}

/**
 * Inspect the current limiter state for the given request without mutating
 * it. Throws HttpError(429) with a Retry-After header when locked out.
 */
export async function enforceRateLimit(
  env: Env,
  request: Request,
  scope: 'login' | 'reset' = 'login',
  identifiers: { username?: string } = {},
): Promise<void> {
  const config = readConfig(env);
  if (!config.enabled) return;
  const store = kv(env);
  if (!store) return; // fail-open when binding is missing

  const ip = extractIp(request);
  const username = (identifiers.username || '').trim();
  const checks: RateLimitDecision[] = [];

  const ipSnapshot = await loadSnapshot(store, buildKey(scope, 'ip', ip));
  checks.push(checkSnapshot(ipSnapshot, config.ipMax, config.lockoutSeconds, nowSeconds()));

  if (username) {
    const userSnapshot = await loadSnapshot(store, buildKey(scope, 'user', username));
    checks.push(checkSnapshot(userSnapshot, config.userMax, config.lockoutSeconds, nowSeconds()));
  }

  const decision = checks.reduce(pickStrictest);
  if (decision.allowed) return;

  throw new HttpError(
    429,
    'Too many failed attempts. Please try again later.',
    'RATE_LIMITED',
    {
      scope,
      retry_after_seconds: decision.retryAfter,
      limit: decision.limit,
    },
  );
}

/**
 * Increment the failure counter. Once the per-dimension limit is reached,
 * the snapshot is updated to lock out further attempts for lockoutSeconds.
 * Best-effort: KV errors are swallowed and logged so they never break the
 * login path (fail-open).
 */
export async function recordAuthFailure(
  env: Env,
  request: Request,
  scope: 'login' | 'reset' = 'login',
  identifiers: { username?: string } = {},
): Promise<void> {
  const config = readConfig(env);
  if (!config.enabled) return;
  const store = kv(env);
  if (!store) return;

  const now = nowSeconds();
  const ip = extractIp(request);
  const username = (identifiers.username || '').trim();

  const targets: Array<{ key: string; limit: number }> = [
    { key: buildKey(scope, 'ip', ip), limit: config.ipMax },
  ];
  if (username) targets.push({ key: buildKey(scope, 'user', username), limit: config.userMax });

  await Promise.all(targets.map(async ({ key, limit }) => {
    try {
      const snapshot = await loadSnapshot(store, key);
      // Reset the window if it has expired and we are not in an active lockout.
      if (snapshot.lockedUntil <= now && now - snapshot.firstAt > config.windowSeconds) {
        snapshot.firstAt = now;
        snapshot.failures = 0;
        snapshot.lockedUntil = 0;
      }
      snapshot.failures += 1;
      if (snapshot.failures >= limit && snapshot.lockedUntil <= now) {
        snapshot.lockedUntil = now + config.lockoutSeconds;
      }
      await saveSnapshot(store, key, snapshot, config.lockoutSeconds);
    } catch (error) {
      console.error(JSON.stringify({ level: 'warn', code: 'RATE_LIMIT_RECORD_FAILED', message: (error as Error).message }));
    }
  }));
}

/**
 * Clear counters on successful authentication. Best-effort, same fail-open
 * contract as recordAuthFailure.
 */
export async function clearAuthFailures(
  env: Env,
  request: Request,
  scope: 'login' | 'reset' = 'login',
  identifiers: { username?: string } = {},
): Promise<void> {
  const config = readConfig(env);
  if (!config.enabled) return;
  const store = kv(env);
  if (!store) return;

  const ip = extractIp(request);
  const username = (identifiers.username || '').trim();
  const keys: string[] = [buildKey(scope, 'ip', ip)];
  if (username) keys.push(buildKey(scope, 'user', username));

  await Promise.all(keys.map(async (key) => {
    try {
      await store.delete(key);
    } catch (error) {
      console.error(JSON.stringify({ level: 'warn', code: 'RATE_LIMIT_CLEAR_FAILED', message: (error as Error).message }));
    }
  }));
}
