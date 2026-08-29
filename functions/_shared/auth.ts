import type { Env, Row, SessionPrincipal } from './types';
import { HttpError } from './http';

const COOKIE_NAME = '__Host-rj_session';
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const HEX_64 = /^[a-f0-9]{64}$/i;
const PBKDF2_PREFIX = 'pbkdf2$';
// Cloudflare workerd enforces PBKDF2 iteration count <= 100000.
// 100000 is still within OWASP's recommended range (>= 1000 iterations for SHA-256).
const PBKDF2_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password) as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await pbkdf2(password, salt);
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(digest)}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith(PBKDF2_PREFIX)) {
    const [, rawIterations, encodedSalt, encodedDigest] = stored.split('$');
    const iterations = Number(rawIterations);
    if (!Number.isInteger(iterations) || iterations < 60_000 || iterations > 100_000 || !encodedSalt || !encodedDigest) return false;
    try {
      const digest = await pbkdf2(password, base64ToBytes(encodedSalt), iterations);
      return constantTimeEqual(bytesToBase64(digest), encodedDigest);
    } catch {
      return false;
    }
  }
  if (!HEX_64.test(stored)) return false;
  return constantTimeEqual(await sha256(password), stored.toLowerCase());
}

function parseCookies(request: Request): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function ttlSeconds(env: Env): number {
  const configured = Number(env.SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS);
  return Number.isInteger(configured) && configured >= 300 && configured <= 60 * 60 * 24 * 30
    ? configured
    : DEFAULT_SESSION_TTL_SECONDS;
}

export function sessionCookie(token: string, env: Env): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlSeconds(env)}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSession(env: Env, role: 'admin' | 'club', userId: string, request: Request): Promise<string> {
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds(env) * 1000).toISOString();
  await env.REGISTRATION_DB.prepare(
    `INSERT INTO sessions (id, token_hash, user_type, user_id, expires_at, created_at, last_seen_at, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    tokenHash,
    role,
    userId,
    expiresAt,
    now.toISOString(),
    now.toISOString(),
    request.headers.get('CF-Connecting-IP') ? await sha256(request.headers.get('CF-Connecting-IP') as string) : null,
    (request.headers.get('User-Agent') || '').slice(0, 512) || null,
  ).run();
  return token;
}

export async function getSession(request: Request, env: Env): Promise<SessionPrincipal | null> {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.REGISTRATION_DB.prepare(
    `SELECT id, user_type, user_id, expires_at FROM sessions
     WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`,
  ).bind(tokenHash, now).first<Row>();
  if (!row || (row.user_type !== 'admin' && row.user_type !== 'club')) return null;

  let mustResetPassword = false;
  if (row.user_type === 'admin') {
    const user = await env.REGISTRATION_DB.prepare('SELECT is_active, reset_required FROM admin_users WHERE id = ? LIMIT 1')
      .bind(row.user_id).first<Row>();
    if (!user || Number(user.is_active) !== 1) return null;
    mustResetPassword = Number(user.reset_required) === 1;
  } else {
    const club = await env.REGISTRATION_DB.prepare('SELECT is_approved FROM clubs WHERE id = ? LIMIT 1')
      .bind(row.user_id).first<Row>();
    if (!club || Number(club.is_approved) !== 1) return null;
  }

  const principal: SessionPrincipal = {
    sessionId: String(row.id),
    role: row.user_type,
    userId: String(row.user_id),
    expiresAt: String(row.expires_at),
    ...(mustResetPassword ? { mustResetPassword: true } : {}),
  };
  await env.REGISTRATION_DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
    .bind(now, principal.sessionId).run();
  return principal;
}

export async function requireSession(
  request: Request,
  env: Env,
  roles: Array<'admin' | 'club'> = ['admin', 'club'],
  allowPasswordReset = false,
): Promise<SessionPrincipal> {
  const session = await getSession(request, env);
  if (!session) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
  if (!roles.includes(session.role)) throw new HttpError(403, 'Insufficient permissions', 'FORBIDDEN');
  if (session.mustResetPassword && !allowPasswordReset) {
    throw new HttpError(403, 'Password reset is required before continuing', 'PASSWORD_RESET_REQUIRED');
  }
  return session;
}

export async function revokeCurrentSession(request: Request, env: Env): Promise<void> {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return;
  await env.REGISTRATION_DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), await sha256(token)).run();
}

export function stripSecrets(row: Row | null): Row | null {
  if (!row) return null;
  const safe = { ...row };
  delete safe.password_hash;
  delete safe.reset_metadata;
  delete safe.ip_hash;
  delete safe.token_hash;
  return safe;
}

export async function resetAdminPassword(env: Env, session: SessionPrincipal, password: string): Promise<Row | null> {
  if (session.role !== 'admin') throw new HttpError(403, 'Only administrators can reset a password', 'FORBIDDEN');
  const hashed = await hashPassword(password);
  const now = new Date().toISOString();
  const result = await env.REGISTRATION_DB.prepare(
    `UPDATE admin_users SET password_hash = ?, reset_required = 0, reset_metadata = ?, updated_at = ?
     WHERE id = ? AND is_active = 1`,
  ).bind(hashed, JSON.stringify({ changed_at: now, changed_by: session.userId }), now, session.userId).run();
  if (!result.meta?.changes) throw new HttpError(409, 'Password reset could not be completed', 'PASSWORD_RESET_FAILED');
  await env.REGISTRATION_DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_type = \'admin\' AND user_id = ? AND id <> ? AND revoked_at IS NULL')
    .bind(now, session.userId, session.sessionId).run();
  return loadSessionUser(env, session);
}

export async function loadSessionUser(env: Env, session: SessionPrincipal): Promise<Row | null> {
  const table = session.role === 'admin' ? 'admin_users' : 'clubs';
  const row = await env.REGISTRATION_DB.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`)
    .bind(session.userId).first<Row>();
  return stripSecrets(row);
}

export async function audit(
  env: Env,
  requestId: string,
  request: Request,
  actor: SessionPrincipal | null,
  action: string,
  tableName?: string,
  recordId?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await env.REGISTRATION_DB.prepare(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, table_name, record_id, request_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    actor?.role || 'public',
    actor?.userId || null,
    action,
    tableName || null,
    recordId || null,
    requestId,
    JSON.stringify({ method: request.method, path: new URL(request.url).pathname, ...metadata }),
    new Date().toISOString(),
  ).run();
}
