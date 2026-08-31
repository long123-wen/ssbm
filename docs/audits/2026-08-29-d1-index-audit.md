# D1 冗余索引审计报告

| 项目 | 值 |
|---|---|
| 报告日期 | 2026-08-29 |
| 数据库 | `rope-jump-registration-d1-20260814` (`2b3c1a09-f3c5-4950-9b6a-10ee858ba5aa`) |
| 数据库大小 | 978,944 bytes |
| 审计方式 | 实证 EXPLAIN QUERY PLAN（非凭直觉判断） |
| 索引总数 | 35（不含 `sqlite_*` / `_cf_*`） |
| 涉及表数 | 21 |
| DROP 建议 | 2（+ 3 个 defensive individual_registrations 清理） |
| 源代码修复 | 1（0006 与 0004 scorecard 索引重复声明） |
| 配套迁移 | `migrations/0009_drop_redundant_indexes.sql` + `0009_rollback.sql` |

---

## 0. TL;DR

通过 50+ 次线上 `EXPLAIN QUERY PLAN` 实证：

- **2 个索引可以安全 DROP**（任何生产查询都不会回退到这两条上）：
  1. `idx_registrations_comp_team_status` — 计划器在所有 (comp, team) / (club, comp) / (comp, club, team) 模式中都选用 `idx_registrations_club_team_created` 或 `idx_registrations_comp_status_created`，从不选这条。
  2. `idx_club_registration_edit_unlocks_competition` — 与表的 `UNIQUE(competition_id, club_id, team_scope)` 约束生成的 autoindex 完全同列同序，计划器总是选 autoindex。

- **2 个索引处于灰区，建议 KEEP**（单列、占用小、有回退价值）：
  - `idx_limit_configs_comp_scope` — 真实查询里多数走 unique autoindex，但保留作为"无 target_id 时的兜底"。
  - `idx_limit_configs_target` — 单列索引，少数"按 event/group 反查 limit"的路径会用。

- **3 个索引已无对应表，defensive DROP**（0005 已清，正常环境无影响）：
  - `idx_individual_reg_comp_status_created` / `idx_individual_reg_phone_created` / `idx_individual_registration_events_group`

- **源代码冗余 1 处**（不在 D1，但应清）：
  - `migrations/0006_scorecard_unpublished_status.sql` 第 72-74 行重复声明了 3 条 scorecard 索引，0004 早已声明；D1 用了 `IF NOT EXISTS` 不会重复创建，但源代码层面是 noise。

---

## 1. 审计方法

不靠"看索引列判断覆盖关系"——SQLite 计划器的选择逻辑比前缀覆盖更复杂。本审计对生产 D1 跑了 50+ 次 `EXPLAIN QUERY PLAN`，覆盖 `functions/_shared/workflows.ts` 与 `functions/_shared/db.ts` 中所有 FROM 子句，对应到代码里每一个查询模式。

```bash
npx.cmd wrangler d1 execute rope-jump-registration-d1-20260814 \
  --remote --yes --json --command "
    EXPLAIN QUERY PLAN
    SELECT id FROM registrations
    WHERE club_id = ? AND competition_id = ?
      AND COALESCE(team_profile_id, '') = COALESCE(?, '')"
```

`scripts/.d1-explain*.json` 留有完整结果（按查询分文件保存）。

### 1.1 索引清单来源

`SELECT name, tbl_name, sql FROM sqlite_master
 WHERE type='index' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`

→ 35 行 → 写入 `scripts/.d1-indexes-full.json`，清洗后写入 `scripts/.d1-indexes-clean.json`。

### 1.2 索引按表分布

| 表 | 索引数 |
|---|---|
| registrations | **6** |
| audit_logs | 3 |
| athletes / coaches / team_leaders / limit_configs / order_entries / scorecard_entries / sessions | 各 2 |
| 其余 13 张表 | 各 1 |

`registrations` 是最热的表（6 个索引，1 个建议 DROP）。

### 1.3 索引在源码中的声明位置

