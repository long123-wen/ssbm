# 赛事报名系统

跳绳赛事报名与管理系统，包含**管理端**和**俱乐部报名端**，部署在 Cloudflare Pages。

## 技术栈

- 前端：React + TypeScript + Vite + Tailwind CSS
- 后端：Cloudflare Pages Functions
- 数据库：Cloudflare D1（`REGISTRATION_DB`）
- 部署域名：`www.dztsbmxt.top`（生产主域，alias: `dztsbmxt.top`）

## 功能模块

### 管理端
- **赛事管理**：创建/编辑赛事、报名开关（开放 / 截止）
- **项目 & 分组**：从竞赛预设勾选项目与分组，快速配置
- **限报配置**：按队伍 / 项目 / 分组三个维度设置人数上限
- **报名审核**：确认或拒绝各参赛单位的报名
- **出场顺序**：生成并导出出场顺序表
- **计分表**：导入出场顺序簿生成计分表，支持发布 / 取消发布与导出

### 报名端（俱乐部）
- 运动员、教练员、领队管理
- 队伍资料（队名、口号、队徽）
- 按项目填报报名，自动按年龄性别筛选可报组别
- 查看已发布的计分表

## 业务规则

### 限报
统一在「限报配置」页设置，写入 `limit_configs` 表。
未配置的维度表示**不限制**。

### 跨组别（报高不报低）
- **个人项目**、**2-4 人小集体**：只允许往更大年龄组升报，**严禁降组**报更小的年龄组
- **5 人及以上大集体**：不设年龄分组，自由组队

### 年龄分组
按**出生日期范围**判定，随赛事年份动态推算：

```
出生年份 = 赛事年份 − 年龄
年龄区间 [ageMin, ageMax] → 出生日期 [`${年-ageMax}-01-01`, `${年-ageMin}-12-31`]
```

例如 2026 年赛事，幼儿组（4-6 岁）对应 `2020-01-01 ~ 2022-12-31`；
2027 年自动顺延为 `2021-01-01 ~ 2023-12-31`，无需改代码。

### 命名体系（互斥）
同一场比赛只能使用**一套**命名体系，不可混用：

|中文命名|U 系列|年龄|
|---|---|---|
|幼儿组|U6|4-6 岁|
|儿童甲组|U9|7-9 岁|
|儿童乙组|U12|10-12 岁|
|少年甲组|U15|13-15 岁|
|少年乙组|U18|16-18 岁|
|青年组|19+|19-25 岁|
|成年组|26+|26 岁及以上|

特教组、亲子甲组、亲子乙组、不分组别为通用组别，两套体系均可共存。

## 本地开发

```bash
npm install
npm run dev          # 开发服务器
npm run build        # 构建到 dist/
```

## 部署

```bash
# 1. 构建前端
npx vite build

# 2. 编译 Functions
npx wrangler pages functions build ./functions --outdir=./out --compatibility-date=2026-01-01
cp out/index.js dist/_worker.js

# 3. 部署
npx wrangler pages deploy ./dist --project-name=rope-jump-registration --branch=main
```

数据库迁移位于 `migrations/`，应用方式：

```bash
npx wrangler d1 execute REGISTRATION_DB --file=./migrations/000X_xxx.sql --remote
```

## 环境变量

在 Cloudflare Pages 项目设置中配置（本地开发写入 `.env`，**不要提交**）：

- Supabase 相关配置
- 管理员会话密钥等
