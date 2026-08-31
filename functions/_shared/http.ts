import type { ApiErrorShape, Env, SupabaseResponse } from './types';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'HTTP_ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function requestId(request: Request): string {
  return request.headers.get('cf-ray') || crypto.randomUUID();
}

export function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const ownOrigin = new URL(request.url).origin;
  if (origin === ownOrigin) return origin;
  const configured = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return configured.includes(origin) ? origin : null;
}

export function responseHeaders(request: Request, env: Env, id: string): Headers {
  const headers = new Headers({
    'X-Request-Id': id,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  });
  const origin = allowedOrigin(request, env);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, Idempotency-Key');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return headers;
}

export function jsonResponse(
  request: Request,
  env: Env,
  id: string,
  body: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = responseHeaders(request, env, id);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.append(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}

export function supabaseResponse<T>(
  request: Request,
  env: Env,
  id: string,
  data: T | null,
  error: ApiErrorShape | null = null,
  count: number | null = null,
  status = 200,
): Response {
  const payload: SupabaseResponse<T> = { data, error, count };
  return jsonResponse(request, env, id, payload, status);
}

export function errorResponse(request: Request, env: Env, id: string, error: unknown, supabase = false): Response {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const databaseError = !(error instanceof HttpError) && /LIMIT_CONFIGS_QUOTA_EXCEEDED/i.test(rawMessage)
    ? new HttpError(409, '报名限额已达到，请选择其他项目或分组', 'REGISTRATION_QUOTA_EXCEEDED')
    : !(error instanceof HttpError) && /GROUP_CAPACITY_EXCEEDED/i.test(rawMessage)
    ? new HttpError(409, '该组别报名人数已满', 'GROUP_CAPACITY_EXCEEDED')
    : !(error instanceof HttpError) && /DUPLICATE_ENTRY/i.test(rawMessage)
      ? new HttpError(409, '已存在相同的报名记录', 'DUPLICATE_ENTRY')
    : !(error instanceof HttpError) && /UNIQUE constraint failed/i.test(rawMessage)
      ? new HttpError(409, '已存在使用相同唯一值的记录', 'UNIQUE_VIOLATION')
      : !(error instanceof HttpError) && /FOREIGN KEY constraint failed/i.test(rawMessage)
        ? new HttpError(409, '所引用的记录不存在或仍被使用', 'FOREIGN_KEY_VIOLATION')
        : !(error instanceof HttpError) && /CHECK constraint failed|NOT NULL constraint failed/i.test(rawMessage)
          ? new HttpError(400, '提交的数据违反数据库约束', 'CONSTRAINT_VIOLATION')
          : error;
  const known = databaseError instanceof HttpError;
  const status = known ? databaseError.status : 500;
  const bodyError: ApiErrorShape = {
    message: known ? databaseError.message : 'Internal server error',
    code: known ? databaseError.code : 'INTERNAL_ERROR',
    ...(known && databaseError.details !== undefined ? { details: databaseError.details } : {}),
  };
  console.error(JSON.stringify({
    level: 'error',
    request_id: id,
    status,
    code: bodyError.code,
    message: rawMessage,
  }));
  // Surface rate-limit hints as standard HTTP headers so well-behaved
  // clients (and our own frontend) can back off intelligently without
  // parsing the response body.
  const extraHeaders: Record<string, string> = {};
  if (known && bodyError.code === 'RATE_LIMITED' && databaseError.details && typeof databaseError.details === 'object') {
    const retry = (databaseError.details as { retry_after_seconds?: unknown }).retry_after_seconds;
    if (typeof retry === 'number' && retry > 0) {
      extraHeaders['Retry-After'] = String(Math.ceil(retry));
    }
  }
  return supabase
    ? supabaseResponse(request, env, id, null, bodyError, null, status)
    : jsonResponse(request, env, id, { error: bodyError, request_id: id }, status, extraHeaders);
}

export function corsPreflight(request: Request, env: Env, id: string): Response {
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigin(request, env)) {
    return errorResponse(request, env, id, new HttpError(403, '请求来源不被允许', 'CORS_ORIGIN_DENIED'));
  }
  return new Response(null, { status: 204, headers: responseHeaders(request, env, id) });
}

export async function readJson<T>(request: Request, maxBytes = 256 * 1024): Promise<T> {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, '请求必须为 application/json 格式', 'UNSUPPORTED_MEDIA_TYPE');
  }
  const length = Number(request.headers.get('Content-Length') || '0');
  if (length > maxBytes) throw new HttpError(413, '请求内容超过大小限制', 'PAYLOAD_TOO_LARGE');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpError(413, '请求内容超过大小限制', 'PAYLOAD_TOO_LARGE');
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON', 'INVALID_JSON');
  }
}

export function assertMethod(request: Request, method: string): void {
  if (request.method !== method) throw new HttpError(405, `不允许使用 ${request.method} 方法`, 'METHOD_NOT_ALLOWED');
}
