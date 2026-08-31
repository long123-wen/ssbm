import type { DataQueryRequest, Env, QueryFilter, Row, SessionPrincipal } from './types';
import { HttpError } from './http';
import { stripSecrets } from './auth';
import { collectAthleteAvatarKeys, deleteR2ByKey, deleteR2ByKeys } from './r2';

type WaitUntil = (promise: Promise<unknown>) => void;

type TableName = keyof typeof TABLES;
type TableConfig = {
  columns: readonly string[];
  json?: readonly string[];
  booleans?: readonly string[];
  publicRead?: boolean;
  clubRead?: boolean;
  ownerColumn?: string;
};

export const TABLES = {
  competitions: {
    columns: ['id','name','subtitle','venue','start_date','end_date','registration_deadline','status','description','logo_url','max_individual_events','max_team_events','created_at','updated_at'],
    publicRead: true,
  },
  events: {
    columns: ['id','competition_id','name','code','category','description','max_athletes','is_individual','order_index','created_at','updated_at'],
    booleans: ['is_individual'], publicRead: true,
  },
  event_groups: {
    columns: ['id','event_id','name','type','gender','age_min','age_max','max_registrations','current_count','order_index','created_at','updated_at'], publicRead: true,
  },
  clubs: {
    columns: ['id','username','password_hash','club_name','contact_name','phone','email','province','city','is_approved','created_at','updated_at'],
    booleans: ['is_approved'], ownerColumn: 'id',
  },
  team_profiles: {
    columns: ['id','club_id','competition_id','team_name','slogan','logo_url','max_athletes','created_at','updated_at'], ownerColumn: 'club_id',
  },
  team_leaders: {
    columns: ['id','club_id','competition_id','team_profile_id','name','phone','position','created_at','updated_at'], ownerColumn: 'club_id',
  },
  coaches: {
    columns: ['id','club_id','competition_id','team_profile_id','name','phone','certificate','level','created_at','updated_at'], ownerColumn: 'club_id',
  },
  athletes: {
    columns: ['id','club_id','competition_id','team_profile_id','name','gender','birth_date','id_card','phone','avatar_url','created_at','updated_at'], ownerColumn: 'club_id',
  },
  registrations: {
    columns: ['id','competition_id','club_id','team_profile_id','club_name','event_id','event_name','group_id','group_name','athletes','coach_id','coach_name','status','reject_reason','start_order','bib_number','created_at','updated_at'],
    json: ['athletes'], ownerColumn: 'club_id',
  },
  order_entries: {
    columns: ['id','competition_id','event_id','event_name','group_id','group_name','start_order','session_label','session_number','venue_number','bib_number','club_id','club_name','athletes','coach_name','created_at'],
    json: ['athletes'], ownerColumn: 'club_id', clubRead: true,
  },
  admin_users: {
    columns: ['id','username','password_hash','display_name','role','is_active','reset_required','reset_metadata','created_at','updated_at'],
    json: ['reset_metadata'], booleans: ['is_active','reset_required'],
  },
  limit_configs: {
    columns: ['id','competition_id','scope','target_id','max_registrations','created_at','updated_at'], clubRead: true,
  },
} as const satisfies Record<string, TableConfig>;

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const MAX_ROWS = 1000;
// Registrations have stateful domain rules and are writeable only via dedicated
// workflow endpoints. Generic data access remains read-only for them.
const CLUB_TABLES = new Set<TableName>(['clubs','team_profiles','team_leaders','coaches','athletes','registrations']);
const ADMIN_ONLY_TABLES = new Set<TableName>(['admin_users','limit_configs']);
const WORKFLOW_ONLY_WRITES = new Set<TableName>(['registrations','order_entries']);
const SERVER_COLUMNS = new Set(['id','created_at','updated_at']);

function tableConfig(table: string): TableConfig & { name: TableName } {
  if (!IDENTIFIER.test(table) || !(table in TABLES)) throw new HttpError(404, 'Unknown table', 'TABLE_NOT_ALLOWED');
  return { ...TABLES[table as TableName], name: table as TableName };
}

function assertColumn(config: TableConfig, column: string): void {
  if (!IDENTIFIER.test(column) || !config.columns.includes(column)) {
    throw new HttpError(400, `Column is not allowed: ${column}`, 'COLUMN_NOT_ALLOWED');
  }
}

