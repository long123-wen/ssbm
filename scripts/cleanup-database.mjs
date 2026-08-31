/**
 *  数据库清理工具
 *  ==================
 *
 *  用法：
 *    node scripts/cleanup-database.mjs [选项]
 *
 *  选项：
 *    --all              清空全部数据（默认）
 *    --preserve-admin   保留管理员账号不清除
 *    --dry-run          仅模拟执行，输出将要删除的行数（不实际删除）
 *    --competition <id> 仅清除指定赛事及其关联数据
 *
 *  环境变量：
 *    VITE_SUPABASE_URL      Supabase 项目 URL
 *    VITE_SUPABASE_ANON_KEY Supabase Anon Key
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// 加载 .env
function loadEnv() {
  const envPaths = [
    resolve(projectRoot, '.env'),
    resolve(projectRoot, '.env.local'),
    resolve(projectRoot, '.env.production'),
  ];
  for (const p of envPaths) {
    try {
      const content = readFileSync(p, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
      break;
    } catch { /* 文件不存在 */ }
  }
}
loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 缺少 Supabase 配置，请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- 表定义：名称 → 删除顺序依赖关系 ----
const CLEANUP_TABLES = [
  { name: 'order_entries',  label: '秩序册',       deps: ['events', 'event_groups', 'competitions'] },
  { name: 'registrations', label: '报名记录',       deps: ['competitions', 'clubs', 'events', 'event_groups'] },
  { name: 'event_groups',  label: '分组',           deps: ['events'] },
  { name: 'events',        label: '赛程/项目',      deps: ['competitions'] },
  { name: 'athletes',      label: '运动员',         deps: ['clubs'] },
  { name: 'coaches',       label: '教练员',         deps: ['clubs'] },
  { name: 'team_leaders',  label: '领队',           deps: ['clubs'] },
  { name: 'clubs',         label: '俱乐部/学校',    deps: [] },
  { name: 'competitions',  label: '赛事',           deps: [] },
];

const PRESERVE_TABLES = ['admin_users']; // 默认保留

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { mode: 'all', preserveAdmin: true, dryRun: false, competitionId: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--all': opts.mode = 'all'; break;
      case '--preserve-admin': opts.preserveAdmin = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--competition':
        opts.mode = 'single';
        opts.competitionId = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`
数据库清理工具

用法:
  node scripts/cleanup-database.mjs [选项]

选项:
  --all                清空全部业务数据（默认）
  --competition <id>   只清除指定赛事 ID 的关联数据
  --preserve-admin     保留管理员账号（默认开启）
  --dry-run            模拟模式：仅显示将要删除的行数，不实际删除
  --help, -h           显示此帮助信息

示例:
  # 全量清理（保留管理员）
  node scripts/cleanup-database.mjs

  # 全量清理（含管理员重置）
  node scripts/cleanup-database.mjs --no-preserve-admin

  # 模拟运行看影响范围
  node scripts/cleanup-database.mjs --dry-run

  # 仅清除某个赛事
  node scripts/cleanup-database.mjs --competition <uuid>
`);
        process.exit(0);
      case '--no-preserve-admin': opts.preserveAdmin = false; break;
      default:
        if (args[i].startsWith('--')) {
          console.error(`⚠️ 未知参数: ${args[i]}，使用 --help 查看帮助`);
        }
    }
  }
  return opts;
}

// 统计某表行数
async function countRows(tableName) {
  const { count, error } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true });
  if (error) return -1; // 表不存在或无权限时返回 -1
  return count || 0;
}

// TRUNCATE 清空整表
async function truncateTable(tableName) {
  // Supabase JS 客户端不支持原生 TRUNCATE，用 RPC 调用 SQL
  const { error } = await supabase.rpc('exec_sql', {
    sql: `TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE`
  });
  if (error) {
    // fallback: 用 DELETE 逐条删除
    const { error: delErr } = await supabase.from(tableName).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    return delErr ? delErr : null;
  }
  return error;
}

