import { lookupErrorMessage } from './errorMessages';

export type ApiError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
};

type QueryAction = 'select' | 'insert' | 'update' | 'delete';
type FilterOperator = 'eq' | 'neq' | 'in' | 'not_eq' | 'ilike';
type SingleMode = 'single' | 'maybeSingle';

type QueryFilter = {
  op: FilterOperator;
  column: string;
  value: unknown;
};

type QueryOrder = {
  column: string;
  ascending: boolean;
};

type QueryRequest = {
  action: QueryAction;
  columns?: string;
  filters?: QueryFilter[];
  order?: QueryOrder[];
  limit?: number;
  single?: SingleMode;
  payload?: Record<string, unknown> | Record<string, unknown>[];
  count?: 'exact';
  head?: boolean;
};

export type ApiResult<T = unknown> = {
  data: T | null;
  error: ApiError | null;
  count: number | null;
};

type SelectOptions = {
  count?: 'exact';
  head?: boolean;
};

type UploadOptions = {
  upsert?: boolean;
  contentType?: string;
};

const API_TIMEOUT_MS = 15_000;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const configuredApiBase = String(import.meta.env.VITE_API_BASE_URL || '/api').trim();
const API_BASE_URL = (configuredApiBase || '/api').replace(/\/+$/, '');

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function publicApiUrl(path: string): string {
  const url = apiUrl(path);
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window !== 'undefined') return new URL(url, window.location.origin).toString();
  return url;
}

function encodePath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function normalizeError(value: unknown, status?: number, fallback = '请求失败'): ApiError {
  let rawMessage = fallback;
  let code: string | undefined;
  let details: string | undefined;
  let hint: string | undefined;

  if (typeof value === 'string' && value.trim()) {
    rawMessage = value;
  } else if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const nested = source.error && typeof source.error === 'object'
      ? source.error as Record<string, unknown>
      : source;
    const candidate = nested.message ?? nested.detail ?? source.message ?? source.detail
      ?? (typeof source.error === 'string' ? source.error : undefined);
    if (typeof candidate === 'string' && candidate.trim()) rawMessage = candidate;
    if (typeof nested.code === 'string') code = nested.code;
    if (typeof nested.details === 'string') details = nested.details;
    if (typeof nested.hint === 'string') hint = nested.hint;
  }

  // 按后端 code 查字典，把英文 message 翻译成中文
  const message = lookupErrorMessage(code, rawMessage);
  return { message, code, details, hint, status };
}

function timeoutError(): ApiError {
  return { message: '请求超时，请检查网络连接后重试', code: 'REQUEST_TIMEOUT', status: 408 };
}

