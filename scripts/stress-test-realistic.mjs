// 真实场景压力测试
// 2个赛事，16个项目，60个俱乐部，700名运动员，每人报7个项目 = 4900条报名
// 用法: node scripts/stress-test-realistic.mjs

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

const BATCH_SIZE = 100;
const ATHLETES_PER_EVENT = 7; // 每个运动员报名项目数
const TARGET_CLUBS = 100;
const TARGET_ATHLETES = 1000;
const TARGET_EVENTS_PER_COMP = 8; // 每个赛事目标项目数

function randomName() {
  const surnames = ['张','李','王','赵','刘','陈','杨','黄','周','吴','郑','孙','马','朱','胡','林','何','高','梁','郭','罗','宋','谢','韩','唐','冯','董','程','曹','袁','邓','许','傅','沈','曾','彭','吕','苏','卢','蒋','蔡','贾','丁','魏','薛','叶','阎','余','潘','戴','夏','钟','汪','田','任','姜','范','方','石','姚','谭','廖','邹','熊','金','陆','郝','孔','白','崔','康','毛','邱','秦','江','史','顾','侯','邵','孟','龙','万','段','雷','钱','汤','尹','黎','易','常','武','乔','贺','赖','龚'];
  const givenNames = ['伟','强','磊','洋','涛','军','杰','浩','明','宇','文','华','建','国','平','刚','斌','辉','峰','宁','鹏','超','波','林','鑫','阳','俊','帅','睿','晨','轩','涵','博','铭','凯','哲','志','勇','龙','飞','翔','安','东','辰','瑞','泽','皓','昊','然'];
  const s = surnames[Math.floor(Math.random() * surnames.length)];
  const g1 = givenNames[Math.floor(Math.random() * givenNames.length)];
  const g2 = Math.random() > 0.3 ? givenNames[Math.floor(Math.random() * givenNames.length)] : '';
  return s + g1 + g2;
}

function randomClubName() {
  const prefixes = ['德州市','济南市','青岛市','临沂市','烟台市','潍坊市','济宁市','淄博市','泰安市','日照市','滨州市','聊城市','菏泽市','枣庄市','东营市','威海市'];
  const mids = ['第一','第二','第三','实验','育才','英才','朝阳','光明','新华','东方','振华','育英','文苑','博雅','致远','明德'];
  const suffixes = ['小学','中学','实验学校','中心学校','一中','二中','外国语学校','体育运动学校'];
  return prefixes[Math.floor(Math.random() * prefixes.length)]
    + mids[Math.floor(Math.random() * mids.length)]
    + suffixes[Math.floor(Math.random() * suffixes.length)];
}

function randomPhone() {
  return '1' + String(3 + Math.floor(Math.random() * 7)) + Array.from({length: 9}, () => Math.floor(Math.random() * 10)).join('');
}

function randomIdCard() {
  const area = ['371402','371422','371423','371424','371425','371426','371427','371428','371481','371482','371502','371522','371523','371524'];
  const a = area[Math.floor(Math.random() * area.length)];
  const y = 2000 + Math.floor(Math.random() * 15);
  const m = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const d = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  const tail = Array.from({length: 4}, () => Math.floor(Math.random() * 10)).join('');
  return `${a}${y}${m}${d}${tail}`;
}

