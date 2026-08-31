import type { DataQueryRequest, Env, PagesFunction, Row, SessionPrincipal } from './_shared/types';
import { executeDataQuery } from './_shared/db';
import {
  createClubRegistration,
  cancelClubRegistrations,
  replaceClubRegistrations,
  adminUnlockClubRegistration,
  deleteClubRegistration,
  generateOrderBook,
  importScorecardOrderBook,
  getCurrentScorecardImport,
  unpublishScorecardImport,
  getClubScorecardEntries,
  getCurrentOrderBook,
  getClubRegistrationEditState,
  listAdminRegistrations,
  resubmitClubRegistration,
  reviewBatch,
  updateClubRegistration,
} from './_shared/workflows';
import {
  audit,
  clearSessionCookie,
  createSession,
  getSession,
  loadSessionUser,
  requireSession,
  revokeCurrentSession,
  resetAdminPassword,
  sessionCookie,
  sha256,
  stripSecrets,
  verifyPassword,
} from './_shared/auth';
import {
  HttpError,
  allowedOrigin,
  assertMethod,
  corsPreflight,
  errorResponse,
  jsonResponse,
  readJson,
  requestId,
  responseHeaders,
  supabaseResponse,
} from './_shared/http';
import {
  clearAuthFailures,
  enforceRateLimit,
  recordAuthFailure,
} from './_shared/rate-limit';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_USERNAME_LENGTH = 100;
const MAX_PASSWORD_LENGTH = 256;

function pathSegments(request: Request): string[] {
  return new URL(request.url).pathname.split('/').filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment); } catch { throw new HttpError(400, 'Invalid URL encoding', 'INVALID_PATH'); }
  });
}

function validateCredentials(body: unknown): { username: string; password: string } {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Credentials are required', 'INVALID_CREDENTIALS');
  const input = body as Record<string, unknown>;
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!username || username.length > MAX_USERNAME_LENGTH || !password || password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, 'Invalid username or password format', 'INVALID_CREDENTIALS');
  }
  return { username, password };
}

