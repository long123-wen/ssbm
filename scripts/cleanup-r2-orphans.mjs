#!/usr/bin/env node
/**
 * R2 孤儿文件扫描与清理脚本
 *
 * 用法：
 *   node scripts/cleanup-r2-orphans.mjs                  # 默认 dry-run，仅打印
 *   node scripts/cleanup-r2-orphans.mjs --apply         # 真正删除
 *   node scripts/cleanup-r2-orphans.mjs --prefix=...     # 只扫指定前缀（默认 athlete-avatars/）
 *   node scripts/cleanup-r2-orphans.mjs --max-delete=200 # 限定最多删除 N 个（防误删）
 *
 * 判定逻辑（与生产环境删除逻辑一致）：
 *   1) 通过 Cloudflare HTTP API 列 R2 bucket 全部对象（按前缀）
 *   2) 通过 wrangler d1 execute 拉 athletes 表全部 avatar_url + id + club_id + competition_id
 *   3) 用 parseAthleteAvatarKey 把 D1 的 url 全部解析成 R2 key 集合 A
 *   4) 用 R2 list 的 key 集合减去 A，得到差集 = 孤儿
 *   5) dry-run 打印清单，--apply 时调 R2 delete API
 *
 * 鉴权：
 *   默认从 %USERPROFILE%/.wrangler/config/default.toml 读 oauth_token
 *   也可通过环境变量 CF_API_TOKEN 覆盖
 *
 * 配置来源：
 *   - 账户 ID: wrangler.toml 的 [[d1_databases]] 派生（同一个 account）
 *               也可显式 CF_ACCOUNT_ID 覆盖
 *   - D1 database name: wrangler.toml 中查找
 *   - R2 bucket name: wrangler.toml 中查找
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { build as esbuild } from 'esbuild';

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const prefix = `--${name}=`;
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : defaultValue;
};
const hasFlag = (name) => args.includes(`--${name}`);

const APPLY = hasFlag('apply');
const PREFIX = getArg('prefix', 'athlete-avatars/');
const MAX_DELETE = parseInt(getArg('max-delete', '999999'), 10);
const LIMIT_PER_PAGE = 1000;

// ---------- 读取 wrangler 配置 ----------
const WRANGLER_TOML_PATH = resolvePath(process.cwd(), 'wrangler.toml');
if (!existsSync(WRANGLER_TOML_PATH)) {
  console.error(`❌ wrangler.toml 不存在: ${WRANGLER_TOML_PATH}`);
  process.exit(2);
}
const wranglerToml = readFileSync(WRANGLER_TOML_PATH, 'utf-8');

// 简单 TOML 解析（项目 wrangler.toml 结构已知，足够）
const bucketMatch = wranglerToml.match(/\[\[r2_buckets\]\][\s\S]*?bucket_name\s*=\s*"([^"]+)"/);
const d1Match = wranglerToml.match(/\[\[d1_databases\]\][\s\S]*?database_name\s*=\s*"([^"]+)"/);
const R2_BUCKET = bucketMatch?.[1];
const D1_NAME = d1Match?.[1];
if (!R2_BUCKET) { console.error('❌ wrangler.toml 中未找到 r2_buckets.bucket_name'); process.exit(2); }
if (!D1_NAME) { console.error('❌ wrangler.toml 中未找到 d1_databases.database_name'); process.exit(2); }

// ---------- 鉴权 ----------
function loadOAuthToken() {
  if (process.env.CF_API_TOKEN) return process.env.CF_API_TOKEN;
  // Windows: %USERPROFILE%/.wrangler/config/default.toml
  const userProfile = process.env.USERPROFILE || process.env.HOME;
  const configPath = join(userProfile, '.wrangler', 'config', 'default.toml');
  if (!existsSync(configPath)) {
    throw new Error(`未找到 wrangler 配置文件: ${configPath}，请设置 CF_API_TOKEN 环境变量`);
  }
  const content = readFileSync(configPath, 'utf-8');
  const m = content.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('未在 wrangler config 中找到 oauth_token');
  const expMatch = content.match(/expiration_time\s*=\s*"([^"]+)"/);
  if (expMatch && new Date(expMatch[1]) < new Date()) {
    console.warn(`⚠️  OAuth token 已过期 (${expMatch[1]})，API 调用可能失败。请运行 \`wrangler login\` 续期。`);
  }
  return m[1];
}

const TOKEN = loadOAuthToken();

// ---------- Account ID（通过 API 自动发现第一个账户） ----------
async function fetchAccountId() {
  if (process.env.CF_ACCOUNT_ID) return process.env.CF_ACCOUNT_ID;
  const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  const data = await res.json();
  if (!data.success || !data.result?.[0]?.id) {
    throw new Error('无法获取 Cloudflare account ID：' + JSON.stringify(data.errors || data));
  }
  return data.result[0].id;
}

// ---------- 用 esbuild 抽出 parseAthleteAvatarKey ----------
async function loadParseHelper() {
  const tmpFile = join(tmpdir(), `.r2-parse-helper-${process.pid}.mjs`);
  await esbuild({
    entryPoints: ['functions/_shared/r2.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: tmpFile,
    logLevel: 'silent',
  });
  const mod = await import(`file://${tmpFile.replace(/\\/g, '/')}`);
  return { parseAthleteAvatarKey: mod.parseAthleteAvatarKey, tmpFile };
}

// ---------- 列 R2 全量对象 ----------
async function listAllR2Objects(accountId) {
  const all = [];
  let cursor = null;
  let page = 0;
  while (true) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${R2_BUCKET}/objects`);
    url.searchParams.set('per_page', String(LIMIT_PER_PAGE));
    if (PREFIX) url.searchParams.set('prefix', PREFIX);
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
    const data = await res.json();
    if (!data.success) {
      throw new Error('R2 list 失败：' + JSON.stringify(data.errors || data));
    }
    // result 直接是数组
    const batch = Array.isArray(data.result) ? data.result : (data.result?.objects || []);
    all.push(...batch);
    page++;
    const truncated = data.result_info?.truncated ?? data.truncated;
    const nextCursor = data.result_info?.cursor ?? data.cursor ?? null;
    if (page % 10 === 0) process.stderr.write(`  R2 已扫描 ${all.length} 个对象（第 ${page} 页）...\r`);
    if (!truncated || !nextCursor || batch.length === 0) break;
    cursor = nextCursor;
  }
  process.stderr.write('\n');
  return all;
}

// ---------- 通过 wrangler 拉 D1 数据 ----------
function d1Query(sql) {
  try {
    const isWin = process.platform === 'win32';
    // Windows + shell:true 时 cmd.exe 会再解析一次，需要把 SQL 包成双引号字符串并转义内部双引号
    const escapedSql = isWin ? `"${sql.replace(/"/g, '\\"')}"` : sql;
    const args = ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--json', '--command', escapedSql];
    const raw = execFileSync(
      'npx',
      args,
      { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin }
    );
    // wrangler 输出可能含 banner + JSON 数组，找最后一段以 [ 开头、] 结尾的 JSON
    const firstBracket = raw.indexOf('[');
    const lastBracket = raw.lastIndexOf(']');
    if (firstBracket < 0 || lastBracket < 0) {
      throw new Error('D1 输出未找到 JSON 数组：\n' + raw.slice(-500));
    }
    const json = raw.slice(firstBracket, lastBracket + 1);
    const arr = JSON.parse(json);
    if (!arr[0]?.success) throw new Error('D1 查询失败：' + JSON.stringify(arr[0]?.errors || arr));
    return arr[0].results || [];
  } catch (err) {
    throw new Error('D1 查询失败：' + (err.message || err) + '\nSQL: ' + sql);
  }
}

function fetchAllAthleteAvatarUrls() {
  // 分页拉，D1 单次结果集有限
  const PAGE = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const rows = d1Query(`SELECT id, club_id, competition_id, avatar_url FROM athletes WHERE avatar_url IS NOT NULL LIMIT ${PAGE} OFFSET ${offset}`);
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function fetchAllClubIds() {
  const rows = d1Query(`SELECT id FROM clubs`);
  return new Set(rows.map(r => r.id));
}

function fetchAllCompetitionIds() {
  const rows = d1Query(`SELECT id FROM competitions`);
  return new Set(rows.map(r => r.id));
}

// ---------- R2 delete ----------
async function deleteR2Object(accountId, key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${R2_BUCKET}/objects/${encodeURIComponent(key)}`;
  const res = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${TOKEN}` } });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`R2 delete 失败 key=${key} status=${res.status}: ${body.slice(0, 200)}`);
  }
}

// ---------- 主流程 ----------
async function main() {
  console.log('=== R2 孤儿文件扫描 ===\n');
  console.log(`模式: ${APPLY ? '🔴 APPLY（真删）' : '🟡 DRY-RUN（仅打印）'}`);
  console.log(`Bucket: ${R2_BUCKET}`);
  console.log(`Prefix: ${PREFIX || '(全部)'}`);
  console.log(`D1 Database: ${D1_NAME}`);
  console.log(`最大删除数: ${MAX_DELETE}`);
  console.log('');

  // 1) 拉 R2
  console.log('[1/4] 读取 R2 对象列表 ...');
  const accountId = await fetchAccountId();
  console.log(`  account: ${accountId}`);
  const r2Objects = await listAllR2Objects(accountId);
  console.log(`  R2 共 ${r2Objects.length} 个对象\n`);

  // 2) 拉 D1
  console.log('[2/4] 读取 D1 athletes.avatar_url ...');
  const athleteRows = fetchAllAthleteAvatarUrls();
  console.log(`  共 ${athleteRows.length} 个非空 avatar_url`);
  console.log('  读取 clubs / competitions ID 集合 ...');
  const clubIds = fetchAllClubIds();
  const competitionIds = fetchAllCompetitionIds();
  console.log(`  clubs: ${clubIds.size}, competitions: ${competitionIds.size}\n`);

  // 3) 加载解析器
  console.log('[3/4] 加载 parseAthleteAvatarKey ...');
  const { parseAthleteAvatarKey, tmpFile } = await loadParseHelper();
  console.log(`  ✓ 已加载 (helper: ${tmpFile})\n`);

  // 4) 计算孤儿
  console.log('[4/4] 计算孤儿集合 ...\n');

  // D1 侧：所有合法 R2 key（按 avatar_url 解析）
  const liveKeys = new Set();
  let unparseable = 0;
  for (const row of athleteRows) {
    const key = parseAthleteAvatarKey(row.avatar_url);
    if (key) liveKeys.add(key);
    else unparseable++;
  }

  // R2 侧：所有 key
  const r2Keys = r2Objects.map(o => o.key);
  const r2KeySet = new Set(r2Keys);

  // 孤儿 = R2 中存在但 D1 中没人引用的 key
  const orphans = r2Objects.filter(o => !liveKeys.has(o.key));

  // 顺便：孤儿里 uploadedBy 角色归属（可观察但不一定删）
  const orphanByActor = { club_missing: 0, athlete_missing: 0, valid_actor: 0, no_actor: 0 };
  // （这一项只是统计，不影响删除决策）

  // ---------- 汇总 ----------
  console.log('────────────── 汇总 ──────────────');
  console.log(`R2 总对象数:          ${r2Objects.length}`);
  console.log(`D1 非空 avatar_url:   ${athleteRows.length}`);
  console.log(`D1 解析为 R2 key:     ${liveKeys.size}`);
  console.log(`D1 无法解析（跳过）:  ${unparseable}（data: / Supabase 旧格式 / 第三方）`);
  console.log(`R2 中无 D1 引用（孤儿）: ${orphans.length}`);
  if (orphans.length > 0) {
    const totalSize = orphans.reduce((s, o) => s + (o.size || 0), 0);
    console.log(`孤儿总占用:           ${formatBytes(totalSize)}`);
  }
  console.log('──────────────────────────────────\n');

  if (orphans.length === 0) {
    console.log('🎉 无孤儿文件，R2 与 D1 完全一致。');
    return;
  }

  // 打印清单（最多 50 条预览）
  const preview = orphans.slice(0, 50);
  console.log(`孤儿文件清单（${preview.length}/${orphans.length} 预览）:`);
  for (const o of preview) {
    const age = o.last_modified ? ` (${o.last_modified.slice(0, 10)})` : '';
    console.log(`  • ${o.key}  ${formatBytes(o.size || 0)}${age}`);
  }
  if (orphans.length > 50) {
    console.log(`  ... 还有 ${orphans.length - 50} 个未显示\n`);
  } else {
    console.log('');
  }

  if (!APPLY) {
    console.log('🟡 DRY-RUN 模式，未删除任何文件。');
    console.log('   确认无误后执行: node scripts/cleanup-r2-orphans.mjs --apply');
    return;
  }

  // 真删
  const toDelete = orphans.slice(0, MAX_DELETE);
  console.log(`🔴 开始删除 ${toDelete.length} 个孤儿（上限 ${MAX_DELETE}）...\n`);
  let ok = 0, fail = 0;
  for (let i = 0; i < toDelete.length; i++) {
    try {
      await deleteR2Object(accountId, toDelete[i].key);
      ok++;
      if ((i + 1) % 20 === 0 || i === toDelete.length - 1) {
        process.stderr.write(`  已删 ${ok + fail}/${toDelete.length}（成功 ${ok} / 失败 ${fail}）\r`);
      }
    } catch (err) {
      fail++;
      console.error(`\n  ❌ ${toDelete[i].key}: ${err.message}`);
    }
  }
  process.stderr.write('\n');
  console.log(`\n✅ 完成：成功 ${ok}，失败 ${fail}`);
  if (fail > 0) console.log('   失败项可重跑本脚本（已删的会跳过，未删的会重试）');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

main().catch(err => {
  console.error('💥 脚本异常：', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
