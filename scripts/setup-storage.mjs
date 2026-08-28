// 通过 SECURITY DEFINER RPC 函数创建存储桶
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

async function main() {
  console.log('=== 创建 athlete-avatars 存储桶 ===\n');

  // Step 1: 创建 SECURITY DEFINER RPC 函数
  console.log('[1] 创建 RPC 函数 create_avatar_bucket...');
  const { error: fnErr } = await supabase.rpc('create_avatar_bucket_helper', {});
  
  if (fnErr) {
    // 函数不存在，通过 REST API 创建
    console.log('  RPC 函数不存在，尝试通过 REST 创建...');
  }

  // Step 2: 尝试直接插入 storage.buckets（如果权限允许）
  console.log('[2] 尝试创建存储桶...');
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  
  if (listErr) {
    console.log(`  ❌ 无法列出现有存储桶: ${listErr.message}`);
    console.log('\n  请手动在 Supabase SQL Editor 执行: db/storage-setup.sql');
  } else {
    const existing = (buckets || []).find(b => b.name === 'athlete-avatars');
    if (existing) {
      console.log('  ✅ 存储桶已存在');
    } else {
      // 尝试创建
      const { error: createErr } = await supabase.storage.createBucket('athlete-avatars', {
        public: true,
        fileSizeLimit: 2097152,
        allowedMimeTypes: ['image/jpeg', 'image/png'],
      });
      if (createErr) {
        console.log(`  ❌ 自动创建失败: ${createErr.message}`);
        console.log('\n  请手动在 Supabase SQL Editor 执行: db/storage-setup.sql');
      } else {
        console.log('  ✅ 存储桶创建成功');
      }
    }
  }

  // Step 3: 显示存储桶信息
  console.log('\n[3] 存储桶列表:');
  const { data: list } = await supabase.storage.listBuckets();
  for (const b of (list || [])) {
    console.log(`  - ${b.name} (public: ${b.public}, limit: ${b.file_size_limit} bytes)`);
  }
}

main().catch(err => {
  console.error('出错:', err.message);
  process.exit(1);
});