function selectedColumns(config: TableConfig, columns?: string): string[] {
  if (!columns || columns.trim() === '*') return [...config.columns].filter(column => column !== 'password_hash' && column !== 'reset_metadata');
  const selected = columns.split(',').map(column => column.trim()).filter(Boolean);
  if (!selected.length || selected.length > config.columns.length) throw new HttpError(400, 'Invalid columns selection', 'INVALID_COLUMNS');
  for (const column of selected) assertColumn(config, column);
  return selected.filter(column => column !== 'password_hash' && column !== 'reset_metadata');
}

function normalizeValue(config: TableConfig, column: string, value: unknown): unknown {
  if (config.json?.includes(column)) {
    if (typeof value === 'string') {
      try { JSON.parse(value); return value; } catch { throw new HttpError(400, `${column} must contain valid JSON`, 'INVALID_JSON_COLUMN'); }
    }
    return JSON.stringify(value ?? (column === 'custom_fields' ? {} : []));
  }
  if (config.booleans?.includes(column)) {
    if (value === true || value === 1) return 1;
    if (value === false || value === 0) return 0;
    throw new HttpError(400, `${column} must be a boolean`, 'INVALID_BOOLEAN');
  }
  if (value === undefined) return null;
  if (typeof value === 'object' && value !== null) throw new HttpError(400, `${column} must be a scalar value`, 'INVALID_VALUE');
  return value;
}

function decodeRow(config: TableConfig, row: Row): Row {
  const decoded = { ...row };
  for (const column of config.json || []) {
    if (typeof decoded[column] === 'string') {
      try { decoded[column] = JSON.parse(decoded[column] as string); } catch { decoded[column] = null; }
    }
  }
  for (const column of config.booleans || []) {
    if (decoded[column] !== null && decoded[column] !== undefined) decoded[column] = Boolean(decoded[column]);
  }
  return stripSecrets(decoded) || {};
}

function filtersSql(config: TableConfig, filters: QueryFilter[] = [], values: unknown[]): string[] {
  if (!Array.isArray(filters) || filters.length > 20) throw new HttpError(400, 'Too many filters', 'INVALID_FILTERS');
  const clauses: string[] = [];
  for (const filter of filters) {
    if (!filter || typeof filter !== 'object') throw new HttpError(400, 'Invalid filter', 'INVALID_FILTER');
    assertColumn(config, filter.column);
    if (filter.op === 'eq' || filter.op === 'neq' || filter.op === 'not_eq') {
      if (filter.value === null) clauses.push(`${filter.column} ${filter.op === 'eq' ? 'IS' : 'IS NOT'} NULL`);
      else {
        clauses.push(`${filter.column} ${filter.op === 'eq' ? '=' : '<>'} ?`);
        values.push(normalizeValue(config, filter.column, filter.value));
      }
    } else if (filter.op === 'in') {
      if (!Array.isArray(filter.value) || filter.value.length < 1 || filter.value.length > 100) {
        throw new HttpError(400, 'in filters require 1-100 values', 'INVALID_IN_FILTER');
      }
      clauses.push(`${filter.column} IN (${filter.value.map(() => '?').join(',')})`);
      for (const value of filter.value) values.push(normalizeValue(config, filter.column, value));
    } else if (filter.op === 'ilike') {
      if (typeof filter.value !== 'string' || filter.value.length > 256) throw new HttpError(400, 'ilike requires a short string', 'INVALID_ILIKE_FILTER');
      clauses.push(`LOWER(${filter.column}) LIKE LOWER(?)`);
      values.push(filter.value);
    } else {
      throw new HttpError(400, 'Filter operation is not allowed', 'FILTER_NOT_ALLOWED');
    }
  }
  return clauses;
}

function role(session: SessionPrincipal | null): 'public' | 'club' | 'admin' {
  return session?.role || 'public';
}

function authorize(config: TableConfig & { name: TableName }, action: DataQueryRequest['action'], session: SessionPrincipal | null): void {
  const actor = role(session);
  if (action !== 'select' && WORKFLOW_ONLY_WRITES.has(config.name)) {
    throw new HttpError(403, 'This resource may only be changed through its dedicated workflow API', 'WORKFLOW_ENDPOINT_REQUIRED');
  }
  if (actor === 'admin') return;
  if (action === 'select') {
    if (config.publicRead || (actor === 'club' && (config.clubRead || CLUB_TABLES.has(config.name)))) return;
    throw new HttpError(403, 'Read access denied', 'FORBIDDEN');
  }
  if (actor === 'public' && action === 'insert' && config.name === 'clubs') return;
  if (actor === 'club' && config.name === 'clubs' && action === 'insert') {
    throw new HttpError(403, 'Authenticated clubs cannot create additional club accounts', 'FORBIDDEN');
  }
  if (actor === 'club' && CLUB_TABLES.has(config.name)) return;
  throw new HttpError(403, 'Write access denied', 'FORBIDDEN');
}