function networkError(error: unknown): ApiError {
  const message = error instanceof Error && error.message ? error.message : '无法连接服务器，请检查网络';
  return { message, code: 'NETWORK_ERROR' };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    });
    const body = await parseResponse(response);

    if (!response.ok) {
      return {
        data: null,
        error: normalizeError(body, response.status, `请求失败（${response.status}）`),
        count: null,
      };
    }

    if (body && typeof body === 'object' && ('data' in body || 'error' in body || 'count' in body)) {
      const result = body as { data?: T | null; error?: unknown; count?: number | null };
      return {
        data: result.data ?? null,
        error: result.error ? normalizeError(result.error, response.status) : null,
        count: typeof result.count === 'number' ? result.count : null,
      };
    }

    return { data: body as T, error: null, count: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof DOMException && error.name === 'AbortError' ? timeoutError() : networkError(error),
      count: null,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function jsonRequest<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<ApiResult<T>> {
  return request<T>(path, {
    ...init,
    method: init.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type ApiWorkflowOptions = Omit<RequestInit, 'body' | 'headers'> & {
  headers?: HeadersInit;
  idempotency?: boolean;
};

function createIdempotencyKey(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Typed transport for server-owned workflows. It always sends session cookies,
 * normalizes errors through the existing compatibility layer, and protects every
 * mutation with a fresh Idempotency-Key.
 */
export function apiWorkflow<T>(path: string, body?: unknown, options: ApiWorkflowOptions = {}): Promise<ApiResult<T>> {
  const method = (options.method || (body === undefined ? 'GET' : 'POST')).toUpperCase();
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers = new Headers(options.headers);
  if (mutation && options.idempotency !== false) headers.set('Idempotency-Key', createIdempotencyKey());

  if (body === undefined) {
    return request<T>(path, { ...options, method, headers });
  }
  return jsonRequest<T>(path, body, { ...options, method, headers });
}

class QueryBuilder implements PromiseLike<ApiResult<any>> {
  private readonly table: string;
  private readonly request: QueryRequest;

  constructor(table: string, request?: QueryRequest) {
    this.table = table;
    this.request = request || { action: 'select' };
  }

  private next(patch: Partial<QueryRequest>): QueryBuilder {
    return new QueryBuilder(this.table, { ...this.request, ...patch });
  }

  private addFilter(op: FilterOperator, column: string, value: unknown): QueryBuilder {
    return this.next({ filters: [...(this.request.filters || []), { op, column, value }] });
  }

  select(columns = '*', options: SelectOptions = {}): QueryBuilder {
    return this.next({
      columns,
      count: options.count ?? this.request.count,
      head: options.head ?? this.request.head,
    });
  }

  insert(payload: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder {
    return this.next({ action: 'insert', payload });
  }

  update(payload: Record<string, unknown>): QueryBuilder {
    return this.next({ action: 'update', payload });
  }

  delete(): QueryBuilder {
    return this.next({ action: 'delete' });
  }

  eq(column: string, value: unknown): QueryBuilder {
    return this.addFilter('eq', column, value);
  }

  neq(column: string, value: unknown): QueryBuilder {
    return this.addFilter('neq', column, value);
  }

  in(column: string, values: unknown[]): QueryBuilder {
    return this.addFilter('in', column, values);
  }

  not(column: string, operator: 'eq', value: unknown): QueryBuilder {
    if (operator !== 'eq') {
      throw new Error(`Unsupported not() operator: ${operator}`);
    }
    return this.addFilter('not_eq', column, value);
  }

  ilike(column: string, value: string): QueryBuilder {
    return this.addFilter('ilike', column, value);
  }

  order(column: string, options: { ascending?: boolean } = {}): QueryBuilder {
    return this.next({
      order: [...(this.request.order || []), { column, ascending: options.ascending ?? true }],
    });
  }

  limit(value: number): QueryBuilder {
    return this.next({ limit: value });
  }

  single(): QueryBuilder {
    return this.next({ single: 'single' });
  }

  maybeSingle(): QueryBuilder {
    return this.next({ single: 'maybeSingle' });
  }

  private execute(): Promise<ApiResult<any>> {
    return jsonRequest(`/data/${encodeURIComponent(this.table)}/query`, this.request);
  }

  then<TResult1 = ApiResult<any>, TResult2 = never>(
    onfulfilled?: ((value: ApiResult<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

class StorageBucket {
  private readonly bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  private objectPath(path: string): string {
    const normalizedPath = path.replace(/^\/+/, '').replace(/^object\//, '');
    return `/storage/${encodeURIComponent(this.bucket)}/object/${encodePath(normalizedPath)}`;
  }

  async upload(path: string, file: Blob, options: UploadOptions = {}): Promise<ApiResult<{ path: string; fullPath: string }>> {
    if (file.size > MAX_UPLOAD_BYTES) {
      return {
        data: null,
        error: { message: '文件大小不能超过 2MiB', code: 'FILE_TOO_LARGE', status: 413 },
        count: null,
      };
    }

    const upsert = options.upsert ? 'true' : 'false';
    return request(`${this.objectPath(path)}?upsert=${upsert}`, {
      method: 'PUT',
      headers: {
        'Content-Type': options.contentType || file.type || 'application/octet-stream',
        'X-Upsert': upsert,
      },
      body: file,
    }).then(result => ({
      ...result,
      data: result.error ? null : { path, fullPath: `${this.bucket}/${path}` },
    }));
  }

  async remove(paths: string[]): Promise<ApiResult<{ name: string }[]>> {
    const removed: { name: string }[] = [];
    for (const path of paths) {
      const result = await request<unknown>(this.objectPath(path), { method: 'DELETE' });
      if (result.error) return { data: null, error: result.error, count: removed.length };
      removed.push({ name: path });
    }
    return { data: removed, error: null, count: removed.length };
  }

  getPublicUrl(path: string): { data: { publicUrl: string } } {
    return { data: { publicUrl: publicApiUrl(this.objectPath(path)) } };
  }
}

export const apiAuth = {
  adminLogin: (username: string, password: string) =>
    jsonRequest<Record<string, unknown>>('/auth/admin/login', { username, password }),
  adminResetPassword: (password: string, confirmPassword: string) =>
    jsonRequest<Record<string, unknown>>('/auth/admin/reset-password', { password, confirmPassword }),
  clubLogin: (username: string, password: string) =>
    jsonRequest<Record<string, unknown>>('/auth/club/login', { username, password }),
  logout: () => jsonRequest<null>('/auth/logout'),
  session: () => request<Record<string, unknown>>('/auth/session', { method: 'GET' }),
  logoutKeepalive(): void {
    void fetch(apiUrl('/auth/logout'), {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { Accept: 'application/json' },
    }).catch(() => undefined);
  },
};

export const supabase = {
  from(table: string): QueryBuilder {
    return new QueryBuilder(table);
  },
  storage: {
    from(bucket: string): StorageBucket {
      return new StorageBucket(bucket);
    },
  },
  rpc(name: string, _params?: Record<string, unknown>): Promise<ApiResult<null>> {
    return Promise.resolve({
      data: null,
      error: {
        message: `RPC ${name} is not supported by the HTTP compatibility adapter`,
        code: 'RPC_NOT_SUPPORTED',
      },
      count: null,
    });
  },
};

export const TABLES = {
  competitions: 'competitions',
  events: 'events',
  event_groups: 'event_groups',
  clubs: 'clubs',
  team_leaders: 'team_leaders',
  coaches: 'coaches',
  athletes: 'athletes',
  registrations: 'registrations',
  order_entries: 'order_entries',
  admin_users: 'admin_users',
  team_profiles: 'team_profiles',
  limit_configs: 'limit_configs',
} as const;