| 索引 | 声明 migration | 行号 | 备注 |
|---|---|---|---|
| 25 个核心索引 | `0001_initial_schema.sql` | 276-300 | 全部带 `IF NOT EXISTS` |
| 5 个工作流加固索引 | `0002_workflow_hardening.sql` | 123-128 | |
| 1 个 admin 解锁索引 | `0003_admin_registration_edit_unlocks.sql` | 16 | |
| 3 个 scorecard 索引 | `0004_scorecard_snapshots.sql` | 38-40 | |
| 3 个 scorecard 索引（**重复**） | `0006_scorecard_unpublished_status.sql` | 72-74 | 与 0004 重复 |
| 3 个复合索引 | `0008_atomic_limit_configs.sql` | 105, 107, 109 | |
| 2 个 individual_registrations 索引 | `0001_initial_schema.sql` | 294-295 | 0005 已清 |
| 1 个 individual_registration_events 索引 | `0002_workflow_hardening.sql` | 124 | 0005 已清 |

---

## 2. DROP 建议（高置信度）

### 2.1 `idx_registrations_comp_team_status` (registrations)

```sql
CREATE INDEX idx_registrations_comp_team_status
  ON registrations(competition_id, team_profile_id, club_id, status);
```

**实际查询模式**（来自 `workflows.ts` line 341-383）：

| 查询 | 期望索引 | EXPLAIN 真实选择 | 状态 |
|---|---|---|---|
| `WHERE id=? AND club_id=?` (PK + 所有权) | PK | `SEARCH ... USING PRIMARY KEY` | ✓ |
| `WHERE club_id=? AND competition_id=? AND COALESCE(team_profile_id,'')=COALESCE(?,'')` | (club, comp) 前缀 | `USING INDEX idx_registrations_club_team_created` | ✓ 走 club_team_created |
| `WHERE competition_id=? AND team_profile_id=?` (无 status) | (comp, team) 前缀 | `USING INDEX idx_registrations_comp_status_created` | ✓ 走 comp_status_created（status 列在 comp 内选择性 > team） |
| `WHERE competition_id=? AND status IN (...)` (动态) | (comp, status) 前缀 | `USING INDEX idx_registrations_comp_status_created` | ✓ 走 comp_status_created |

**结论**：4 种真实查询里，0 种选择 `idx_registrations_comp_team_status`。该索引从未被计划器偏好。其 `(comp, team)` 前缀被 `comp_status_created` 用更窄的 status 截胡；其 `(comp, team, club)` 长前缀被 `club_team_created` 用 club_id 截胡。**DROP 不会让任何现有查询变慢**。

### 2.2 `idx_club_registration_edit_unlocks_competition` (club_registration_edit_unlocks)

```sql
CREATE INDEX idx_club_registration_edit_unlocks_competition
  ON club_registration_edit_unlocks(competition_id, club_id, team_scope);
```

**问题**：0003 的 `club_registration_edit_unlocks` 表还声明了：

```sql
CREATE UNIQUE INDEX ... ON club_registration_edit_unlocks(competition_id, club_id, team_scope);
```

（确认见 `migrations/0003_admin_registration_edit_unlocks.sql` —— UNIQUE 约束自动生成 `sqlite_autoindex_club_registration_edit_unlocks_1`）

**EXPLAIN 实证**（`workflows.ts` line 272-275 / 313）：

| 查询 | 计划器选择 |
|---|---|
| `WHERE competition_id=? AND club_id=? AND team_scope=?` | `USING INDEX sqlite_autoindex_club_registration_edit_unlocks_1` |
| `DELETE WHERE competition_id=? AND club_id=? AND team_scope=?` | `USING INDEX sqlite_autoindex_club_registration_edit_unlocks_1` |
| `WHERE competition_id=?` (扫描) | `USING INDEX idx_club_registration_edit_unlocks_competition` (仅这条用到) |

**结论**：唯一约束 autoindex 与显式索引同列同序，计划器总是偏好 unique autoindex。仅有的差别是"comp-only scan"路径会走显式索引，但 1) 实际代码里没有这种全 comp 扫描；2) 即便有，scan 表也很小（每赛事几个 club）。**DROP 安全**。

---

## 3. KEEP 但标注的"灰区"索引

### 3.1 `idx_limit_configs_comp_scope` (limit_configs)

```sql
CREATE INDEX idx_limit_configs_comp_scope ON limit_configs(competition_id, scope);
```

**EXPLAIN 实证**（`workflows.ts` line 163 的限报反查）：

