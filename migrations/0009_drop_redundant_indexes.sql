-- Migration 0009: Drop redundant indexes identified by EXPLAIN-based audit
-- Date: 2026-08-29
-- Audit: docs/audits/2026-08-29-d1-index-audit.md
--
-- Findings summary (see audit report for full EXPLAIN evidence):
--   DROP candidates (planner never prefers them in observed query patterns):
--     - idx_registrations_comp_team_status
--         Defined as (competition_id, team_profile_id, club_id, status).
--         For real query "WHERE club_id=? AND competition_id=?" the planner
--         prefers idx_registrations_club_team_created via club_id leading prefix.
--         For "WHERE competition_id=? AND team_profile_id=?" the planner falls
--         back to idx_registrations_comp_status_created (status has more
--         selectivity within a competition than team_profile_id).
--     - idx_club_registration_edit_unlocks_competition
--         Defined as (competition_id, club_id, team_scope) — exact same columns
--         covered by the UNIQUE constraint autoindex
--         sqlite_autoindex_club_registration_edit_unlocks_1. Planner always
--         picks the unique autoindex for the real WHERE patterns.
--   Borderline (KEEP, but with notes):
--     - idx_limit_configs_comp_scope : planner prefers unique autoindex when
--         target_id is in WHERE; this index only helps for comp-only or
--         comp+scope-without-target scans (rare). KEEP — fallback value > cost.
--     - idx_limit_configs_target : single-column index on target_id. Used by
--         occasional "find limit config for this event/group" lookups.
--         KEEP — narrow + cheap.
--
-- Source-level cleanup (separate from D1, applied in same commit):
--   - Remove duplicate CREATE INDEX for 3 scorecard indexes from
--     migrations/0006_scorecard_unpublished_status.sql (already declared in
--     0004). D1 has only one copy thanks to IF NOT EXISTS, but the source
--     is cosmetically wrong.
--   - 0008 line 109 idx_registrations_comp_team_status: REMOVE from source
--     since the migration is being split into forward (DROP) + rollback (re-create).

-- ============================================================================
-- FORWARD MIGRATION
-- ============================================================================

-- 1. Drop the team status index that the planner never picks.
DROP INDEX IF EXISTS idx_registrations_comp_team_status;

-- 2. Drop the duplicate club_registration_edit_unlocks index; the unique
--    constraint autoindex on (competition_id, club_id, team_scope) already
--    covers every query pattern that uses this table.
DROP INDEX IF EXISTS idx_club_registration_edit_unlocks_competition;

-- 3. Defensive: drop the 3 individual_registrations indexes that 0005 should
--    have removed but might still be present on stale environments. Idempotent.
DROP INDEX IF EXISTS idx_individual_reg_comp_status_created;
DROP INDEX IF EXISTS idx_individual_reg_phone_created;
DROP INDEX IF EXISTS idx_individual_registration_events_group;
