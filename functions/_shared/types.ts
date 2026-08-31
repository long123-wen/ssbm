export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number; last_row_id?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<unknown>;
}

export interface R2ObjectBody {
  body: ReadableStream<Uint8Array> | null;
  httpEtag?: string;
  size?: number;
  httpMetadata?: { contentType?: string; cacheControl?: string };
  writeHttpMetadata(headers: Headers): void;
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: Record<string, unknown> }): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ name: string; expiration?: number }>; list_complete: boolean; cursor?: string }>;
}

export interface Env {
  REGISTRATION_DB: D1Database;
  REGISTRATION_MEDIA?: R2Bucket;
  RATE_LIMIT_KV?: KVNamespace;
  ALLOWED_ORIGINS?: string;
  SESSION_TTL_SECONDS?: string;
  // Rate limit tuning knobs (all optional, defaults are used when missing).
  ENABLE_RATE_LIMIT?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RATE_LIMIT_IP_MAX?: string;
  RATE_LIMIT_USER_MAX?: string;
  RATE_LIMIT_LOCKOUT_SECONDS?: string;
}

export type Role = 'public' | 'club' | 'admin';

export interface SessionPrincipal {
  role: 'club' | 'admin';
  userId: string;
  sessionId: string;
  expiresAt: string;
  mustResetPassword?: boolean;
}

export interface FunctionContext<E = Env> {
  request: Request;
  env: E;
  params: Record<string, string | string[] | undefined>;
  data: Record<string, unknown>;
  waitUntil(promise: Promise<unknown>): void;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

export type PagesFunction<E = Env> = (context: FunctionContext<E>) => Response | Promise<Response>;

export type FilterOperation = 'eq' | 'neq' | 'in' | 'not_eq' | 'ilike';
export type QueryAction = 'select' | 'insert' | 'update' | 'delete';

export interface QueryFilter {
  op: FilterOperation;
  column: string;
  value: unknown;
}

export interface DataQueryRequest {
  action: QueryAction;
  columns?: string;
  filters?: QueryFilter[];
  order?: Array<{ column: string; ascending: boolean }>;
  limit?: number;
  single?: 'single' | 'maybeSingle';
  payload?: Record<string, unknown> | Array<Record<string, unknown>>;
  count?: 'exact';
  head?: boolean;
}

export interface ApiErrorShape {
  message: string;
  code?: string;
  details?: unknown;
}

export interface SupabaseResponse<T = unknown> {
  data: T | null;
  error: ApiErrorShape | null;
  count: number | null;
}

export type Row = Record<string, unknown>;