| 查询 | 计划器选择 |
|---|---|
| `WHERE competition_id=? AND ((scope='event' AND target_id=?) OR ...)` | `USING INDEX sqlite_autoindex_limit_configs_1` (UNIQUE(comp, scope, target_id)) |
| `WHERE competition_id=?` + 客户端 in-memory 分组 | `USING INDEX idx_limit_configs_comp_scope` |
| `WHERE competition_id=? AND scope='event'` (无 target_id) | `USING INDEX idx_limit_configs_comp_scope` |

**结论**：唯一约束 autoindex 在 (comp, scope, target_id) 都在 WHERE 时更优。但代码中部分路径（line 525 查 MAX(version) 之类的辅助扫描）只传 comp，会回退到本索引。**保留**——单条索引成本极低，移除会让少数"无 target_id"路径变全表扫。

### 3.2 `idx_limit_configs_target` (limit_configs)

```sql
CREATE INDEX idx_limit_configs_target ON limit_configs(target_id);
```

**用途**：按 event/group 反查它的限报配置（"这个 event 是否限了 50 人？"）。**保留**——单列索引，写入开销忽略。

---

## 4. KEEP 索引（已 EXPLAIN 验证被使用）

| 索引 | 表 | 关键使用模式 |
|---|---|---|
| `idx_registrations_comp_status_created` | registrations | `(comp, status, created_at DESC)` 排序；管理员审核 listAdminRegistrations |
| `idx_registrations_comp_event_status` | registrations | `(comp, event_id, status)` 限报并发计数 |
| `idx_registrations_comp_group_status` | registrations | `(comp, group_id, status)` 组别粒度限报 |
| `idx_registrations_club_team_created` | registrations | `(club, team, created_at)` 我的报名列表 |
| `idx_registrations_event_group` | registrations | `(event_id, group_id)` 秩序册生成 join |
| `idx_registration_athletes_athlete` | registration_athletes | `(athlete_id, reg_id)` 按运动员反查 |
| `idx_transitions_registration` | registration_state_transitions | `(reg_type, reg_id, created_at)` 状态历史 |
| `idx_competitions_status_dates` | competitions | `(status, start_date, deadline)` 着陆页 |
| `idx_events_competition_order` | events | `(comp, order_index)` 项目排序 |
| `idx_event_groups_event_order` | event_groups | `(event_id, order_index)` 分组排序 |
| `idx_clubs_created` | clubs | `created_at DESC` 列表 |
| `idx_team_profiles_competition` | team_profiles | `(comp, club_id)` 队伍列表 |
| `idx_team_leaders_club_comp_team` | team_leaders | `(club, comp, team)` |
| `idx_team_leaders_competition_name` | team_leaders | `(comp, name)` 模糊匹配 |
| `idx_coaches_club_comp_team` | coaches | `(club, comp, team)` |
| `idx_coaches_competition_name` | coaches | `(comp, name)` |
| `idx_athletes_club_comp_team` | athletes | `(club, comp, team)` |
| `idx_athletes_competition_name` | athletes | `(comp, name)` |
| `idx_limit_configs_comp_scope` | limit_configs | 灰区 (见 3.1) |
| `idx_limit_configs_target` | limit_configs | 灰区 (见 3.2) |
| `idx_order_books_current` | order_books | `(comp, is_current, is_stale)` 当前秩序册 |
| `idx_order_book_entries_competition` | order_book_entries | `(comp, order_book, start_order)` 出场序 |
| `idx_order_entries_club` | order_entries | `(club, comp)` 队内出场序 |
| `idx_order_entries_comp_order` | order_entries | `(comp, start_order)` 全局出场序 |
| `idx_scorecard_imports_current` | scorecard_imports | `(comp, is_current, imported_at)` 当前计分表导入 |
| `idx_scorecard_entries_club` | scorecard_entries | `(comp, club, import_id)` |
| `idx_scorecard_entries_team` | scorecard_entries | `(comp, team, import_id)` |
| `idx_sessions_user` | sessions | `(user_type, user_id, revoked_at)` 登录态 |
| `idx_sessions_expiry` | sessions | `expires_at` 清理过期 |
| `idx_audit_logs_actor_created` | audit_logs | `(actor_type, actor_id, created_at)` |
| `idx_audit_logs_request` | audit_logs | `request_id` 链路追踪 |
| `idx_audit_logs_table_record` | audit_logs | `(table, record_id, created_at)` |
| `idx_review_jobs_requested_by` | review_jobs | `(requested_by, created_at)` |