function addOwnership(config: TableConfig & { name: TableName }, session: SessionPrincipal | null, clauses: string[], values: unknown[]): void {
  if (session?.role !== 'club' || !config.ownerColumn) return;
  clauses.push(`${config.ownerColumn} = ?`);
  values.push(session.userId);
}

function validateRequest(body: DataQueryRequest): void {
  if (!body || typeof body !== 'object' || !['select','insert','update','delete'].includes(body.action)) {
    throw new HttpError(400, 'Invalid query action', 'INVALID_ACTION');
  }
  if (body.order && (!Array.isArray(body.order) || body.order.length > 5)) throw new HttpError(400, 'Invalid order', 'INVALID_ORDER');
  if (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 0 || body.limit > MAX_ROWS)) {
    throw new HttpError(400, `limit must be between 0 and ${MAX_ROWS}`, 'INVALID_LIMIT');
  }
  if (body.single && body.single !== 'single' && body.single !== 'maybeSingle') throw new HttpError(400, 'Invalid single mode', 'INVALID_SINGLE');
  if (body.count && body.count !== 'exact') throw new HttpError(400, 'Only exact counts are supported', 'INVALID_COUNT');
}

function writableRow(
  config: TableConfig & { name: TableName },
  input: Row,
  session: SessionPrincipal | null,
  isInsert: boolean,
): Row {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Payload rows must be objects', 'INVALID_PAYLOAD');
  const output: Row = {};
  const actor = role(session);
  for (const [column, value] of Object.entries(input)) {
    assertColumn(config, column);
    if (SERVER_COLUMNS.has(column)) continue;
    if ((column === 'password_hash' || column === 'reset_metadata') && actor !== 'admin' && !(actor === 'public' && config.name === 'clubs' && column === 'password_hash')) {
      throw new HttpError(403, `Writing ${column} is not allowed`, 'SENSITIVE_COLUMN');
    }
    if (actor === 'club' && config.name === 'clubs' && ['username','password_hash','is_approved'].includes(column)) {
      throw new HttpError(403, `Writing ${column} is not allowed`, 'FORBIDDEN_COLUMN');
    }
    if (actor === 'public' && config.name === 'clubs' && !['username','password_hash','club_name','contact_name','phone','email','province','city'].includes(column)) {
      continue;
    }
    if (column === 'password_hash' && (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value))) {
      throw new HttpError(400, 'password_hash must be a 64-char SHA-256 hash', 'INVALID_PASSWORD_HASH');
    }
    output[column] = normalizeValue(config, column, value);
  }
  if (session?.role === 'club' && config.ownerColumn) output[config.ownerColumn] = session.userId;
  if (isInsert) {
    output.id = typeof input.id === 'string' && actor === 'admin' ? input.id : crypto.randomUUID();
    if (config.columns.includes('created_at')) output.created_at = new Date().toISOString();
    if (config.columns.includes('updated_at')) output.updated_at = new Date().toISOString();
    if (config.name === 'clubs' && actor === 'public') output.is_approved = 1;
  } else if (config.columns.includes('updated_at')) {
    output.updated_at = new Date().toISOString();
  }
  return output;
}

function requirePayload(body: DataQueryRequest): Row[] {
  const rows = Array.isArray(body.payload) ? body.payload : body.payload ? [body.payload] : [];
  if (!rows.length || rows.length > 200) throw new HttpError(400, 'payload must contain 1-200 rows', 'INVALID_PAYLOAD');
  return rows;
}