// 按赛事 ID 删除（使用 DELETE WHERE）
async function deleteByCompetition(compId, tableName, column = 'competition_id') {
  const { count, error: countErr } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true })
    .eq(column, compId);
  if (countErr) return { deleted: -1, error: countErr };

  if ((count || 0) === 0) return { deleted: 0, error: null };

  const { error: delErr } = await supabase
    .from(tableName)
    .delete()
    .eq(column, compId);

  return { deleted: count || 0, error: delErr };
}

// 主流程
async function main() {
  const opts = parseArgs();
  const isDryRun = opts.dryRun;

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║      跳绳报名系统 — 数据库清理工具            ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  if (isDryRun) {
    console.log('🔍 【模拟模式】不会实际删除任何数据\n');
  }

  if (opts.mode === 'single' && opts.competitionId) {
    console.log(`📋 目标: 仅清除赛事 ${opts.competitionId} 的关联数据\n`);
  } else {
    console.log('📋 目标: 清空全部业务数据\n');
  }

  if (opts.preserveAdmin) {
    console.log(`🛡️  管理员账号: 保留 (admin_users)\n`);
  }

  console.log('─'.repeat(52));
  console.log(`{'表名'.padEnd(22)} {'说明'.padEnd(12)} {'删除行数'.padStart(10)}  状态`);
  console.log('─'.repeat(52));

  let totalDeleted = 0;
  let hasErrors = false;
  const stats = [];

  for (const table of CLEANUP_TABLES) {
    let result;

    if (opts.mode === 'single' && opts.competitionId) {
      // 单赛事模式：按 competition_id 过滤
      result = await deleteByCompetition(opts.competitionId, table.name);
    } else {
      // 全量模式
      const cnt = await countRows(table.name);
      if (cnt === -1) {
        stats.push({ table, deleted: '?', status: '⚠️ 表不存在/无权限', ok: false });
        continue;
      }
      if (cnt === 0) {
        stats.push({ table, deleted: 0, status: '— 已为空', ok: true });
        continue;
      }
      if (isDryRun) {
        result = { deleted: cnt, error: null };
      } else {
        const err = await truncateTable(table.name);
        result = { deleted: err ? -1 : cnt, error: err };
      }
    }

    const delCount = result.deleted;
    const status = result.error
      ? `❌ ${result.error.message}`
      : (delCount > 0 ? `✅ 已删除` : '— 已为空');

    const ok = !result.error && delCount !== -1;
    stats.push({ table, deleted: delCount, status, ok });
    if (!ok) hasErrors = true;
    if (typeof delCount === 'number' && delCount > 0) totalDeleted += delCount;

    const delStr = String(delCount === -1 ? '?' : delCount).padStart(10);
    console.log(`${table.name.padEnd(22)} ${table.label.padEnd(12)} ${delStr}  ${status}`);
  }

  // 处理 admin_users
  if (!opts.preserveAdmin) {
    const cnt = await countRows('admin_users');
    if (isDryRun) {
      console.log(`${'admin_users'.padEnd(22)} ${'管理员账号'.padEnd(12)} ${String(cnt).padStart(10)}  ✅ 将删除`);
      totalDeleted += cnt;
    } else {
      const err = await truncateTable('admin_users');
      console.log(`${'admin_users'.padEnd(22)} ${'管理员账号'.padEnd(12)} ${String(cnt || 0).padStart(10)}  ${err ? '❌ ' + err.message : '✅ 已删除'}`);
    }
  } else {
    console.log(`${'admin_users'.padEnd(22)} ${'管理员账号'.padEnd(12)} ${''.padStart(10)}  🛡️  已跳过（保留）`);
  }

  console.log('─'.repeat(52));
  console.log(`总计删除: ${totalDeleted} 行`);

  if (isDryRun) {
    console.log('\n✨ 以上为模拟结果。如需实际执行，去掉 --dry-run 参数重新运行。\n');
  } else if (hasErrors) {
    console.log('\n⚠️  部分表清理失败，请检查上方错误信息。\n');
    process.exit(1);
  } else {
    console.log('\n✅ 数据库清理完成！所有业务数据已成功清除。\n');
  }
}

main().catch(err => {
  console.error('❌ 执行出错:', err.message);
  process.exit(1);
});