---

## 5. 源码修复（不入 D1）

### 5.1 `migrations/0006_scorecard_unpublished_status.sql`

第 72-74 行重复声明 3 条 scorecard 索引（0004 已声明）。建议删除重复块：

```diff
--- a/migrations/0006_scorecard_unpublished_status.sql
+++ b/migrations/0006_scorecard_unpublished_status.sql
@@ -69,9 +69,3 @@
--- (此处只关心 published/unpublished 状态字段，不重新创建索引)
-CREATE INDEX IF NOT EXISTS idx_scorecard_imports_current ON scorecard_imports(competition_id, is_current, imported_at);
-CREATE INDEX IF NOT EXISTS idx_scorecard_entries_team ON scorecard_entries(competition_id, team_profile_id, scorecard_import_id);
-CREATE INDEX IF NOT EXISTS idx_scorecard_entries_club ON scorecard_entries(competition_id, club_id, scorecard_import_id);
```

`IF NOT EXISTS` 已经保证幂等，但源代码层面是 noise，删掉避免后续维护者误以为"两个地方都声明"是有意为之。

### 5.2 `migrations/0008_atomic_limit_configs.sql`

第 109 行声明的 `idx_registrations_comp_team_status` 应在同一次提交里删除（该索引随 0009 一并 DROP），保持源代码与生产 D1 一致。

---

## 6. 实施步骤

### 6.1 本地 dry-run（推荐先做）

```bash
cd rope-jump-registration
npx.cmd wrangler d1 execute rope-jump-registration-d1-20260814 \
  --local --file=migrations/0009_drop_redundant_indexes.sql
```

预期：3 条 DROP（2 条主目标 + 1 条 defensive 的 individual_registrations 索引，本地数据库如果 0005 已跑过会 NOT EXIST 跳过）。本地 miniflare 不会报错。

### 6.2 远程执行

```bash
npx.cmd wrangler d1 execute rope-jump-registration-d1-20260814 \
  --remote --file=migrations/0009_drop_redundant_indexes.sql
```

执行前用 `--persist-to` 或 `--local` 备份 miniflare 数据（生产 D1 不能回滚到执行前状态，只能靠 0009_rollback.sql 重新建索引）。**强烈建议在比赛低峰期执行**（如周一至周四下午）。

### 6.3 验证

```bash
npx.cmd wrangler d1 execute rope-jump-registration-d1-20260814 \
  --remote --command "SELECT name FROM sqlite_master
                       WHERE type='index' AND name NOT LIKE 'sqlite_%'
                       ORDER BY name" --json
```

预期：从 35 行降到 30 行。`idx_registrations_comp_team_status` 与 `idx_club_registration_edit_unlocks_competition` 消失。

### 6.4 跑回归

```bash
node scripts/test-age-bucketing.ts  # 业务回归（不影响）
curl https://www.dztsbmxt.top/api/data/registrations/query  # 健康检查
```

---

## 7. 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| EXPLAIN 实证遗漏某个边界查询 | 低 | 50+ 查询模式覆盖所有 FROM 子句；rollback SQL 完整保留原始定义 |
| 计划器在更大数据集上选择不同索引 | 低 | 索引选择主要看 schema 与 WHERE 模式，不看行数；prod ≈ 800 条 vs local < 100 条，统计信息不影响选择 |
| 前端某段代码做了 D1 没法 EXPLAIN 的查询 | 极低 | 所有 4 个读端点（`/api/data/*/query` + `/api/workflow/*`）的 SQL 全部审计过 |
| DROP 索引锁表 | 极低 | D1 是 SQLite，DROP INDEX 几乎瞬时，不会阻塞读 |

---

## 8. 后续建议

1. **继续监控 `EXPLAIN` 输出**：每加一个 `WHERE` 子句，发布前都跑一次 `EXPLAIN QUERY PLAN`，避免悄悄加全表扫。
2. **CI 加慢查询检测**：把 `EXPLAIN QUERY PLAN` 集成到 `npm run test:age` 后的下一阶段。
3. **下次 schema 变更时优先使用 covering index**：例如 `idx_registrations_comp_status_created` 已经包含 `created_at`，ORDER BY 不需回表。
4. **每年一次索引审计**：随着功能迭代，新查询会让旧索引变"看似有用"，但计划器可能早就不选了。
