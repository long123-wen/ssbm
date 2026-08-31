// 压力测试：批量插入报名数据到 Supabase
// 用法: TOTAL=3000 node scripts/stress-test-registrations.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const TOTAL = parseInt(process.env.TOTAL || '3000', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);

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

async function main() {
  console.log(`=== 跳绳报名系统 - ${TOTAL}条压力测试 ===\n`);

  // 1. 获取现有数据
  console.log('[1/4] 获取现有数据...');
  const { data: comps } = await supabase.from('competitions').select('*').limit(1);
  if (!comps || comps.length === 0) {
    console.error('❌ 没有赛事数据，请先创建赛事');
    process.exit(1);
  }
  const comp = comps[0];
  console.log(`  赛事: ${comp.name} (${comp.id})`);

  const { data: events } = await supabase.from('events').select('*').eq('competition_id', comp.id);
  if (!events || events.length === 0) {
    console.error('❌ 该赛事没有项目数据');
    process.exit(1);
  }
  console.log(`  项目数: ${events.length}`);

  const { data: groups } = await supabase.from('event_groups').select('*').in('event_id', events.map(e => e.id));
  const groupsByEvent = {};
  (groups || []).forEach(g => {
    if (!groupsByEvent[g.event_id]) groupsByEvent[g.event_id] = [];
    groupsByEvent[g.event_id].push(g);
  });
  console.log(`  分组数: ${(groups || []).length}`);

  const { data: clubs } = await supabase.from('clubs').select('*');
  if (!clubs || clubs.length === 0) {
    console.error('❌ 没有俱乐部数据，请先注册俱乐部');
    process.exit(1);
  }
  console.log(`  俱乐部数: ${clubs.length}`);

  const { data: athletes } = await supabase.from('athletes').select('*');
  if (!athletes || athletes.length === 0) {
    console.error('❌ 没有运动员数据');
    process.exit(1);
  }
  console.log(`  运动员数: ${athletes.length}`);

  // 过滤出有分组的项目
  const validEvents = events.filter(e => groupsByEvent[e.id] && groupsByEvent[e.id].length > 0);
  if (validEvents.length === 0) {
    console.error('❌ 没有配置分组的项目');
    process.exit(1);
  }
  console.log(`  有效项目数（有分组）: ${validEvents.length}`);

  // 2. 生成测试数据
  console.log(`\n[2/4] 生成 ${TOTAL} 条测试报名数据...`);
  const batchSize = BATCH_SIZE;
  const total = TOTAL;
  const registrations = [];
  const statuses = ['pending', 'confirmed', 'rejected'];

  for (let i = 0; i < total; i++) {
    const ev = validEvents[i % validEvents.length];
    const eventGroups = groupsByEvent[ev.id];
    const grp = eventGroups[i % eventGroups.length];
    const club = clubs[i % clubs.length];
    const athlete = athletes[i % athletes.length];
    const status = statuses[i % 3]; // 均匀分布三种状态

    registrations.push({
      competition_id: comp.id,
      club_id: club.id,
      club_name: club.club_name,
      event_id: ev.id,
      event_name: ev.name,
      group_id: grp.id,
      group_name: grp.name,
      athletes: [{ athleteId: athlete.id, name: athlete.name }],
      status,
      created_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const statusCounts = { pending: 0, confirmed: 0, rejected: 0 };
  registrations.forEach(r => statusCounts[r.status]++);
  console.log(`  待审核: ${statusCounts.pending} | 已确认: ${statusCounts.confirmed} | 已拒绝: ${statusCounts.rejected}`);

  // 3. 批量插入
  console.log('\n[3/4] 批量插入（每批 50 条）...');
  const startTime = Date.now();
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < registrations.length; i += batchSize) {
    const batch = registrations.slice(i, i + batchSize);
    try {
      const { error } = await supabase.from('registrations').insert(batch);
      if (error) {
        failed += batch.length;
        console.error(`  批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(registrations.length / batchSize)} 失败: ${error.message}`);
      } else {
        inserted += batch.length;
      }
    } catch (err) {
      failed += batch.length;
      console.error(`  批次 ${Math.floor(i / batchSize) + 1} 异常: ${err.message}`);
    }
    process.stdout.write(`\r  进度: ${inserted + failed}/${total} (成功 ${inserted}, 失败 ${failed})`);
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // 4. 验证
  console.log('\n\n[4/4] 验证数据...');
  const { count: totalCount } = await supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('competition_id', comp.id);
  const { count: pendingNum } = await supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('competition_id', comp.id).eq('status', 'pending');
  const { count: confirmedNum } = await supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('competition_id', comp.id).eq('status', 'confirmed');
  const { count: rejectedNum } = await supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('competition_id', comp.id).eq('status', 'rejected');

  // 5. 查询性能测试
  console.log('\n[5/5] 查询性能测试...');
  
  const q1Start = Date.now();
  await supabase.from('registrations').select('*').eq('competition_id', comp.id);
  const q1Time = Date.now() - q1Start;
  console.log(`  全量查询 ${totalCount} 条: ${q1Time}ms`);

  const q2Start = Date.now();
  await supabase.from('registrations').select('*').eq('competition_id', comp.id).eq('status', 'pending');
  const q2Time = Date.now() - q2Start;
  console.log(`  按状态筛选 pending: ${q2Time}ms`);

  const q3Start = Date.now();
  await supabase.from('registrations').select('*').eq('competition_id', comp.id).ilike('club_name', '%测试%');
  const q3Time = Date.now() - q3Start;
  console.log(`  模糊搜索俱乐部: ${q3Time}ms`);

  const q4Start = Date.now();
  await supabase.from('registrations').select('id,club_name,status').eq('competition_id', comp.id).limit(20);
  const q4Time = Date.now() - q4Start;
  console.log(`  分页查询 20 条: ${q4Time}ms`);

  // 结果报告
  console.log('\n' + '='.repeat(50));
  console.log('           📊 压力测试报告');
  console.log('='.repeat(50));
  console.log(`  赛事:         ${comp.name}`);
  console.log(`  项目数:       ${validEvents.length}`);
  console.log(`  俱乐部数:     ${clubs.length}`);
  console.log(`  运动员数:     ${athletes.length}`);
  console.log(`  ──────────────────────────`);
  console.log(`  目标插入数:   ${total}`);
  console.log(`  成功插入:     ${inserted}`);
  console.log(`  失败:         ${failed}`);
  console.log(`  耗时:         ${duration} 秒`);
  console.log(`  吞吐量:       ${(inserted / parseFloat(duration)).toFixed(1)} 条/秒`);
  console.log(`  ──────────────────────────`);
  console.log(`  该赛事总报名: ${totalCount}`);
  console.log(`  待审核:       ${pendingNum || 'N/A'}`);
  console.log(`  已确认:       ${confirmedNum || 'N/A'}`);
  console.log(`  ──────────────────────────`);
  console.log(`  查询测试（${totalCount} 条数据）:`);
  console.log(`  全量查询:     ${q1Time}ms`);
  console.log(`  状态筛选:     ${q2Time}ms`);
  console.log(`  模糊搜索:     ${q3Time}ms`);
  console.log(`  分页查询:     ${q4Time}ms`);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\n⚠️  有部分数据插入失败，可能是 RLS 策略或网络问题。');
  } else {
    console.log(`\n✅ ${TOTAL} 条数据全部插入成功！系统可以承受该量级压力。`);
  }
}

main().catch(err => {
  console.error('脚本执行出错:', err.message);
  process.exit(1);
});
