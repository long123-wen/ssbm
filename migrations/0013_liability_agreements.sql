-- 0013: 赛事自愿参赛安全承诺责任书签署记录
-- 队伍级签署：每个队伍在同一赛事下只需签署一次，签署后方可提交报名。
-- club 只能读写自己的记录（ownerColumn=club_id），admin 可读全部。
-- 一队一签：UNIQUE(competition_id, team_profile_id)。
CREATE TABLE IF NOT EXISTS liability_agreements (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  team_profile_id TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  signer_role TEXT NOT NULL,
  agreement_version TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (competition_id, team_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_liability_agreements_club ON liability_agreements(club_id);
CREATE INDEX IF NOT EXISTS idx_liability_agreements_comp ON liability_agreements(competition_id);
