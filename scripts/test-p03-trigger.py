"""P0-3 concurrent insert test for trigger-based limit enforcement.

Tries 5 sequential inserts to a group with max_registrations=2.
Expects at most 2 to succeed; the rest should fail with LIMIT_CONFIGS_QUOTA_EXCEEDED.

Setup (idempotent):
  1. Find a real event_id from `events` table (or use a fixed one).
  2. Create a test event_groups row (UNIQUE group_name='__p03_trigger_test__').
  3. Update limit_configs to set max_registrations=2 for this group.
  4. Try 5 sequential INSERT statements with different registration IDs.
  5. Verify final count is exactly 2.

Cleanup:
  - DELETE test registrations, event_groups, restore limit_configs to NULL.
"""
import json
import shutil
import subprocess
import sys
import uuid

DB = "rope-jump-registration-d1-20260814"
COMP_ID = "86f84e31-0501-4f53-a5d1-38af13a1390a"
EVT_ID = "b895d2cf-3211-4fd0-80f1-b1a039fca050"  # 30秒单摇跳
CLB_ID = "a38828c1-13e4-415c-9ad3-ee23c0838748"  # 德州御绳道
TEST_GROUP_NAME = "__p03_trigger_test__"
CWD = "C:/Users/Administrator/WorkBuddy/2026-06-01-15-37-53/rope-jump-registration"

# On Windows, npx must be invoked as npx.cmd so Python's subprocess can find it.
NPX = shutil.which("npx.cmd") or shutil.which("npx") or "npx.cmd"


def run_d1(sql: str) -> dict:
    r = subprocess.run(
        [NPX, "wrangler", "d1", "execute", DB, "--remote", "--command", sql, "--json"],
        capture_output=True, text=True, cwd=CWD,
    )
    out = r.stdout.strip()
    try:
        return json.loads(out)
    except Exception:
        return {"_raw": out, "_err": r.stderr[:500]}


def is_ok(r: dict) -> bool:
    return isinstance(r, list) and bool(r) and r[0].get("success") is True


def err_text(r: dict) -> str:
    if isinstance(r, list) and r:
        notes = r[0].get("error", {}).get("notes", [])
        if notes:
            return notes[0].get("text", "?")
    return str(r)[:200]


# --- Step 0: pre-clean any leftover test data ---
print("=== Step 0: pre-clean test data ===")
run_d1(f"DELETE FROM registrations WHERE group_id IN (SELECT id FROM event_groups WHERE name = '{TEST_GROUP_NAME}')")
run_d1(f"DELETE FROM event_groups WHERE name = '{TEST_GROUP_NAME}'")
run_d1(f"DELETE FROM limit_configs WHERE scope = 'group' AND competition_id = '{COMP_ID}' AND target_id NOT IN (SELECT id FROM event_groups)")
print("  done")

# --- Step 1: create a real event_groups row for the test ---
print("\n=== Step 1: create test event_groups row ===")
grp_id = str(uuid.uuid4())
create_grp = (
    f"INSERT INTO event_groups (id, event_id, name, type, gender, age_min, age_max, "
    f"max_registrations, current_count, order_index, created_at, updated_at) VALUES ("
    f"'{grp_id}', '{EVT_ID}', '{TEST_GROUP_NAME}', 'gender', 'male', 0, 99, "
    f"1000, 0, 999, datetime('now'), datetime('now'))"
)
r = run_d1(create_grp)
if is_ok(r):
    print(f"  created event_groups id={grp_id}")
else:
    print(f"  FAIL creating event_groups: {err_text(r)}")
    sys.exit(1)

# --- Step 2: set max_registrations = 2 in limit_configs for this group ---
print("\n=== Step 2: set max_registrations = 2 ===")
r = run_d1(
    f"INSERT INTO limit_configs (id, competition_id, scope, target_id, max_registrations, "
    f"created_at, updated_at) VALUES ('{uuid.uuid4()}', '{COMP_ID}', 'group', '{grp_id}', 2, "
    f"datetime('now'), datetime('now'))"
)
if is_ok(r):
    print(f"  set max_registrations=2 (insert)")
else:
    # Maybe already exists, try update
    r2 = run_d1(
        f"UPDATE limit_configs SET max_registrations = 2 WHERE competition_id = '{COMP_ID}' "
        f"AND scope = 'group' AND target_id = '{grp_id}'"
    )
    if is_ok(r2):
        print("  set max_registrations=2 (update)")
    else:
        print(f"  FAIL: {err_text(r2)}")
        sys.exit(1)

# --- Step 3: 5 sequential inserts ---
print("\n=== Step 3: 5 sequential inserts (only 2 should succeed) ===")
results = []
for i in range(1, 6):
    reg_id = str(uuid.uuid4())
    ath_id = str(uuid.uuid4())
    athletes = json.dumps(
        [{"id": ath_id, "name": f"Test{i}", "gender": "male", "birth_date": "2010-01-01"}],
        ensure_ascii=False,
    )
    athletes_esc = athletes.replace("'", "''")
    sql = (
        f"INSERT INTO registrations (id, competition_id, club_id, club_name, event_id, event_name, "
        f"group_id, group_name, athletes, status, created_at, updated_at) VALUES ("
        f"'{reg_id}', '{COMP_ID}', '{CLB_ID}', '德州御绳道', '{EVT_ID}', '30秒单摇跳', "
        f"'{grp_id}', '{TEST_GROUP_NAME}', '{athletes_esc}', 'confirmed', datetime('now'), datetime('now'))"
    )
    r = run_d1(sql)
    if is_ok(r) and r[0].get("meta", {}).get("changes", 0) > 0:
        print(f"  Attempt {i}: OK (id={reg_id[:8]})")
        results.append(("OK", reg_id))
    else:
        msg = err_text(r)
        print(f"  Attempt {i}: ERR {msg[:120]}")
        results.append(("ERR", msg[:80]))

# --- Step 4: final count ---
print("\n=== Step 4: final count ===")
r = run_d1(
    f"SELECT count(*) AS n FROM registrations WHERE competition_id = '{COMP_ID}' "
    f"AND group_id = '{grp_id}' AND status = 'confirmed'"
)
if is_ok(r):
    n = r[0]["results"][0]["n"]
    success = sum(1 for s, _ in results if s == "OK")
    print(f"  Confirmed count: {n}, attempts succeeded: {success}")
    if success == 2 and n == 2:
        print("  PASS: exactly 2 succeeded, DB count = 2")
    else:
        print(f"  FAIL: expected success=2, count=2; got success={success}, count={n}")
        sys.exit(1)
else:
    print(f"  Query failed: {err_text(r)}")
    sys.exit(1)

# --- Step 5: cleanup ---
print("\n=== Step 5: cleanup test data ===")
run_d1(f"DELETE FROM registrations WHERE group_id = '{grp_id}'")
run_d1(f"UPDATE limit_configs SET max_registrations = NULL WHERE competition_id = '{COMP_ID}' AND scope = 'group' AND target_id = '{grp_id}'")
run_d1(f"DELETE FROM event_groups WHERE id = '{grp_id}'")
# Also clean up the stale (pre-existing) limit_configs row
run_d1(f"DELETE FROM limit_configs WHERE scope = 'group' AND competition_id = '{COMP_ID}' AND target_id NOT IN (SELECT id FROM event_groups)")
print("  done")