async function validateOwnedReferences(
  env: Env,
  config: TableConfig & { name: TableName },
  row: Row,
  session: SessionPrincipal | null,
): Promise<void> {
  if (session?.role !== 'club') return;
  if (typeof row.team_profile_id === 'string' && row.team_profile_id) {
    const profile = await env.REGISTRATION_DB.prepare(
      'SELECT id, competition_id FROM team_profiles WHERE id = ? AND club_id = ? LIMIT 1',
    ).bind(row.team_profile_id, session.userId).first<Row>();
    if (!profile || (typeof row.competition_id === 'string' && profile.competition_id !== row.competition_id)) {
      throw new HttpError(403, 'The selected team profile does not belong to this club or competition', 'INVALID_OWNED_REFERENCE');
    }
  }
  if (config.name === 'registrations' && typeof row.coach_id === 'string' && row.coach_id) {
    const coach = await env.REGISTRATION_DB.prepare(
      'SELECT id, competition_id FROM coaches WHERE id = ? AND club_id = ? LIMIT 1',
    ).bind(row.coach_id, session.userId).first<Row>();
    if (!coach || (typeof row.competition_id === 'string' && coach.competition_id !== row.competition_id)) {
      throw new HttpError(403, 'The selected coach does not belong to this club or competition', 'INVALID_OWNED_REFERENCE');
    }
  }
}

async function selectRows(env: Env, config: TableConfig & { name: TableName }, body: DataQueryRequest, session: SessionPrincipal | null): Promise<{ data: unknown; count: number | null }> {
  const columns = selectedColumns(config, body.columns);
  const values: unknown[] = [];
  const clauses = filtersSql(config, body.filters, values);
  addOwnership(config, session, clauses, values);
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  let count: number | null = null;
  if (body.count === 'exact') {
    const countRow = await env.REGISTRATION_DB.prepare(`SELECT COUNT(*) AS total FROM ${config.name}${where}`).bind(...values).first<Row>();
    count = Number(countRow?.total || 0);
  }
  if (body.head) return { data: null, count };
  let sql = `SELECT ${columns.join(', ')} FROM ${config.name}${where}`;
  if (body.order) {
    const terms = body.order.map(item => {
      assertColumn(config, item.column);
      if (typeof item.ascending !== 'boolean') throw new HttpError(400, 'ascending must be boolean', 'INVALID_ORDER');
      return `${item.column} ${item.ascending ? 'ASC' : 'DESC'}`;
    });
    if (terms.length) sql += ` ORDER BY ${terms.join(', ')}`;
  }
  const effectiveLimit = body.single ? 2 : (body.limit ?? MAX_ROWS);
  sql += ' LIMIT ?';
  const result = await env.REGISTRATION_DB.prepare(sql).bind(...values, effectiveLimit).all<Row>();
  const rows = (result.results || []).map(row => decodeRow(config, row));
  if (body.single) {
    if (rows.length > 1) throw new HttpError(406, 'JSON object requested, multiple rows returned', 'PGRST116');
    if (!rows.length && body.single === 'single') throw new HttpError(406, 'JSON object requested, no rows returned', 'PGRST116');
    return { data: rows[0] || null, count };
  }
  return { data: rows, count };
}

async function insertRows(env: Env, config: TableConfig & { name: TableName }, body: DataQueryRequest, session: SessionPrincipal | null): Promise<unknown> {
  const rows = requirePayload(body).map(row => writableRow(config, row, session, true));
  for (const row of rows) {
    await validateOwnedReferences(env, config, row, session);
  }
  const statements = rows.map(row => {
    const columns = Object.keys(row);
    if (!columns.length) throw new HttpError(400, 'No writable columns', 'EMPTY_PAYLOAD');
    return env.REGISTRATION_DB.prepare(
      `INSERT INTO ${config.name} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING *`,
    ).bind(...columns.map(column => row[column]));
  });
  const results = await env.REGISTRATION_DB.batch<Row>(statements);
  const inserted = results.flatMap(result => (result.results || []).map(item => decodeRow(config, item)));
  if (body.single) {
    if (inserted.length !== 1) throw new HttpError(406, 'Single row response expected', 'PGRST116');
    return inserted[0];
  }
  return inserted;
}

async function updateRows(env: Env, config: TableConfig & { name: TableName }, body: DataQueryRequest, session: SessionPrincipal | null): Promise<unknown> {
  if (Array.isArray(body.payload)) throw new HttpError(400, 'Update payload must be one object', 'INVALID_PAYLOAD');
  const payload = writableRow(config, (body.payload || {}) as Row, session, false);
  await validateOwnedReferences(env, config, payload, session);
  const columns = Object.keys(payload);
  if (!columns.length) throw new HttpError(400, 'No writable columns', 'EMPTY_PAYLOAD');
  const values = columns.map(column => payload[column]);
  const clauses = filtersSql(config, body.filters, values);
  addOwnership(config, session, clauses, values);
  if (!clauses.length) throw new HttpError(400, 'Updates require at least one filter', 'FILTER_REQUIRED');
  const result = await env.REGISTRATION_DB.prepare(
    `UPDATE ${config.name} SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE ${clauses.join(' AND ')} RETURNING *`,
  ).bind(...values).all<Row>();
  const rows = (result.results || []).map(row => decodeRow(config, row));
  if (body.single) {
    if (rows.length !== 1 && (rows.length || body.single === 'single')) throw new HttpError(406, 'Single row response expected', 'PGRST116');
    return rows[0] || null;
  }
  return rows;
}

