// 为出场顺序表测试生成跨项目、跨分组的全面测试数据
// 覆盖：30秒单摇跳(1人,8组) + 30秒双摇跳(1人,4组) + 4×30秒单摇接力(4人,6组)
// 用法: node scripts/seed-test-orderbook.mjs

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

// ==================== 从数据库查询到的固定 ID ====================
const COMP_ID = 'ba68565c-9112-4a63-ab3b-b59379761fc5';

// 项目
const EVENTS = {
  SR_S30:    { id: 'ef08f3cf-f17b-4b1c-b24b-5fcde6576e7f', name: '30秒单摇跳',        code: 'SR-S30',    maxAthletes: 1 },
  DR_S30:    { id: '9cfdea52-e045-4746-91e4-7c3492ef7f7b', name: '30秒双摇跳',        code: 'DR-S30',    maxAthletes: 1 },
  SR_R4x30:  { id: 'a68b745e-98e8-4771-af1b-bac3b274c0d7', name: '4×30秒单摇接力',    code: 'SR-R4x30',  maxAthletes: 4 },
};

// 分组（按项目+组名映射）
const GROUPS = {
  // 30秒单摇跳
  SR_S30_PRESCHOOL_M:  { id: '70470c40-74d9-43c8-a1a2-3c4f31fd1ac8', name: '幼儿组男子组',  gender: 'male' },
  SR_S30_OPEN:         { id: '373bf8af-2ada-49ba-9102-c12e8ce90999', name: '不分组别',      gender: null },
  SR_S30_JU_A_M:       { id: 'f9eb686f-b95d-413d-8fec-de9dca7c0bdd', name: '儿童甲组男子组', gender: 'male' },
  SR_S30_JU_A_F:       { id: '725e6555-b3f1-4250-9564-9c1d2c4fed03', name: '儿童甲组女子组', gender: 'female' },
  SR_S30_JU_A_MIX:     { id: 'ad4de2ee-b909-422f-b0f4-6d75b3af97f0', name: '儿童甲组混合组', gender: 'mixed' },
  SR_S30_JU_B_M:       { id: 'f2a09272-7604-4cca-bf09-d0389e66482c', name: '儿童乙组男子组', gender: 'male' },
  SR_S30_JU_B_F:       { id: '6a109f34-ef81-458b-905a-6c48811f1763', name: '儿童乙组女子组', gender: 'female' },
  SR_S30_JU_B_MIX:     { id: 'b822d174-5d86-4e33-bf40-94ec5038336d', name: '儿童乙组混合组', gender: 'mixed' },
  // 30秒双摇跳
  DR_S30_JU_A_M:       { id: 'c75ecd03-c93d-4e11-9eb3-79f01f13ab00', name: '儿童甲组男子组', gender: 'male' },
  DR_S30_JU_A_F:       { id: '41d3f976-7920-4463-aa4f-2fdc588fd28c', name: '儿童甲组女子组', gender: 'female' },
  DR_S30_JU_B_M:       { id: 'ba9f03da-5659-4b0f-9740-c4714474ec15', name: '儿童乙组男子组', gender: 'male' },
  DR_S30_JU_B_F:       { id: '51e6c791-1009-493f-b348-aa0389434555', name: '儿童乙组女子组', gender: 'female' },
  // 4×30秒单摇接力
  SR_R4_JU_A_M:        { id: '9dce417d-ed6c-4c55-b7bf-e9e28abcc33b', name: '儿童甲组男子组', gender: 'male' },
  SR_R4_JU_A_F:        { id: '22ffa1a9-c9b9-444b-a480-f2a4dcbc0e59', name: '儿童甲组女子组', gender: 'female' },
  SR_R4_JU_A_MIX:      { id: 'e4dc11b8-c82f-4641-9ad3-d5c372bd0b96', name: '儿童甲组混合组', gender: 'mixed' },
  SR_R4_JU_B_M:        { id: 'a44f2b93-d7e7-4a2c-9afc-fd13726a1769', name: '儿童乙组男子组', gender: 'male' },
  SR_R4_JU_B_F:        { id: '95741a2c-1bae-47e6-bc92-2682a4ad707e', name: '儿童乙组女子组', gender: 'female' },
  SR_R4_JU_B_MIX:      { id: 'f94395c6-2162-407b-924c-c3e12a69104f', name: '儿童乙组混合组', gender: 'mixed' },
};

