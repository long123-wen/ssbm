// 清空所有测试数据，保留比赛项目和分组
// 用法: node scripts/clear-test-data.mjs

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

async function clearTable(tableName) {
  const { count, error } = await supabase
    .from(tableName)
    .delete({ count: 'exact' })
    .neq('id', '00000000-0000-0000-0000-000000000000'); // 删除所有行
  if (error) {
    console.log(`  ❌ ${tableName}: ${error.message}`);
    return 0;
  }
  console.log(`  ✅ ${tableName}: 已删除 ${count} 条`);
  return count || 0;
}

async function main() {
  console.log('=== 清空测试数据（保留比赛结构）===\n');

  // 1. 先查当前数据概况
  console.log('[0] 当前数据概况:');
  const tables = ['competitions', 'events', 'event_groups', 'clubs', 'athletes', 'registrations', 'team_leaders', 'coaches', 'order_entries'];
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`  ${t}: 查询失败 (${error.message})`);
    } else {
      console.log(`  ${t}: ${count} 条`);
    }
  }

  // 2. 确认
  console.log('\n⚠️  将删除以下表中的所有数据:');
  console.log('   clubs, athletes, registrations, team_leaders, coaches, order_entries');
  console.log('   保留: competitions, events, event_groups, admin_users\n');

  // 3. 按外键依赖顺序删除（先删子表，再删父表）
  console.log('[1/6] 清空 order_entries...');
  await clearTable('order_entries');

  console.log('[2/6] 清空 registrations...');
  await clearTable('registrations');

  console.log('[3/6] 清空 athletes...');
  await clearTable('athletes');

  console.log('[4/6] 清空 coaches...');
  await clearTable('coaches');

  console.log('[5/6] 清空 team_leaders...');
  await clearTable('team_leaders');

  console.log('[6/6] 清空 clubs...');
  await clearTable('clubs');

  // 4. 重置 event_groups 的 current_count
  console.log('\n[7] 重置分组人数计数...');
  const { error: updateErr } = await supabase
    .from('event_groups')
    .update({ current_count: 0 })
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (updateErr) {
    console.log(`  ❌ 重置 current_count 失败: ${updateErr.message}`);
  } else {
    console.log('  ✅ 所有分组 current_count 已归零');
  }

  // 5. 最终验证
  console.log('\n[8] 清理后数据概况:');
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`  ${t}: 查询失败`);
    } else {
      console.log(`  ${t}: ${count} 条`);
    }
  }

  console.log('\n🎉 测试数据已全部清空，比赛结构完好！');
}

main().catch(err => {
  console.error('脚本出错:', err.message);
  process.exit(1);
});
