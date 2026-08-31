# 跳绳赛事报名系统 · CloudBase 部署指南

## 📦 项目构建

构建产物已生成在 `dist/` 目录，直接上传即可。

---

## 🚀 腾讯云 CloudBase 部署步骤

### 方式一：CloudBase CLI 部署（推荐）

```bash
# 1. 安装 CloudBase CLI
npm install -g @cloudbase/cli

# 2. 登录
cloudbase login

# 3. 进入项目目录
cd rope-jump-registration

# 4. 修改 cloudbaserc.json 中的 envId 为你的环境 ID

# 5. 一键部署
cloudbase framework deploy
```

### 方式二：控制台手动上传

1. 登录 [腾讯云 CloudBase 控制台](https://console.cloud.tencent.com/tcb)
2. 进入「云开发 → 静态网站托管」
3. 点击「上传文件夹」
4. 选择本项目的 `dist/` 目录上传
5. 设置「默认首页」为 `index.html`
6. 设置「错误页面」也为 `index.html`（支持 SPA 路由）

---

## 🔗 两个入口链接

部署成功后，你将得到一个域名，系统有以下两个入口：

| 模块 | 访问地址 | 说明 |
|------|----------|------|
| 主页 | `https://your-domain.com/` | 展示两个入口按钮 |
| 后台管理 | `https://your-domain.com/#admin` | 管理员登录后进入 |
| 在线报名 | `https://your-domain.com/#club` | 俱乐部/学校注册登录 |

---

## 🔑 默认管理员账号

| 账号 | 密码 |
|------|------|
| admin | ropejump2024 |

> ⚠️ **正式上线前请修改密码！** 在 `src/lib/store.ts` 的 `adminAuth` 对象中修改。

---

## 🌩️ CloudBase 云数据库升级（可选）

当前版本使用浏览器本地存储（localStorage）作为数据层。
要实现真正的多端云端共享，可以对接 CloudBase 云数据库：

1. 在控制台创建云数据库集合：
   - `competitions` - 赛事
   - `events` - 项目
   - `event_groups` - 分组
   - `clubs` - 俱乐部账号
   - `registrations` - 报名记录

2. 安装 CloudBase SDK：
   ```bash
   npm install @cloudbase/js-sdk
   ```

3. 替换 `src/lib/store.ts` 中的 localStorage 操作为云数据库 API

---

## 📋 系统功能说明

### 后台管理系统（admin）
- ✅ 数据总览：统计报名数据、项目分布
- ✅ 赛事管理：创建/编辑/删除赛事，设置状态
- ✅ 项目 & 分组：创建竞赛项目，配置性别/年龄/水平分组，设置限报数量
- ✅ 报名审核：确认/拒绝俱乐部报名
- ✅ 秩序册：自动随机编排出场顺序，一键导出 HTML 秩序册

### 在线自助报名（club）
- ✅ 账号注册/登录
- ✅ 团队管理：添加领队、教练员、运动员
- ✅ 在线报名：选择赛事、项目、分组，指定参赛运动员
- ✅ 我的报名：查看报名状态，导出报名详情表，撤销待审核报名

---

## 🛡️ 支持规模

- 支持 500+ 运动员同时报名
- 支持多赛事并行管理
- 支持多俱乐部/学校账号独立操作