// ==================== 队伍数据 ====================
const teams = [
  { username: 'dzsx01', clubName: '德州市实验小学',       contactName: '王建国', phone: '13853401001' },
  { username: 'dzsx02', clubName: '德州市解放北路小学',   contactName: '李明远', phone: '13953402002' },
  { username: 'dzsx03', clubName: '德州市天衢东路小学',   contactName: '赵志强', phone: '13753403003' },
  { username: 'dzsx04', clubName: '德州市湖滨北路小学',   contactName: '陈国强', phone: '13653404004' },
  { username: 'dzsx05', clubName: '德州市东风东路小学',   contactName: '张明亮', phone: '13553405005' },
];

const AREA_CODES = ['371402','371422','371423','371424','371425','371426','371427','371428','371481','371482'];

// 名字库
const MALE_PRESCHOOL = ['王子涵','李一诺','张晨阳','赵宇航','刘明轩'];     // 幼儿男 5-6岁
const FEMALE_PRESCHOOL = ['陈雨桐','杨欣妍','黄思琪','周梓涵','吴可欣'];   // 幼儿女 5-6岁
const MALE_JU_A = ['郑博文','孙嘉乐','马天佑','朱思远','胡明轩','高子墨','梁雨泽','郭一帆'];  // 儿童甲男 7-9岁
const FEMALE_JU_A = ['张若曦','李欣怡','王语嫣','赵诗涵','刘思彤','陈雨萱','杨梓涵','黄艺琳'];  // 儿童甲女 7-9岁
const MALE_JU_B = ['罗俊熙','宋宇航','谢子恒','韩博远','唐锦程','冯子昂','董一鸣','程天宇'];  // 儿童乙男 10-12岁
const FEMALE_JU_B = ['周可欣','吴雨桐','郑依诺','孙梦瑶','马诗涵','朱雨薇','胡可馨','高紫萱'];  // 儿童乙女 10-12岁

