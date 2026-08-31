-- ============================================================
-- Migration 0006: scorecard_imports.status 增加 'unpublished' 状态
--
-- 触发原因：admin/registration 增加「取消发布」功能，要求
--           workflow 里 UPDATE scorecard_imports SET status='unpublished'
--           当前 CHECK 约束只允许 ('building','published','failed')，
--           不允许 'unpublished'，导致 CONSTRAINT_VIOLATION (HTTP 400)。
--
-- SQLite 不支持 ALTER TABLE DROP/ADD CONSTRAINT，必须重建表。
-- ============================================================
-- 与之配套的代码变更：
--   - functions/_shared/workflows.ts unpublishScorecardImport()
--     改为 UPDATE ... SET is_current=0, status='unpublished'
--   - functions/_shared/workflows.ts importScorecardOrderBook() reuse 分支
--     增加 .run()（之前漏写，UPDATE 静默失败）
--   - src/lib/store.ts scorecardStore.unpublish()
--     把 { method: 'DELETE' } 从 body 位移到 options 位
--   - src/sections/admin/AdminScorecards.tsx 加 AlertDialog 三态 UI
-- ============================================================

PRAGMA foreign_keys = OFF;

-- ========== 1. 备份当前数据 ==========
CREATE TABLE IF NOT EXISTS _tmp_scorecard_imports_bak AS SELECT * FROM scorecard_imports;
CREATE TABLE IF NOT EXISTS _tmp_scorecard_entries_bak AS SELECT * FROM scorecard_entries;

-- ========== 2. 删除旧表（先删子表）==========
DROP TABLE IF EXISTS scorecard_entries;
DROP TABLE IF EXISTS scorecard_imports;

-- ========== 3. 重建主表（含 'unpublished' 状态）==========
CREATE TABLE scorecard_imports (
  id TEXT PRIMARY KEY NOT NULL,
  competition_id TEXT NOT NULL,
  source_order_book_id TEXT NOT NULL,
  source_order_book_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('building','published','failed','unpublished')),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  entry_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE (competition_id, source_order_book_id),
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_order_book_id) REFERENCES order_books(id) ON DELETE RESTRICT
);

-- ========== 4. 重建子表 ==========
CREATE TABLE scorecard_entries (
  id TEXT PRIMARY KEY NOT NULL,
  scorecard_import_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  order_book_entry_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  team_profile_id TEXT,
  club_id TEXT NOT NULL,
  club_name TEXT NOT NULL,
  team_name TEXT,
  event_name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  session_label TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  venue_number INTEGER NOT NULL,
  athlete_names TEXT NOT NULL CHECK (json_valid(athlete_names)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (scorecard_import_id, order_book_entry_id),
  FOREIGN KEY (scorecard_import_id) REFERENCES scorecard_imports(id) ON DELETE CASCADE,
  FOREIGN KEY (order_book_entry_id) REFERENCES order_book_entries(id) ON DELETE RESTRICT
);

-- ========== 5. 重建索引 ==========
-- NOTE: scorecard 索引在 0004 末尾已创建，0006 不再重复声明（详见 docs/audits/2026-08-29-d1-index-audit.md §5.1）
-- 原有声明：
--   CREATE INDEX IF NOT EXISTS idx_scorecard_imports_current ON scorecard_imports(competition_id, is_current, imported_at);
--   CREATE INDEX IF NOT EXISTS idx_scorecard_entries_team    ON scorecard_entries(competition_id, team_profile_id, scorecard_import_id);
--   CREATE INDEX IF NOT EXISTS idx_scorecard_entries_club    ON scorecard_entries(competition_id, club_id, scorecard_import_id);

-- ========== 6. 重建触发器 ==========
CREATE TRIGGER IF NOT EXISTS trg_scorecard_imports_current_update
AFTER INSERT ON scorecard_imports
WHEN NEW.is_current = 1
BEGIN
  UPDATE scorecard_imports SET is_current = 0 WHERE competition_id = NEW.competition_id AND id <> NEW.id;
END;

-- ========== 7. 恢复数据 ==========
INSERT INTO scorecard_imports SELECT * FROM _tmp_scorecard_imports_bak;
INSERT INTO scorecard_entries SELECT * FROM _tmp_scorecard_entries_bak;

DROP TABLE _tmp_scorecard_imports_bak;
DROP TABLE _tmp_scorecard_entries_bak;

PRAGMA foreign_keys = ON;