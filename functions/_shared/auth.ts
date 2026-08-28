import type { Env, Row, SessionPrincipal } from './types';
import { HttpError } from './http';

const COOKIE_NAME = '__Host-rj_session';
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const HEX_64 = /^[a-f0-9]{64}$/i;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!HEX_64.test(stored)) return constantTimeEqual(password, stored);
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
  const principal: SessionPrincipal = {
    sessionId: String(row.id),
    role: row.user_type,
    userId: String(row.user_id),
    expiresAt: String(row.expires_at),
  };
  await env.REGISTRATION_DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
    .bind(now, principal.sessionId).run();
  return principal;
}

export async function requireSession(request: Request, env: Env, roles: Array<'admin' | 'club'> = ['admin', 'club']): Promise<SessionPrincipal> {
  const session = await getSession(request, env);
  if (!session) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
  if (!roles.includes(session.role)) throw new HttpError(403, 'Insufficient permissions', 'FORBIDDEN');
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