async function login(
  request: Request,
  env: Env,
  id: string,
  role: 'admin' | 'club',
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  assertMethod(request, 'POST');
  const { username, password } = validateCredentials(await readJson<unknown>(request, 16 * 1024));
  // Check rate limit *after* validating payload so we never burn a counter
  // entry on malformed requests, but *before* touching the DB so the
  // expensive password verification is skipped during an active lockout.
  await enforceRateLimit(env, request, 'login', { username });
  const table = role === 'admin' ? 'admin_users' : 'clubs';
  const activeColumn = role === 'admin' ? 'is_active' : 'is_approved';
  const user = await env.REGISTRATION_DB.prepare(
    `SELECT * FROM ${table} WHERE username = ? COLLATE NOCASE AND ${activeColumn} = 1 LIMIT 1`,
  ).bind(username).first<Row>();
  const fallbackHash = 'd9e744e5eb53588ee2dc852c290cea3b27de7bcc6a02fba81d5683165fe12586';
  const storedHash = user && typeof user.password_hash === 'string' ? user.password_hash : fallbackHash;
  const passwordMatches = await verifyPassword(password, storedHash);
  if (!user || !passwordMatches) {
    waitUntil(recordAuthFailure(env, request, 'login', { username }));
    throw new HttpError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
  }
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) {
    await env.REGISTRATION_DB.prepare(`UPDATE ${table} SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .bind(await sha256(password), new Date().toISOString(), user.id).run();
  }
  const token = await createSession(env, role, String(user.id), request);
  const mustResetPassword = role === 'admin' && Number(user.reset_required) === 1;
  const safeUser = stripSecrets(user);
  waitUntil(audit(env, id, request, { role, userId: String(user.id), sessionId: '', expiresAt: '', ...(mustResetPassword ? { mustResetPassword: true } : {}) }, 'auth.login', table, String(user.id)));
  waitUntil(clearAuthFailures(env, request, 'login', { username }));
  return jsonResponse(request, env, id, { data: { role, user: safeUser, must_reset_password: mustResetPassword }, error: null }, 200, {
    'Set-Cookie': sessionCookie(token, env),
  });
}

async function logout(request: Request, env: Env, id: string): Promise<Response> {
  assertMethod(request, 'POST');
  await revokeCurrentSession(request, env);
  return jsonResponse(request, env, id, { data: null, error: null }, 200, { 'Set-Cookie': clearSessionCookie() });
}

async function resetPassword(request: Request, env: Env, id: string): Promise<Response> {
  assertMethod(request, 'POST');
  const session = await requireSession(request, env, ['admin'], true);
  const body = await readJson<Record<string, unknown>>(request, 16 * 1024);
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
  if (password.length < 12 || password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(422, 'Password must be 12-256 characters', 'INVALID_PASSWORD');
  }
  if (password !== confirmPassword) throw new HttpError(422, 'Passwords do not match', 'PASSWORD_MISMATCH');
  const user = await resetAdminPassword(env, session, password);
  return jsonResponse(request, env, id, { data: { role: 'admin', user, must_reset_password: false }, error: null }, 200);
}

async function sessionInfo(request: Request, env: Env, id: string): Promise<Response> {
  assertMethod(request, 'GET');
  const session = await getSession(request, env);
  if (!session) return jsonResponse(request, env, id, { data: null, error: null }, 200);
  const user = await loadSessionUser(env, session);
  if (!user) throw new HttpError(401, 'Session user no longer exists', 'INVALID_SESSION');
  return jsonResponse(request, env, id, { data: { role: session.role, user, expires_at: session.expiresAt, must_reset_password: Boolean(session.mustResetPassword) }, error: null });
}

function objectKey(segments: string[]): { bucket: string; key: string } {
  const bucket = segments[2] || '';
  const objectSegments = segments.slice(4);
  if (segments[3] !== 'object' || bucket !== 'athlete-avatars') {
    throw new HttpError(404, 'Storage bucket not found', 'BUCKET_NOT_ALLOWED');
  }
  if (!objectSegments.length || objectSegments.some(value => !value || value === '.' || value === '..' || value.includes('\\'))) {
    throw new HttpError(400, 'Invalid object key', 'INVALID_OBJECT_KEY');
  }
  const path = objectSegments.join('/');
  if (path.length > 900) throw new HttpError(400, 'Object key is too long', 'INVALID_OBJECT_KEY');
  return { bucket, key: `${bucket}/${path}` };
}

async function storage(request: Request, env: Env, id: string, segments: string[], waitUntil: (promise: Promise<unknown>) => void): Promise<Response> {
  if (!env.REGISTRATION_MEDIA) {
    throw new HttpError(503, '媒体存储尚未启用，请先在 Cloudflare 账户中开通 R2', 'MEDIA_STORAGE_UNAVAILABLE');
  }
  const { bucket, key } = objectKey(segments);
  if (request.method === 'GET') {
    // Athlete avatars are private. We require a session and verify that the
    // first path segment of the object key equals the club owner (for club
    // sessions) or accept any admin. Without this check anyone with a guessable
    // URL could enumerate athlete photos.
    const session = await requireSession(request, env, ['club', 'admin']);
    const pathOnly = key.slice(bucket.length + 1);
    const firstSegment = pathOnly.split('/').filter(Boolean)[0] || '';
    if (!firstSegment || firstSegment.includes('\\') || firstSegment === '.' || firstSegment === '..') {
      throw new HttpError(400, 'Invalid object key', 'INVALID_OBJECT_KEY');
    }
    if (session.role === 'club' && firstSegment !== session.userId) {
      waitUntil(audit(env, id, request, session, 'storage.get.forbidden', bucket, key));
      throw new HttpError(403, 'You do not have access to this resource', 'FORBIDDEN_RESOURCE');
    }
    const object = await env.REGISTRATION_MEDIA.get(key);
    if (!object || !object.body) throw new HttpError(404, 'Object not found', 'OBJECT_NOT_FOUND');
    const headers = responseHeaders(request, env, id);
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', object.httpMetadata?.contentType || headers.get('Content-Type') || 'application/octet-stream');
    // Browser <img> requests are same-origin so the session cookie is sent
    // automatically; keep cache private so a leaked URL cannot be served from
    // a shared cache once the session is revoked.
    headers.set('Cache-Control', 'private, max-age=300');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    return new Response(object.body, { status: 200, headers });
  }

  const actor = await requireSession(request, env);
  if (request.method === 'PUT') {
    // Writes also enforce club ownership: path's first segment must match the
    // club session's userId. Admins can write on behalf of any club.
    const session = actor;
    const pathOnly = key.slice(bucket.length + 1);
    const firstSegment = pathOnly.split('/').filter(Boolean)[0] || '';
    if (!firstSegment) {
      throw new HttpError(400, 'Invalid object key', 'INVALID_OBJECT_KEY');
    }
    if (session.role === 'club' && firstSegment !== session.userId) {
      throw new HttpError(403, 'You do not have access to this resource', 'FORBIDDEN_RESOURCE');
    }
    const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(mime)) throw new HttpError(415, 'Only JPEG, PNG, WebP, GIF and AVIF images are accepted', 'INVALID_IMAGE_TYPE');
    const declaredLength = Number(request.headers.get('Content-Length') || '0');
    if (declaredLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image exceeds 2 MiB', 'IMAGE_TOO_LARGE');
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image must be between 1 byte and 2 MiB', 'IMAGE_TOO_LARGE');
    await env.REGISTRATION_MEDIA.put(key, bytes, {
      httpMetadata: { contentType: mime, cacheControl: 'private, max-age=300' },
      customMetadata: { uploadedBy: actor.userId, actorRole: actor.role },
    });
    waitUntil(audit(env, id, request, actor, 'storage.put', bucket, key, { bytes: bytes.byteLength, mime }));
    return jsonResponse(request, env, id, { data: { bucket, path: key.slice(bucket.length + 1) }, error: null });
  }
  if (request.method === 'DELETE') {
    // Deletes also enforce club ownership.
    const pathOnly = key.slice(bucket.length + 1);
    const firstSegment = pathOnly.split('/').filter(Boolean)[0] || '';
    if (!firstSegment) {
      throw new HttpError(400, 'Invalid object key', 'INVALID_OBJECT_KEY');
    }
    if (actor.role === 'club' && firstSegment !== actor.userId) {
      throw new HttpError(403, 'You do not have access to this resource', 'FORBIDDEN_RESOURCE');
    }
    await env.REGISTRATION_MEDIA.delete(key);
    waitUntil(audit(env, id, request, actor, 'storage.delete', bucket, key));
    return jsonResponse(request, env, id, { data: null, error: null });
  }
  throw new HttpError(405, 'Storage method is not allowed', 'METHOD_NOT_ALLOWED');
}

async function dataQuery(
  request: Request,
  env: Env,
  id: string,
  table: string,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  assertMethod(request, 'POST');
  const session = await getSession(request, env);
  // 强制改密期间，管理员只允许访问改密与登出端点；通用数据 API 一律拒绝。
  if (session?.mustResetPassword) {
    throw new HttpError(403, 'Password reset is required before continuing', 'PASSWORD_RESET_REQUIRED');
  }
  const body = await readJson<DataQueryRequest>(request);
  const result = await executeDataQuery(env, table, body, session, waitUntil);
  if (body.action !== 'select') {
    const recordId = !Array.isArray(result.data) && result.data && typeof result.data === 'object'
      ? String((result.data as Row).id || '') || undefined
      : undefined;
    waitUntil(audit(env, id, request, session, `data.${body.action}`, table, recordId));
  }
  return supabaseResponse(request, env, id, result.data, null, result.count);
}

function ensureOriginAllowed(request: Request, env: Env): void {
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigin(request, env)) throw new HttpError(403, 'Origin is not allowed', 'CORS_ORIGIN_DENIED');
}

export const onRequest: PagesFunction<Env> = async context => {
  const { request, env, next } = context;
  const id = requestId(request);
  const segments = pathSegments(request);
  const isDataContract = segments[0] === 'api' && segments[1] === 'data';
  // 兜底：根路径与非 API/非 storage 路径交给 Pages 静态层（index.html / admin.html / club.html 等 SPA 入口）
  if (segments[0] !== 'api' && segments[0] !== 'storage') {
    if (next) return next();
    throw new HttpError(404, 'Not found', 'NOT_FOUND');
  }
  try {
    if (!env.REGISTRATION_DB) {
      throw new HttpError(503, 'Required D1 binding is missing', 'BINDING_MISSING');
    }
    if (request.method === 'OPTIONS') return corsPreflight(request, env, id);
    ensureOriginAllowed(request, env);

    // R2 兼容层 storage 路径优先：/storage/<bucket>/object/<key...>
    // 该 URL 直接出现在 avatar_url 字段里（被浏览器 <img> 拉取），
    // 因此必须以根路径方式暴露，不能强制要求 /api/ 前缀。
    if (segments[0] === 'storage' && segments.length >= 4) {
      const storageSegments = ['', ...segments]; // 对齐 segments[1]='storage' 的下标期望
      return await storage(request, env, id, storageSegments, context.waitUntil.bind(context));
    }
    if (segments[1] === 'data' && segments.length === 4 && segments[3] === 'query') {
      return await dataQuery(request, env, id, segments[2], context.waitUntil.bind(context));
    }
    // Critical registration writes are deliberately isolated from the generic data API.
    if (segments[1] === 'club' && segments[2] === 'registrations') {
      const actor = await requireSession(request, env, ['club']);
      let result: { status: number; data: unknown };
      if (segments.length === 4 && segments[3] === 'edit-state' && request.method === 'GET') result = await getClubRegistrationEditState(request, env, actor);
      else if (segments.length === 4 && segments[3] === 'replace' && request.method === 'POST') result = await replaceClubRegistrations(request, env, actor, id);
      else if (segments.length === 3 && request.method === 'POST') result = await createClubRegistration(request, env, actor, id);
      else if (segments.length === 3 && segments[3] === undefined && request.method === 'DELETE') result = await cancelClubRegistrations(request, env, actor, id);
      else if (segments.length === 4 && request.method === 'PUT') result = await updateClubRegistration(request, env, actor, segments[3], id);
      else if (segments.length === 5 && segments[4] === 'resubmit' && request.method === 'POST') result = await resubmitClubRegistration(request, env, actor, segments[3], id);
      else if (segments.length === 4 && request.method === 'DELETE') result = await deleteClubRegistration(request, env, actor, segments[3], id);
      else throw new HttpError(405, 'Registration method is not allowed', 'METHOD_NOT_ALLOWED');
      return jsonResponse(request, env, id, { data: result.data, error: null }, result.status);
    }
    if (segments[1] === 'admin' && segments[2] === 'registrations') {
      const actor = await requireSession(request, env, ['admin']);
      if (segments.length === 3 && request.method === 'GET') {
        const result = await listAdminRegistrations(request, env);
        return jsonResponse(request, env, id, { data: result.data, error: null }, result.status);
      }
      if (segments.length === 4 && segments[3] === 'unlock' && request.method === 'POST') {
        const result = await adminUnlockClubRegistration(request, env, actor, id);
        return jsonResponse(request, env, id, { data: result.data, error: null }, result.status);
      }
      if (segments.length === 4 && segments[3] === 'review' && request.method === 'POST') {
        const result = await reviewBatch(request, env, actor, id);
        return jsonResponse(request, env, id, { data: result.data, error: null }, result.status);
      }
      throw new HttpError(405, 'Admin registration method is not allowed', 'METHOD_NOT_ALLOWED');
    }
    if (segments[1] === 'admin' && segments[2] === 'scorecards' && segments[3] === 'current' && segments.length === 4) {
      if (request.method === 'GET') {
        await requireSession(request, env, ['admin']);
        const competitionId = new URL(request.url).searchParams.get('competitionId')?.trim() || '';
        if (!competitionId) throw new HttpError(422, 'competitionId is required', 'INVALID_FIELD');
        const result = await getCurrentScorecardImport(request, env, competitionId);
        return jsonResponse(request, env, id, { data: result.data, error: null }, result.status);
      }
      if (request.method === 'DELETE') {
        const actor = await requireSession(request, env, ['admin']);
        const competitionId = new URL(request.url).searchParams.get('competitionId')?.trim() || '';
        if (!competitionId) throw new HttpError(422, 'competitionId is required', 'INVALID_FIELD');
        const result = await unpublishScorecardImport(env, actor, competitionId, id, request);
        return jsonResponse(request, env, id, { data: result.data, error: null }, result.status);
      }
      throw new HttpError(405, 'Scorecard method is not allowed', 'METHOD_NOT_ALLOWED');
    }
    if (segments[1] === 'admin' && segments[2] === 'scorecards' && segments[3] === 'import' && segments.length === 4) {
      if (request.method !== 'POST') throw new HttpError(405, 'Scorecard method is not allowed', 'METHOD_NOT_ALLOWED');
      const actor = await requireSession(request, env, ['admin']);
      const result = await importScorecardOrderBook(request, env, actor, id);
      return jsonResponse(request, env, id, { data: result.data, error: null }, result.status);
    }
    if (segments[1] === 'club' && segments[2] === 'scorecards' && segments[3] === 'entries' && segments.length === 4) {
      if (request.method !== 'GET') throw new HttpError(405, 'Scorecard method is not allowed', 'METHOD_NOT_ALLOWED');
      const actor = await requireSession(request, env, ['club']);
      const result = await getClubScorecardEntries(request, env, actor);
      return jsonResponse(request, env, id, { data: result.data, error: null }, result.status);
    }
    if (segments[1] === 'admin' && segments[2] === 'order-books' && segments[3] === 'current' && segments.length === 4) {
      if (request.method !== 'GET') throw new HttpError(405, 'Order book method is not allowed', 'METHOD_NOT_ALLOWED');
      await requireSession(request, env, ['admin']);
      const result = await getCurrentOrderBook(request, env);
      return jsonResponse(request, env, id, { data: result.data, error: null }, result.status);
    }
    if (segments[1] === 'admin' && segments[2] === 'order-books' && segments[3] === 'generate' && segments.length === 4) {
      if (request.method !== 'POST') throw new HttpError(405, 'Order book method is not allowed', 'METHOD_NOT_ALLOWED');
      const actor = await requireSession(request, env, ['admin']);
      const result = await generateOrderBook(request, env, actor, id);
      return jsonResponse(request, env, id, { data: result.data, error: null }, result.status);
    }
    if (segments[1] === 'auth' && segments[2] === 'admin' && segments[3] === 'login' && segments.length === 4) {
      return await login(request, env, id, 'admin', context.waitUntil.bind(context));
    }
    if (segments[1] === 'auth' && segments[2] === 'club' && segments[3] === 'login' && segments.length === 4) {
      return await login(request, env, id, 'club', context.waitUntil.bind(context));
    }
    if (segments[1] === 'auth' && segments[2] === 'logout' && segments.length === 3) return await logout(request, env, id);
    if (segments[1] === 'auth' && segments[2] === 'admin' && segments[3] === 'reset-password' && segments.length === 4) return await resetPassword(request, env, id);
    if (segments[1] === 'auth' && segments[2] === 'session' && segments.length === 3) return await sessionInfo(request, env, id);
    if (segments[1] === 'storage' && segments.length >= 5) {
      return await storage(request, env, id, segments, context.waitUntil.bind(context));
    }
    throw new HttpError(404, 'API route not found', 'NOT_FOUND');
  } catch (error) {
    return errorResponse(request, env, id, error, isDataContract);
  }
};
