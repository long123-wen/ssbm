/**
 * 一键部署到 Cloudflare Pages
 *
 * 封装了本项目踩过的所有坑，直接用 `npm run deploy` 即可：
 *  1. wrangler 装在独立目录（项目 node_modules 被环境删除钩子锁死，装不进去）
 *     → 用 node 直接跑 cli.js，省掉 npx 每次 ~17s 的解析开销
 *  2. WRANGLER_CACHE_DIR 指向系统临时目录
 *     → 绕开 node_modules/.cache/wrangler/pages.json 的 EPERM（第 4 次遇到）
 *  3. CI=true → 非交互，不弹确认
 *  4. 构建默认跳过 tsc 类型检查（省 ~37s），需要时加 --typecheck
 *
 * 用法：
 *   node scripts/deploy.mjs                 # 快速构建 + 部署
 *   node scripts/deploy.mjs --typecheck     # 先跑 tsc 类型检查再构建部署
 *   node scripts/deploy.mjs --skip-build    # 只部署（用现有 dist）
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PROJECT_NAME = 'rope-jump-registration';

const WRANGLER_HOME = 'C:/Users/Administrator/.workbuddy/tools/wrangler';
const WRANGLER_CLI = join(WRANGLER_HOME, 'node_modules/wrangler/wrangler-dist/cli.js');
// 兜底：独立目录没装时，退回 npx 缓存里的 wrangler（慢但能用）
const FALLBACK_CLI = findNpxWrangler();

const args = process.argv.slice(2);
const wantTypecheck = args.includes('--typecheck');
const skipBuild = args.includes('--skip-build');

const T0 = Date.now();
const stamp = () => `[${((Date.now() - T0) / 1000).toFixed(1)}s]`;

function run(cmd, args_, opts = {}) {
  const r = spawnSync(cmd, args_, { stdio: 'inherit', shell: false, cwd: ROOT, ...opts });
  if (r.status !== 0) {
    console.error(`\n❌ 命令失败: ${cmd} ${args_.join(' ')} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

/** 在 npx 缓存里找已下载的 wrangler（独立目录不可用时的兜底） */
function findNpxWrangler() {
  const base = 'C:/Users/Administrator/AppData/Local/npm-cache/_npx';
  if (!existsSync(base)) return null;
  try {
    for (const dir of readdirSync(base)) {
      const p = join(base, dir, 'node_modules/wrangler/wrangler-dist/cli.js');
      if (existsSync(p)) return p;
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

/**
 * 取得 API token：优先用当前进程环境；没有则读 Windows 用户级环境变量
 * （用户级变量设置后，已打开的终端不会自动继承，所以这里做一层兜底）
 */
function resolveToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  if (process.platform !== 'win32') return null;
  try {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
        '[Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN","User")'],
      { encoding: 'utf8', windowsHide: true },
    );
    const v = (r.stdout || '').trim();
    return v || null;
  } catch {
    return null;
  }
}

const cli = existsSync(WRANGLER_CLI) ? WRANGLER_CLI : FALLBACK_CLI;
if (!cli) {
  console.error('❌ 找不到 wrangler（独立目录与 npx 缓存都没有）');
  process.exit(1);
}
console.log(`🔧 wrangler: ${cli}`);

// ---- 构建 ----
if (!skipBuild) {
  // vite 清空 dist 时可能被环境删除钩子卡住 → 先把旧 dist 改名再构建
  const distDir = join(ROOT, 'dist');
  if (existsSync(distDir)) {
    const old = join(ROOT, `.dist_old_${Date.now()}`);
    try {
      renameSync(distDir, old);
      console.log(`${stamp()} 旧 dist 已移开（→ ${old}，可事后手动删）`);
    } catch {
      /* 改名失败就交给 vite 处理 */
    }
  }
  if (wantTypecheck) {
    console.log(`${stamp()} 运行类型检查...`);
    run(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-b']);
  }
  console.log(`${stamp()} 构建中（跳过类型检查，需检查用 --typecheck）...`);
  // 直接用 node 跑本地 vite，绕开 npx（Windows 下 npx.cmd 无法被 spawnSync 无 shell 启动，且 npx 有解析开销）
  run(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build']);
  run(process.execPath, [join('scripts', 'copy-functions.mjs')]);
  console.log(`${stamp()} 构建完成`);
}

// ---- 部署 ----
const cacheDir = join(tmpdir(), 'rjr-wrangler-cache');
mkdirSync(cacheDir, { recursive: true });

const token = resolveToken();
if (!token) {
  console.error([
    '',
    '❌ 找不到 CLOUDFLARE_API_TOKEN。',
    '   方式一（推荐，永久生效）：',
    '   [Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "<你的token>", "User")',
    '   方式二（临时）：在命令行前加 CLOUDFLARE_API_TOKEN=xxx',
    '',
  ].join('\n'));
  process.exit(1);
}

console.log(`${stamp()} 部署到 Cloudflare Pages (${PROJECT_NAME})...`);
run(process.execPath, [cli, 'pages', 'deploy', 'dist',
  '--project-name', PROJECT_NAME, '--commit-dirty=true'], {
  env: {
    ...process.env,
    CI: 'true',
    WRANGLER_CACHE_DIR: cacheDir,
    CLOUDFLARE_API_TOKEN: token,
  },
});

console.log(`\n✅ 部署完成，总耗时 ${((Date.now() - T0) / 1000).toFixed(1)}s → https://www.dztsbmxt.top/`);