function randomIdCard(gender, birthYear) {
  const area = AREA_CODES[Math.floor(Math.random() * AREA_CODES.length)];
  const m = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const d = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  const genderDigit = gender === 'male' ? (Math.floor(Math.random() * 5) * 2 + 1) : (Math.floor(Math.random() * 5) * 2);
  const body = `${area}${birthYear}${m}${d}${seq}${genderDigit}`;
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

const DUMMY_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

async function clearOldData() {
  console.log('[0] 清除旧测试数据...');
  const oldClubs = await supabase.from('clubs').select('id').in('username', teams.map(t => t.username));
  if (oldClubs.data?.length > 0) {
    const ids = oldClubs.data.map(c => c.id);
    await supabase.from('registrations').delete().in('club_id', ids);
    await supabase.from('athletes').delete().in('club_id', ids);
    await supabase.from('coaches').delete().in('club_id', ids);
    await supabase.from('team_leaders').delete().in('club_id', ids);
    await supabase.from('clubs').delete().in('id', ids);
    console.log(`  已清除 ${ids.length} 个旧俱乐部及其关联数据`);
  } else {
    console.log('  无旧数据需要清除');
  }
}

async function main() {
  console.log('=== 出场顺序表测试数据生成 ===\n');

  await clearOldData();

  // ===================== 1. 创建俱乐部 =====================
  console.log('[1/5] 创建俱乐部...');
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
      console.error(`  ❌ ${team.clubName}: ${error.message}`);
    } else {
      clubRecords.push(data);
      console.log(`  ✅ ${data.club_name}`);
    }
  }
  console.log(`  共 ${clubRecords.length} 个俱乐部\n`);

  // ===================== 2. 创建领队+教练 =====================
  console.log('[2/5] 创建领队和教练...');
  for (const club of clubRecords) {
    await supabase.from('team_leaders').insert({
      club_id: club.id, name: club.contact_name, phone: club.phone, position: '领队',
    });
    const coachIdx = clubRecords.indexOf(club);
    await supabase.from('coaches').insert({
      club_id: club.id,
      name: ['刘志强','孙丽萍','马国栋','周晓红','张建华'][coachIdx],
      phone: `158534${String(6000 + coachIdx)}`,
    });
  }
  console.log(`  领队: ${clubRecords.length}, 教练: ${clubRecords.length}\n`);

  // ===================== 3. 创建运动员 =====================
  console.log('[3/5] 创建运动员...\n  每队: 幼儿男2+幼儿女2 + 儿童甲男3+儿童甲女3 + 儿童乙男3+儿童乙女3 = 16名');

  const allAthletes = []; // { id, name, gender, birthYear, clubId, clubName, ageGroup }
  let nameIdx = { mp:0, fp:0, ma:0, fa:0, mb:0, fb:0 };

  for (const club of clubRecords) {
    const batch = [];

    // 幼儿男 (2021-2022, 5-6岁)
    for (let i = 0; i < 2; i++) {
      const by = 2021 + Math.floor(Math.random() * 2);
      batch.push({ club_id: club.id, name: MALE_PRESCHOOL[nameIdx.mp++ % 5], gender: 'male', birth_date: randomBirthDate(by), id_card: randomIdCard('male', by), _ageGroup: 'preschool' });
    }
    // 幼儿女 (2021-2022)
    for (let i = 0; i < 2; i++) {
      const by = 2021 + Math.floor(Math.random() * 2);
      batch.push({ club_id: club.id, name: FEMALE_PRESCHOOL[nameIdx.fp++ % 5], gender: 'female', birth_date: randomBirthDate(by), id_card: randomIdCard('female', by), _ageGroup: 'preschool' });
    }
    // 儿童甲男 (2017-2019, 7-9岁)
    for (let i = 0; i < 3; i++) {
      const by = 2017 + Math.floor(Math.random() * 3);
      batch.push({ club_id: club.id, name: MALE_JU_A[nameIdx.ma++ % 8], gender: 'male', birth_date: randomBirthDate(by), id_card: randomIdCard('male', by), _ageGroup: 'juA' });
    }
    // 儿童甲女 (2017-2019)
    for (let i = 0; i < 3; i++) {
      const by = 2017 + Math.floor(Math.random() * 3);
      batch.push({ club_id: club.id, name: FEMALE_JU_A[nameIdx.fa++ % 8], gender: 'female', birth_date: randomBirthDate(by), id_card: randomIdCard('female', by), _ageGroup: 'juA' });
    }
    // 儿童乙男 (2014-2016, 10-12岁)
    for (let i = 0; i < 3; i++) {
      const by = 2014 + Math.floor(Math.random() * 3);
      batch.push({ club_id: club.id, name: MALE_JU_B[nameIdx.mb++ % 8], gender: 'male', birth_date: randomBirthDate(by), id_card: randomIdCard('male', by), _ageGroup: 'juB' });
    }
    // 儿童乙女 (2014-2016)
    for (let i = 0; i < 3; i++) {
      const by = 2014 + Math.floor(Math.random() * 3);
      batch.push({ club_id: club.id, name: FEMALE_JU_B[nameIdx.fb++ % 8], gender: 'female', birth_date: randomBirthDate(by), id_card: randomIdCard('female', by), _ageGroup: 'juB' });
    }

    const inserts = [];
    for (const a of batch) {
      const { _ageGroup, ...fields } = a;
      inserts.push(fields);
    }
    const { data: athletes, error } = await supabase.from('athletes').insert(inserts).select();

    if (error) {
      console.error(`  ❌ ${club.club_name} 运动员创建失败: ${error.message}`);
    } else {
      const enriched = athletes.map((a, i) => ({ ...a, ageGroup: batch[i]._ageGroup, clubName: club.club_name }));
      allAthletes.push(...enriched);
      console.log(`  ✅ ${club.club_name}: ${athletes.length} 名 (幼${enriched.filter(a=>a.ageGroup==='preschool').length} 甲${enriched.filter(a=>a.ageGroup==='juA').length} 乙${enriched.filter(a=>a.ageGroup==='juB').length})`);
    }
  }
  console.log(`  共 ${allAthletes.length} 名运动员\n`);

  // ===================== 4. 生成报名记录 =====================
  console.log('[4/5] 生成报名记录...');

  const registrations = [];

  for (const club of clubRecords) {
    const clubAthletes = allAthletes.filter(a => a.club_id === club.id);
    const cid = club.id;
    const cname = club.club_name;

    const groupByAgeGender = (ageGroup, gender) => clubAthletes.filter(a => a.ageGroup === ageGroup && a.gender === gender);

    // -- 30秒单摇跳 (SR-S30) 个人项目 --
    // 幼儿组男子组：幼儿男
    for (const a of groupByAgeGender('preschool', 'male')) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_S30.id, event_name: EVENTS.SR_S30.name, group_id: GROUPS.SR_S30_PRESCHOOL_M.id, group_name: GROUPS.SR_S30_PRESCHOOL_M.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }
    // 不分组别：每个俱乐部派几个混合年龄代表
    const openCandidates = clubAthletes.filter(a => a.ageGroup !== 'preschool' || a.gender === 'female');
    for (const a of openCandidates.slice(0, 2)) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_S30.id, event_name: EVENTS.SR_S30.name, group_id: GROUPS.SR_S30_OPEN.id, group_name: GROUPS.SR_S30_OPEN.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }
    // 儿童甲组男子组：儿童甲男
    for (const a of groupByAgeGender('juA', 'male')) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_S30.id, event_name: EVENTS.SR_S30.name, group_id: GROUPS.SR_S30_JU_A_M.id, group_name: GROUPS.SR_S30_JU_A_M.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }
    // 儿童甲组女子组：儿童甲女
    for (const a of groupByAgeGender('juA', 'female')) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_S30.id, event_name: EVENTS.SR_S30.name, group_id: GROUPS.SR_S30_JU_A_F.id, group_name: GROUPS.SR_S30_JU_A_F.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }
    // 儿童甲组混合组：选部分儿童甲男+女
    const juA_mix = [...groupByAgeGender('juA', 'male').slice(0, 1), ...groupByAgeGender('juA', 'female').slice(0, 1)];
    for (const a of juA_mix) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_S30.id, event_name: EVENTS.SR_S30.name, group_id: GROUPS.SR_S30_JU_A_MIX.id, group_name: GROUPS.SR_S30_JU_A_MIX.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }
    // 儿童乙组男子组：儿童乙男
    for (const a of groupByAgeGender('juB', 'male')) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_S30.id, event_name: EVENTS.SR_S30.name, group_id: GROUPS.SR_S30_JU_B_M.id, group_name: GROUPS.SR_S30_JU_B_M.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }
    // 儿童乙组女子组：儿童乙女
    for (const a of groupByAgeGender('juB', 'female')) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_S30.id, event_name: EVENTS.SR_S30.name, group_id: GROUPS.SR_S30_JU_B_F.id, group_name: GROUPS.SR_S30_JU_B_F.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }
    // 儿童乙组混合组：选部分儿童乙男+女
    const juB_mix = [...groupByAgeGender('juB', 'male').slice(0, 1), ...groupByAgeGender('juB', 'female').slice(0, 1)];
    for (const a of juB_mix) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_S30.id, event_name: EVENTS.SR_S30.name, group_id: GROUPS.SR_S30_JU_B_MIX.id, group_name: GROUPS.SR_S30_JU_B_MIX.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }

    // -- 30秒双摇跳 (DR-S30) 个人项目 --
    // 儿童甲组男子组：儿童甲男（前2名，兼项）
    for (const a of groupByAgeGender('juA', 'male').slice(0, 2)) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.DR_S30.id, event_name: EVENTS.DR_S30.name, group_id: GROUPS.DR_S30_JU_A_M.id, group_name: GROUPS.DR_S30_JU_A_M.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }
    // 儿童甲组女子组：儿童甲女（前2名）
    for (const a of groupByAgeGender('juA', 'female').slice(0, 2)) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.DR_S30.id, event_name: EVENTS.DR_S30.name, group_id: GROUPS.DR_S30_JU_A_F.id, group_name: GROUPS.DR_S30_JU_A_F.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }
    // 儿童乙组男子组：儿童乙男（前2名）
    for (const a of groupByAgeGender('juB', 'male').slice(0, 2)) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.DR_S30.id, event_name: EVENTS.DR_S30.name, group_id: GROUPS.DR_S30_JU_B_M.id, group_name: GROUPS.DR_S30_JU_B_M.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }
    // 儿童乙组女子组：儿童乙女（前2名）
    for (const a of groupByAgeGender('juB', 'female').slice(0, 2)) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.DR_S30.id, event_name: EVENTS.DR_S30.name, group_id: GROUPS.DR_S30_JU_B_F.id, group_name: GROUPS.DR_S30_JU_B_F.name, athletes: [{ athleteId: a.id, name: a.name }], status: 'pending' });
    }

    // -- 4×30秒单摇接力 (SR-R4x30) 多人项目（4人一队）--
    // 儿童甲组男子组：4名儿童甲男组成一队
    const juA_male_team = groupByAgeGender('juA', 'male').slice(0, 4);
    if (juA_male_team.length >= 4) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_R4x30.id, event_name: EVENTS.SR_R4x30.name, group_id: GROUPS.SR_R4_JU_A_M.id, group_name: GROUPS.SR_R4_JU_A_M.name, athletes: juA_male_team.map(a => ({ athleteId: a.id, name: a.name })), status: 'pending' });
    }
    // 儿童甲组女子组：4名儿童甲女组成一队
    const juA_female_team = groupByAgeGender('juA', 'female').slice(0, 4);
    if (juA_female_team.length >= 4) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_R4x30.id, event_name: EVENTS.SR_R4x30.name, group_id: GROUPS.SR_R4_JU_A_F.id, group_name: GROUPS.SR_R4_JU_A_F.name, athletes: juA_female_team.map(a => ({ athleteId: a.id, name: a.name })), status: 'pending' });
    }
    // 儿童甲组混合组：2男2女组成一队
    const juA_mix_team = [...groupByAgeGender('juA', 'male').slice(0, 2), ...groupByAgeGender('juA', 'female').slice(0, 2)];
    if (juA_mix_team.length >= 4) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_R4x30.id, event_name: EVENTS.SR_R4x30.name, group_id: GROUPS.SR_R4_JU_A_MIX.id, group_name: GROUPS.SR_R4_JU_A_MIX.name, athletes: juA_mix_team.map(a => ({ athleteId: a.id, name: a.name })), status: 'pending' });
    }
    // 儿童乙组男子组：4名儿童乙男
    const juB_male_team = groupByAgeGender('juB', 'male').slice(0, 4);
    if (juB_male_team.length >= 4) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_R4x30.id, event_name: EVENTS.SR_R4x30.name, group_id: GROUPS.SR_R4_JU_B_M.id, group_name: GROUPS.SR_R4_JU_B_M.name, athletes: juB_male_team.map(a => ({ athleteId: a.id, name: a.name })), status: 'pending' });
    }
    // 儿童乙组女子组：4名儿童乙女
    const juB_female_team = groupByAgeGender('juB', 'female').slice(0, 4);
    if (juB_female_team.length >= 4) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_R4x30.id, event_name: EVENTS.SR_R4x30.name, group_id: GROUPS.SR_R4_JU_B_F.id, group_name: GROUPS.SR_R4_JU_B_F.name, athletes: juB_female_team.map(a => ({ athleteId: a.id, name: a.name })), status: 'pending' });
    }
    // 儿童乙组混合组：2男2女
    const juB_mix_team = [...groupByAgeGender('juB', 'male').slice(0, 2), ...groupByAgeGender('juB', 'female').slice(0, 2)];
    if (juB_mix_team.length >= 4) {
      registrations.push({ competition_id: COMP_ID, club_id: cid, club_name: cname, event_id: EVENTS.SR_R4x30.id, event_name: EVENTS.SR_R4x30.name, group_id: GROUPS.SR_R4_JU_B_MIX.id, group_name: GROUPS.SR_R4_JU_B_MIX.name, athletes: juB_mix_team.map(a => ({ athleteId: a.id, name: a.name })), status: 'pending' });
    }
  }

  // ===================== 5. 批量插入报名 =====================
  console.log(`\n[5/5] 批量插入 ${registrations.length} 条报名记录...`);
  const BATCH = 20;
  let ok = 0, fail = 0;
  for (let i = 0; i < registrations.length; i += BATCH) {
    const batch = registrations.slice(i, i + BATCH);
    const { error } = await supabase.from('registrations').insert(batch);
    if (error) { fail += batch.length; console.error(`  批次失败: ${error.message}`); }
    else { ok += batch.length; }
  }
  console.log(`  成功 ${ok}, 失败 ${fail}\n`);

  // ===================== 统计 =====================
  console.log('='.repeat(60));
  console.log('           📊 出场顺序表测试数据统计');
  console.log('='.repeat(60));
  console.log(`  赛事:   "好运山东"德州市2026年第一届中小学跳绳比赛`);
  console.log(`  俱乐部: ${clubRecords.length} 支`);
  console.log(`  运动员: ${allAthletes.length} 名`);
  console.log(`  ──────────────────────────`);
  const countByEvent = {};
  const countByGroup = {};
  for (const r of registrations) {
    countByEvent[r.event_name] = (countByEvent[r.event_name] || 0) + 1;
    countByGroup[r.group_name] = (countByGroup[r.group_name] || 0) + 1;
  }
  for (const [k, v] of Object.entries(countByEvent)) {
    console.log(`  ${k}: ${v} 条`);
  }
  console.log(`  ──────────────────────────`);
  console.log('  分组分布:');
  for (const [k, v] of Object.entries(countByGroup)) {
    console.log(`    ${k}: ${v} 条`);
  }
  console.log(`  报名总数: ${registrations.length} 条`);
  console.log('='.repeat(60));

  // 更新分组 current_count
  console.log('\n  更新分组人数计数...');
  for (const gid of Object.values(GROUPS)) {
    const { data: regs } = await supabase.from('registrations')
      .select('id').eq('group_id', gid.id).not('status', 'eq', 'rejected');
    await supabase.from('event_groups').update({ current_count: (regs || []).length }).eq('id', gid.id);
  }
  console.log('  ✅ 分组计数已更新\n');

  console.log('🎉 测试数据生成完毕！打开管理后台 → 出场顺序 查看效果');
}

main().catch(err => {
  console.error('脚本出错:', err.message);
  process.exit(1);
});