// 为"好运山东"德州市2026年第一届中小学跳绳比赛生成幼儿组报名数据
// 5支队伍，30秒单摇跳 + 30秒双摇跳，幼儿男子组/女子组
// 用法: node scripts/seed-preschool-data.mjs

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

// ==================== 固定 ID ====================
const COMP_ID = 'ba68565c-9112-4a63-ab3b-b59379761fc5';
const EVENT_SINGLE_ROPE = '2e64b9e8-ab12-42a8-bb6a-00510a856c5d'; // 30秒单摇跳
const EVENT_DOUBLE_ROPE = '3b92aace-23f6-41cd-8c7a-6ef5461220f3'; // 30秒双摇跳
const GROUP_SR_MALE   = 'f9cbf52e-c789-43f0-a428-ef0fdb7b6b8c'; // 单摇-幼儿组男子组
const GROUP_SR_FEMALE = '281d3731-da27-4c6d-8036-cb6a417a6200'; // 单摇-幼儿组女子组
const GROUP_DR_MALE   = '271b3c1a-bd12-4c79-962d-4b5b6b41c7a6'; // 双摇-幼儿组男子组
const GROUP_DR_FEMALE = '5ca6c003-4bc0-4172-8235-38150cf864a4'; // 双摇-幼儿组女子组

// ==================== 队伍数据 ====================
const teams = [
  {
    username: 'dzsyey01',
    clubName: '德州市实验幼儿园',
    contactName: '张秀兰',
    phone: '13853401234',
  },
  {
    username: 'dzdcyey01',
    clubName: '德州市德城区第一幼儿园',
    contactName: '李美华',
    phone: '13953425678',
  },
  {
    username: 'dzxcyey01',
    clubName: '德州市新湖幼儿园',
    contactName: '王春芳',
    phone: '13753438901',
  },
  {
    username: 'dzqsyey01',
    clubName: '齐河县启蒙幼儿园',
    contactName: '赵瑞英',
    phone: '13653442345',
  },
  {
    username: 'dzlsyey01',
    clubName: '临邑县陵城幼儿园',
    contactName: '陈晓萍',
    phone: '13553455678',
  },
];

// 德州市身份证前6位
const AREA_CODES = ['371402','371422','371423','371424','371425','371426','371427','371428','371481','371482'];

// 幼儿名字（4-6岁，2020-2022年出生）
const MALE_NAMES = [
  '张一诺','李宇轩','王子睿','赵晨阳','刘浩然',
  '陈子涵','杨宇航','黄思远','周俊熙','吴梓豪',
  '郑博文','孙嘉乐','马天佑','朱瑞霖','胡明轩',
  '高子墨','梁雨泽','郭一帆','罗梓轩','宋宇航',
  '谢子恒','韩博远','唐锦程','冯子昂','董一鸣',
  '程天宇','曹子豪','袁一帆','邓思睿','许子扬',
];
const FEMALE_NAMES = [
  '张若曦','李欣怡','王子涵','赵语桐','刘思彤',
  '陈雨萱','杨梓涵','黄语嫣','周可欣','吴雨桐',
  '郑依诺','孙梦瑶','马诗涵','朱雨薇','胡可馨',
  '高紫萱','梁语汐','郭欣妍','罗思颖','宋若兮',
  '谢雨桐','韩梓萱','唐梦琪','冯语嫣','董一诺',
  '程欣悦','曹若溪','袁紫涵','邓思琪','许语涵',
];

function randomIdCard(gender, birthYear) {
  const area = AREA_CODES[Math.floor(Math.random() * AREA_CODES.length)];
  const m = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const d = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  const genderDigit = gender === 'male' ? (Math.floor(Math.random() * 5) * 2 + 1) : (Math.floor(Math.random() * 5) * 2);
  const body = `${area}${birthYear}${m}${d}${seq}${genderDigit}`;
  // 计算校验码
  const weights = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
  const checks = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += parseInt(body[i]) * weights[i];
  return body + checks[sum % 11];
}