function randomBirthDate() {
  const y = 2000 + Math.floor(Math.random() * 15);
  const m = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const d = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function main() {
  console.log('=== 跳绳报名系统 - 真实场景压力测试 ===');
  console.log('  目标: 2个赛事, 16个项目, 100个俱乐部, 1000名运动员, 每人7项 = 7000条报名\n');

  // ===================== 1. 准备赛事和项目 =====================
  console.log('[1/6] 准备赛事和项目...');

  let { data: comps } = await supabase.from('competitions').select('*');
  if (!comps || comps.length < 2) {
    console.log('  创建第2个赛事...');
    const { data: comp1 } = await supabase.from('competitions').select('*').limit(1).single();
    await supabase.from('competitions').insert({
      name: '第二届德州市中小学生跳绳比赛',
      subtitle: '德州市教育局 德州市体育局',
      venue: '德州市体育中心综合馆',
      start_date: '2026-11-15',
      end_date: '2026-11-17',
      registration_deadline: '2026-10-31',
      status: 'open',
      description: '面向全市中小学生的跳绳专项比赛',
    });
    comps = (await supabase.from('competitions').select('*')).data || [];
  }
  console.log(`  赛事数: ${comps.length}`);

  // 为每个赛事复制项目（第2个赛事没有项目的话）
  const allEventsByComp = {};
  for (const comp of comps) {
    let { data: events } = await supabase.from('events').select('*').eq('competition_id', comp.id);
    if (!events || events.length === 0) {
      console.log(`  为「${comp.name}」复制项目...`);
      const { data: srcEvents } = await supabase.from('events').select('*').eq('competition_id', comps[0].id);
      const { data: srcGroups } = await supabase.from('event_groups').select('*').in('event_id', (srcEvents || []).map(e => e.id));

      for (const ev of (srcEvents || [])) {
        const { data: newEv } = await supabase.from('events').insert({
          competition_id: comp.id,
          name: ev.name, code: ev.code, category: ev.category,
          description: ev.description, max_athletes: ev.max_athletes,
          is_individual: ev.is_individual, order_index: ev.order_index,
        }).select().single();
        if (newEv) {
          const relatedGroups = (srcGroups || []).filter(g => g.event_id === ev.id);
          for (const grp of relatedGroups) {
            await supabase.from('event_groups').insert({
              event_id: newEv.id,
              name: grp.name, type: grp.type, gender: grp.gender,
              age_min: grp.age_min, age_max: grp.age_max,
              max_registrations: grp.max_registrations, current_count: 0,
              order_index: grp.order_index,
            });
          }
        }
      }
      events = (await supabase.from('events').select('*').eq('competition_id', comp.id)).data || [];
    }

    const { data: groups } = await supabase.from('event_groups').select('*').in('event_id', events.map(e => e.id));
    const groupsByEvent = {};
    (groups || []).forEach(g => {
      if (!groupsByEvent[g.event_id]) groupsByEvent[g.event_id] = [];
      groupsByEvent[g.event_id].push(g);
    });
    // 为没有分组的项目创建测试分组
    const noGroupEvents = events.filter(e => !groupsByEvent[e.id] || groupsByEvent[e.id].length === 0);
    if (noGroupEvents.length > 0) {
      console.log(`  为 ${noGroupEvents.length} 个项目创建测试分组...`);
      for (const ev of noGroupEvents) {
        const genders = ev.is_individual ? ['male', 'female'] : ['male', 'female', 'mixed'];
        for (const gender of genders) {
          const ages = ev.is_individual
            ? [{ min: 7, max: 8, label: '小学乙组' }, { min: 9, max: 10, label: '小学甲组' }, { min: 11, max: 12, label: '初中组' }]
            : [{ min: 7, max: 12, label: '小学组' }, { min: 13, max: 15, label: '初中组' }];
          for (const age of ages) {
            const gname = `${gender === 'male' ? '男子' : gender === 'female' ? '女子' : '混合'}${age.label}`;
            await supabase.from('event_groups').insert({
              event_id: ev.id,
              name: gname,
              type: 'age',
              gender,
              age_min: age.min,
              age_max: age.max,
              max_registrations: 200,
              current_count: 0,
              order_index: 0,
            });
          }
        }
      }
      // 重新加载分组
      const { data: newGroups } = await supabase.from('event_groups').select('*').in('event_id', events.map(e => e.id));
      (newGroups || []).forEach(g => {
        if (!groupsByEvent[g.event_id]) groupsByEvent[g.event_id] = [];
        groupsByEvent[g.event_id].push(g);
      });
    }
    const validEvents = events.filter(e => groupsByEvent[e.id]?.length > 0);
    // 生成报名数据前确保每个赛事都有有效项目
    if (validEvents.length === 0) {
      console.error(`  ❌ ${comp.name} 没有有效项目，跳过`);
      continue;
    }
    allEventsByComp[comp.id] = { events: validEvents, groupsByEvent };
    console.log(`  ${comp.name}: ${events.length} 项目, ${(Object.values(groupsByEvent).flat().length)} 分组, ${validEvents.length} 有效`);
  }

  // 确保每个赛事都有有效项目
  const compIds = comps.map(c => c.id).filter(id => allEventsByComp[id]?.events?.length > 0);
  if (compIds.length === 0) {
    console.error('❌ 没有有效赛事（所有赛事均无带分组的项目）');
    process.exit(1);
  }

  // ===================== 2. 创建 100 个俱乐部 =====================
  console.log('\n[2/6] 创建俱乐部（目标 100 个）...');
  let { data: clubs } = await supabase.from('clubs').select('*');
  const needClubs = Math.max(0, TARGET_CLUBS - (clubs || []).length);
  if (needClubs > 0) {
    console.log(`  需要创建 ${needClubs} 个俱乐部...`);
    const newClubs = [];
    const usedNames = new Set((clubs || []).map(c => c.club_name));
    for (let i = 0; i < needClubs; i++) {
      let name;
      do { name = randomClubName(); } while (usedNames.has(name));
      usedNames.add(name);
      newClubs.push({
        username: `testclub_${Date.now()}_${i}`,
        club_name: name,
        contact_name: randomName(),
        phone: randomPhone(),
        password_hash: '0000000000000000', // placeholder
        is_approved: true,
      });
    }
    // 批量插入俱乐部
    const clubBatchSize = 20;
    let clubInserted = 0;
    for (let i = 0; i < newClubs.length; i += clubBatchSize) {
      const batch = newClubs.slice(i, i + clubBatchSize);
      const { data: created, error } = await supabase.from('clubs').insert(batch).select();
      if (error) {
        console.error(`\n  俱乐部批次失败: ${error.message}`);
      } else if (created) {
        clubInserted += created.length;
      }
      process.stdout.write(`\r  俱乐部进度: ${clubInserted}/${needClubs}`);
    }
    clubs = (await supabase.from('clubs').select('*')).data || [];
  }
  clubs = clubs.slice(0, TARGET_CLUBS);
  console.log(`  俱乐部数: ${clubs.length}`);

  // ===================== 3. 创建 1000 名运动员 =====================
  console.log('\n[3/6] 创建运动员（目标 1000 名）...');
  let { data: athletes } = await supabase.from('athletes').select('*');
  const needAthletes = Math.max(0, TARGET_ATHLETES - (athletes || []).length);
  if (needAthletes > 0) {
    const newAthletes = [];
    for (let i = 0; i < needAthletes; i++) {
      const club = clubs[i % clubs.length];
      const gender = Math.random() > 0.5 ? 'male' : 'female';
      newAthletes.push({
        club_id: club.id,
        name: randomName(),
        gender,
        birth_date: randomBirthDate(),
        id_card: randomIdCard(),
      });
    }
    const batchSize = 50;
    let insertedA = 0;
    for (let i = 0; i < newAthletes.length; i += batchSize) {
      const batch = newAthletes.slice(i, i + batchSize);
      const { error } = await supabase.from('athletes').insert(batch);
      if (!error) insertedA += batch.length;
      else console.error(`  批次失败: ${error.message}`);
      process.stdout.write(`\r  运动员进度: ${insertedA}/${needAthletes}`);
    }
    athletes = (await supabase.from('athletes').select('*')).data || [];
  }
  athletes = athletes.slice(0, TARGET_ATHLETES);
  console.log(`\n  运动员数: ${athletes.length}`);

  // ===================== 4. 生成报名数据 =====================
  console.log('\n[4/6] 生成报名数据...');
  const allRegistrations = [];
  const compIdsAll = comps.map(c => c.id);
  const totalEvents = Object.values(allEventsByComp).reduce((s, v) => s + v.events.length, 0);
  console.log(`  总有效项目数: ${totalEvents}, 每名运动员 ${ATHLETES_PER_EVENT} 项`);

  for (let ai = 0; ai < athletes.length; ai++) {
    const athlete = athletes[ai];
    const compId = compIds[ai % compIds.length];
    const compData = allEventsByComp[compId];
    if (!compData || !compData.events || compData.events.length === 0) continue;
    const { events: compEvents, groupsByEvent } = compData;

    // 为每个运动员随机选 7 个不重复的项目
    const shuffled = [...compEvents].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(ATHLETES_PER_EVENT, shuffled.length));

    const club = clubs[ai % clubs.length];
    const statuses = ['pending', 'confirmed', 'rejected'];
    const status = statuses[ai % 3];

    for (const ev of selected) {
      const eventGroups = groupsByEvent[ev.id];
      const grp = eventGroups[Math.floor(Math.random() * eventGroups.length)];
      allRegistrations.push({
        competition_id: compId,
        club_id: club.id,
        club_name: club.club_name,
        event_id: ev.id,
        event_name: ev.name,
        group_id: grp.id,
        group_name: grp.name,
        athletes: [{ athleteId: athlete.id, name: athlete.name }],
        status,
        created_at: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  const total = allRegistrations.length;
  const statusCounts = { pending: 0, confirmed: 0, rejected: 0 };
  allRegistrations.forEach(r => statusCounts[r.status]++);
  console.log(`  生成 ${total} 条报名`);
  console.log(`  待审核: ${statusCounts.pending} | 已确认: ${statusCounts.confirmed} | 已拒绝: ${statusCounts.rejected}`);

  // ===================== 5. 批量插入 =====================
  console.log('\n[5/6] 批量插入...');
  const startTime = Date.now();
  let inserted = 0;
  let failed = 0;

  // 分批，每批 BATCH_SIZE 条
  for (let i = 0; i < allRegistrations.length; i += BATCH_SIZE) {
    const batch = allRegistrations.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await supabase.from('registrations').insert(batch);
      if (error) {
        failed += batch.length;
        console.error(`\n  批次 ${Math.floor(i / BATCH_SIZE) + 1} 失败: ${error.message}`);
      } else {
        inserted += batch.length;
      }
    } catch (err) {
      failed += batch.length;
      console.error(`\n  批次 ${Math.floor(i / BATCH_SIZE) + 1} 异常: ${err.message}`);
    }
    process.stdout.write(`\r  进度: ${inserted + failed}/${total} (成功 ${inserted}, 失败 ${failed})`);
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // ===================== 6. 查询性能验证 =====================
  console.log('\n\n[6/6] 查询性能验证...');

  const { count: grandTotal } = await supabase.from('registrations').select('*', { count: 'exact', head: true });
  const qPerComp = [];
  for (const comp of comps) {
    const start = Date.now();
    const { data: compRegs } = await supabase.from('registrations').select('*').eq('competition_id', comp.id);
    const time = Date.now() - start;
    qPerComp.push({ name: comp.name, count: (compRegs || []).length, time });
    console.log(`  ${comp.name}: ${(compRegs || []).length} 条, 查询耗时 ${time}ms`);
  }

  const qStatusStart = Date.now();
  await supabase.from('registrations').select('*').eq('status', 'pending');
  const qStatusTime = Date.now() - qStatusStart;

  const qClubStart = Date.now();
  await supabase.from('registrations').select('id,club_name,status').limit(50);
  const qClubTime = Date.now() - qClubStart;

  // 报告
  console.log('\n' + '='.repeat(55));
  console.log('           📊 真实场景压力测试报告');
  console.log('='.repeat(55));
  console.log(`  赛事数:       ${comps.length}`);
  console.log(`  项目数:       ${totalEvents}`);
  console.log(`  俱乐部数:     ${clubs.length}`);
  console.log(`  运动员数:     ${athletes.length}`);
  console.log(`  人/项目:      ${ATHLETES_PER_EVENT}`);
  console.log(`  ──────────────────────────`);
  console.log(`  生成报名数:   ${total}`);
  console.log(`  成功插入:     ${inserted}`);
  console.log(`  失败:         ${failed}`);
  console.log(`  耗时:         ${duration} 秒`);
  console.log(`  吞吐量:       ${(inserted / parseFloat(duration)).toFixed(1)} 条/秒`);
  console.log(`  ──────────────────────────`);
  console.log(`  数据库总报名: ${grandTotal}`);
  for (const q of qPerComp) {
    console.log(`  ${q.name}: ${q.count} 条 (查询 ${q.time}ms)`);
  }
  console.log(`  ──────────────────────────`);
  console.log(`  全状态筛选:   ${qStatusTime}ms`);
  console.log(`  分页 50 条:   ${qClubTime}ms`);
  console.log('='.repeat(55));

  if (failed > 0) {
    console.log('\n⚠️  有部分数据插入失败。');
  } else {
    console.log(`\n✅ ${total} 条报名全部插入成功！真实场景下系统表现优秀。`);
  }
}

main().catch(err => {
  console.error('脚本出错:', err.message);
  process.exit(1);
});
