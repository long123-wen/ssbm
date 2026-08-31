#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migration = join(root, 'migrations', '0001_initial_schema.sql');
const args = process.argv.slice(2);

if (args.some(arg => arg === '--remote' || arg.startsWith('--remote='))) {
  throw new Error('Remote verification is intentionally unsupported. This script always uses Wrangler --local.');
}

let namedDatabase = null;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--database') namedDatabase = args[index + 1] || null;
}
if (args.length && (!namedDatabase || args.length !== 2 || args[0] !== '--database')) {
  throw new Error('Usage: node scripts/verify-d1-schema.mjs [--database EXPLICIT_LOCAL_DB_NAME]');
}
if (namedDatabase && !/^[A-Za-z0-9_-]{1,128}$/.test(namedDatabase)) {
  throw new Error('Database name may only contain letters, digits, underscores, and hyphens.');
}

const temporaryPersist = namedDatabase ? null : mkdtempSync(join(tmpdir(), 'registration-d1-schema-'));
const database = namedDatabase || `registration-schema-check-${process.pid}`;

function wrangler(commandArgs, label) {
  if (!namedDatabase) throw new Error('Wrangler execution is only allowed with --database EXPLICIT_LOCAL_DB_NAME.');
  const executable = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
  const result = spawnSync(
    executable,
    ['d1', 'execute', database, '--local', ...commandArgs],
    { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${label} failed. Wrangler must be installed and the explicitly named local database must be configured.\n${output}`);
  }
  return result.stdout;
}

const requiredTables = [
  'competitions', 'events', 'event_groups', 'clubs', 'team_profiles', 'team_leaders', 'coaches',
  'athletes', 'registrations', 'order_entries', 'admin_users', 'limit_configs',
  'individual_registrations', 'sessions', 'audit_logs',
];

const columnChecks = [
  ['clubs', 'updated_at'],
  ['team_leaders', 'competition_id'],
  ['coaches', 'competition_id'],
  ['athletes', 'competition_id'],
  ['order_entries', 'club_id'],
  ['sessions', 'token_hash'],
  ['audit_logs', 'request_id'],
];

try {
  if (!namedDatabase) {
    let sqlite;
    try {
      ({ DatabaseSync: sqlite } = await import('node:sqlite'));
    } catch {
      throw new Error('Default isolated verification requires Node.js with node:sqlite support. No remote fallback is attempted.');
    }
    const localFile = join(temporaryPersist, 'schema.sqlite');
    const db = new sqlite(localFile);
    try {
      db.exec(readFileSync(migration, 'utf8'));
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
      for (const table of requiredTables) {
        if (!tables.has(table)) throw new Error(`Required table is missing: ${table}`);
      }
      for (const [table, column] of columnChecks) db.prepare(`SELECT ${column} FROM ${table} LIMIT 0`).all();
      const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyErrors.length) throw new Error(`Foreign-key verification failed: ${JSON.stringify(foreignKeyErrors)}`);
      const admin = db.prepare("SELECT username, reset_required FROM admin_users WHERE username = 'admin' AND length(password_hash) = 64").get();
      if (!admin || admin.reset_required !== 1) throw new Error('Default administrator reset metadata is missing.');
    } finally {
      db.close();
    }
  } else {
    const tableUnion = requiredTables
      .map(table => `SELECT '${table}' AS expected, COUNT(*) AS present FROM sqlite_master WHERE type = 'table' AND name = '${table}'`)
      .join(' UNION ALL ');
    const tableOutput = wrangler(['--command', tableUnion], 'Required-table verification');
    for (const table of requiredTables) {
      if (!tableOutput.includes(table)) throw new Error(`Verification output did not contain required table: ${table}`);
    }
    for (const [table, column] of columnChecks) {
      wrangler(['--command', `SELECT ${column} FROM ${table} LIMIT 0`], `Column verification for ${table}.${column}`);
    }
    wrangler(['--command', 'PRAGMA foreign_key_check'], 'Foreign-key verification');
    wrangler(['--command', "SELECT username, reset_required FROM admin_users WHERE username = 'admin' AND length(password_hash) = 64"], 'Default-admin verification');
  }

  console.log(JSON.stringify({
    ok: true,
    mode: namedDatabase ? 'explicit-local-database' : 'isolated-temporary-local-sqlite',
    database,
    required_tables: requiredTables.length,
    remote: false,
  }, null, 2));
} finally {
  if (temporaryPersist) rmSync(temporaryPersist, { recursive: true, force: true });
}