function randomBirthDate(year) {
  const m = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const d = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

// 密码哈希占位
const DUMMY_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

async function main() {
  console.log('=== 生成幼儿组报名数据 ===\n');

  // ===================== 1. 创建俱乐部 =====================
  console.log('[1/4] 创建俱乐部...');
  const clubRecords = [];
  for (const team of teams) {
    const { data, error } = await supabase.from('clubs').insert({
      username: team.username,
      club_name: team.clubName,
      contact_name: team.contactName,
      phone: team.phone,
      password_hash: DUMMY_HASH,
      is_approved: true,
    }).select().single();

    if (error) {
      console.error(`  ❌ ${team.clubName} 创建失败: ${error.message}`);
    } else {
      clubRecords.push(data);
      console.log(`  ✅ ${data.club_name} (${data.id})`);
    }
  }
  console.log(`  共创建 ${clubRecords.length} 个俱乐部\n`);

  // ===================== 2. 创建领队+教练 =====================
  console.log('[2/4] 创建领队和教练...');
  const leaderRecords = [];
  const coachRecords = [];

  for (const club of clubRecords) {
    // 领队
    const { data: leader } = await supabase.from('team_leaders').insert({
      club_id: club.id,
      name: club.contact_name,
      phone: club.phone,
      position: '领队',
    }).select().single();
    if (leader) leaderRecords.push(leader);

    // 教练
    const coachNames = ['刘国强','孙丽娜','马志强','周美玲','张建平'];
    const coachName = coachNames[clubRecords.indexOf(club) % coachNames.length];
    const { data: coach } = await supabase.from('coaches').insert({
      club_id: club.id,
      name: coachName,
      phone: `158534${String(1000 + clubRecords.indexOf(club)).slice(-4)}`,
    }).select().single();
    if (coach) coachRecords.push(coach);
  }
  console.log(`  领队: ${leaderRecords.length}, 教练: ${coachRecords.length}\n`);

  // ===================== 3. 创建运动员 =====================
  console.log('[3/4] 创建运动员...');
  const athleteRecords = [];
  let maleIdx = 0;
  let femaleIdx = 0;

  for (const club of clubRecords) {
    // 每队：幼儿男子3名，幼儿女子3名
    const clubAthletes = [];

    for (let i = 0; i < 3; i++) {
      const birthYear = 2020 + Math.floor(Math.random() * 3); // 2020-2022
      const name = MALE_NAMES[maleIdx++ % MALE_NAMES.length];
      const { data: athlete } = await supabase.from('athletes').insert({
        club_id: club.id,
        name,
        gender: 'male',
        birth_date: randomBirthDate(birthYear),
        id_card: randomIdCard('male', birthYear),
      }).select().single();
      if (athlete) {
        clubAthletes.push(athlete);
        athleteRecords.push(athlete);
      }
    }

    for (let i = 0; i < 3; i++) {
      const birthYear = 2020 + Math.floor(Math.random() * 3);
      const name = FEMALE_NAMES[femaleIdx++ % FEMALE_NAMES.length];
      const { data: athlete } = await supabase.from('athletes').insert({
        club_id: club.id,
        name,
        gender: 'female',
        birth_date: randomBirthDate(birthYear),
        id_card: randomIdCard('female', birthYear),
      }).select().single();
      if (athlete) {
        clubAthletes.push(athlete);
        athleteRecords.push(athlete);
      }
    }
    console.log(`  ${club.club_name}: ${clubAthletes.length} 名运动员`);
  }
  console.log(`  共创建 ${athleteRecords.length} 名运动员\n`);

  // ===================== 4. 生成报名记录 =====================
  console.log('[4/4] 生成报名记录...');
  const registrations = [];
  let regIdx = 0;

  for (const club of clubRecords) {
    const clubAthletes = athleteRecords.filter(a => a.club_id === club.id);
    const males = clubAthletes.filter(a => a.gender === 'male');
    const females = clubAthletes.filter(a => a.gender === 'female');

    // 单摇跳 - 男子组：全部3名男子
    for (const a of males) {
      registrations.push({
        competition_id: COMP_ID,
        club_id: club.id,
        club_name: club.club_name,
        event_id: EVENT_SINGLE_ROPE,
        event_name: '30秒单摇跳',
        group_id: GROUP_SR_MALE,
        group_name: '幼儿组男子组',
        athletes: [{ athleteId: a.id, name: a.name }],
        status: 'pending',
      });
    }

    // 单摇跳 - 女子组：全部3名女子
    for (const a of females) {
      registrations.push({
        competition_id: COMP_ID,
        club_id: club.id,
        club_name: club.club_name,
        event_id: EVENT_SINGLE_ROPE,
        event_name: '30秒单摇跳',
        group_id: GROUP_SR_FEMALE,
        group_name: '幼儿组女子组',
        athletes: [{ athleteId: a.id, name: a.name }],
        status: 'pending',
      });
    }

    // 双摇跳 - 男子组：前2名男子（兼项）
    for (const a of males.slice(0, 2)) {
      registrations.push({
        competition_id: COMP_ID,
        club_id: club.id,
        club_name: club.club_name,
        event_id: EVENT_DOUBLE_ROPE,
        event_name: '30秒双摇跳',
        group_id: GROUP_DR_MALE,
        group_name: '幼儿组男子组',
        athletes: [{ athleteId: a.id, name: a.name }],
        status: 'pending',
      });
    }

    // 双摇跳 - 女子组：前2名女子（兼项）
    for (const a of females.slice(0, 2)) {
      registrations.push({
        competition_id: COMP_ID,
        club_id: club.id,
        club_name: club.club_name,
        event_id: EVENT_DOUBLE_ROPE,
        event_name: '30秒双摇跳',
        group_id: GROUP_DR_FEMALE,
        group_name: '幼儿组女子组',
        athletes: [{ athleteId: a.id, name: a.name }],
        status: 'pending',
      });
    }
  }

  // 批量插入报名
  const BATCH_SIZE = 20;
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < registrations.length; i += BATCH_SIZE) {
    const batch = registrations.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('registrations').insert(batch);
    if (error) {
      failed += batch.length;
      console.error(`  批次失败: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`  报名记录: 成功 ${inserted}, 失败 ${failed}\n`);

  // ===================== 统计 =====================
  console.log('='.repeat(55));
  console.log('           📊 幼儿组报名数据统计');
  console.log('='.repeat(55));
  console.log(`  赛事:     "好运山东"德州市2026年第一届中小学跳绳比赛`);
  console.log(`  俱乐部:   ${clubRecords.length} 支`);
  console.log(`  运动员:   ${athleteRecords.length} 名 (男${athleteRecords.filter(a=>a.gender==='male').length} 女${athleteRecords.filter(a=>a.gender==='female').length})`);
  console.log(`  领队:     ${leaderRecords.length} 名`);
  console.log(`  教练:     ${coachRecords.length} 名`);
  console.log(`  ──────────────────────────`);
  console.log(`  30秒单摇跳: ${registrations.filter(r=>r.event_id===EVENT_SINGLE_ROPE).length} 条`);
  console.log(`  30秒双摇跳: ${registrations.filter(r=>r.event_id===EVENT_DOUBLE_ROPE).length} 条`);
  console.log(`  报名总数:   ${registrations.length} 条`);
  console.log('='.repeat(55));

  // 详细队伍列表
  console.log('\n📋 队伍详情：');
  for (const club of clubRecords) {
    const clubAthletes = athleteRecords.filter(a => a.club_id === club.id);
    console.log(`\n  🏫 ${club.club_name}`);
    console.log(`     联系人: ${club.contact_name} ${club.phone}`);
    console.log(`     运动员:`);
    clubAthletes.forEach(a => {
      const events = registrations.filter(r => r.athletes.some(at => at.athleteId === a.id));
      const eventNames = events.map(r => `${r.event_name}(${r.group_name})`).join(', ');
      console.log(`       ${a.gender === 'male' ? '👦' : '👧'} ${a.name} | ${a.birth_date} | ${eventNames}`);
    });
  }
}

main().catch(err => {
  console.error('脚本出错:', err.message);
  process.exit(1);
});
