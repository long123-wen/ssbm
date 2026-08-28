// 清除所有俱乐部、运动员、教练员、领队、报名记录数据
// 保留赛事(competitions)和项目(events/event_groups)结构
// 用法: node scripts/clear-all-data.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const envPath = new URL('../.env', import.meta.url);
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^VITE_SUPABASE_(URL|ANON_KEY)\s*=\s*(.+)/);
  if (match) env[match[1]] = match[2].trim();
});

const supabase = createClient(env.URL, env.ANON_KEY, {
  auth: { persistSession: false },
  db: { schema: 'public' },
});

const TABLES_TO_CLEAR = [
  'registrations',
  'order_entries',
  'athletes',
  'coaches',
  'team_leaders',
  'clubs',
];

async function clearTable(table) {
  console.log(`  正在清空 ${table}...`);

  // 先查询所有 id，然后批量删除
  const { data: rows, error: fetchErr } = await supabase.from(table).select('id');
  if (fetchErr) {
    console.error(`    ❌ ${table} 查询失败: ${fetchErr.message}`);
    return false;
  }

  if (!rows || rows.length === 0) {
    console.log(`    ✅ ${table} 已经是空的`);
    return true;
  }

  const ids = rows.map(r => r.id);
  const { error } = await supabase.from(table).delete().in('id', ids);
  if (error) {
    console.error(`    ❌ ${table} 删除失败: ${error.message}`);
    return false;
  }

  // 验证
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (count === 0) {
    console.log(`    ✅ ${table} 已清空 (${ids.length} 条)`);
    return true;
  } else {
    console.warn(`    ⚠️ ${table} 仍有 ${count} 条数据`);
    return false;
  }
}

async function main() {
  console.log('=== 清除所有注册数据 ===');
  console.log('保留: competitions, events, event_groups, admin_users');
  console.log('清除: clubs, athletes, coaches, team_leaders, registrations, order_entries\n');

  let allSuccess = true;
  for (const table of TABLES_TO_CLEAR) {
    const ok = await clearTable(table);
    if (!ok) allSuccess = false;
  }

  console.log('\n' + '='.repeat(40));
  if (allSuccess) {
    console.log('✅ 所有数据已清除完毕！');
  } else {
    console.log('⚠️ 部分表清除失败，请检查。');
  }
  console.log('='.repeat(40));
}

main().catch(err => {
  console.error('脚本出错:', err.message);
  process.exit(1);
});