async function collectAthleteAvatarKeysBeforeDelete(env: Env, config: TableConfig & { name: TableName }, filterClauses: string[], filterValues: unknown[]): Promise<string[]> {
  if (config.name !== 'competitions' && config.name !== 'clubs') return [];
  const fkColumn = config.name === 'competitions' ? 'competition_id' : 'club_id';
  // 只关心有 avatar_url 的运动员；limit 上限取 MAX_ROWS * 5 防爆。
  const sql = `SELECT avatar_url FROM athletes WHERE ${fkColumn} IN (SELECT id FROM ${config.name} WHERE ${filterClauses.join(' AND ')}) AND avatar_url IS NOT NULL LIMIT 5000`;
  try {
    const result = await env.REGISTRATION_DB.prepare(sql).bind(...filterValues).all<Row>();
    return collectAthleteAvatarKeys(result.results || [], 'avatar_url');
  } catch (err) {
    console.warn(`[db] failed to collect athlete avatars for cascading delete (table=${config.name}):`, (err as Error)?.message || err);
    return [];
  }
}

async function deleteRows(env: Env, config: TableConfig & { name: TableName }, body: DataQueryRequest, session: SessionPrincipal | null, waitUntil?: WaitUntil): Promise<unknown> {
  const values: unknown[] = [];
  const clauses = filtersSql(config, body.filters, values);
  addOwnership(config, session, clauses, values);
  if (!clauses.length) throw new HttpError(400, 'Deletes require at least one filter', 'FILTER_REQUIRED');

  // 联动清理：competitions / clubs 表的删除会通过 ON DELETE CASCADE 带走 athletes，
  // 因此先在 DELETE 之前 SELECT 收集这些运动员的 avatar_url（仅取 athlete-avatars 桶内 key）。
  // athletes 表自身则可以直接从 RETURNING 行中提取。
  const cascadingKeys = await collectAthleteAvatarKeysBeforeDelete(env, config, clauses, [...values]);

  const result = await env.REGISTRATION_DB.prepare(
    `DELETE FROM ${config.name} WHERE ${clauses.join(' AND ')} RETURNING *`,
  ).bind(...values).all<Row>();
  const rows = (result.results || []).map(row => decodeRow(config, row));

  // 调度异步 R2 清理：不阻塞主请求，但确保在响应返回后执行。
  if (waitUntil && env.REGISTRATION_MEDIA) {
    if (config.name === 'athletes') {
      const singleKey = collectAthleteAvatarKeys(rows, 'avatar_url')[0];
      if (singleKey) waitUntil(deleteR2ByKey(env, singleKey));
    } else if (cascadingKeys.length > 0) {
      waitUntil(deleteR2ByKeys(env, cascadingKeys));
    }
  }

  if (body.single) {
    if (rows.length !== 1 && (rows.length || body.single === 'single')) throw new HttpError(406, 'Single row response expected', 'PGRST116');
    return rows[0] || null;
  }
  return rows;
}

export async function executeDataQuery(
  env: Env,
  table: string,
  body: DataQueryRequest,
  session: SessionPrincipal | null,
  waitUntil?: WaitUntil,
): Promise<{ data: unknown; count: number | null }> {
  validateRequest(body);
  const config = tableConfig(table);
  authorize(config, body.action, session);
  if (body.action === 'select') return selectRows(env, config, body, session);
  if (ADMIN_ONLY_TABLES.has(config.name) && session?.role !== 'admin') throw new HttpError(403, 'Admin access required', 'FORBIDDEN');
  const data = body.action === 'insert'
    ? await insertRows(env, config, body, session)
    : body.action === 'update'
      ? await updateRows(env, config, body, session)
      : await deleteRows(env, config, body, session, waitUntil);
  const count = body.count === 'exact' ? (Array.isArray(data) ? data.length : data ? 1 : 0) : null;
  return { data, count };
}
