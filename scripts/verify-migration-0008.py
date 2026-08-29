"""Validate migrations 0001..0008 + trigger behavior on a temp SQLite database."""
import glob
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MIGRATIONS = os.path.join(ROOT, "migrations")

ORDER = [
    "0001_initial_schema.sql",
    "0002_workflow_hardening.sql",
    "0003_admin_registration_edit_unlocks.sql",
    "0004_scorecard_snapshots.sql",
    "0005_drop_individual_registrations.sql",
    "0006_scorecard_unpublished_status.sql",
    "0007_unify_limits_to_limit_configs.sql",
    "0008_atomic_limit_configs.sql",
]

def run():
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")
    for name in ORDER:
        path = os.path.join(MIGRATIONS, name)
        with open(path, "r", encoding="utf-8") as fh:
            sql = fh.read()
        try:
            conn.executescript(sql)
            conn.commit()
            print(f"OK  {name}")
        except sqlite3.Error as exc:
            print(f"FAIL {name}: {exc}")
            conn.close()
            sys.exit(1)

    cur = conn.cursor()

    # ---- seed data ----
    cur.execute(
        "INSERT INTO competitions (id,name,venue,start_date,end_date,registration_deadline,status)"
        " VALUES ('c1','T','v','2026-09-01','2026-09-02','2026-08-31','open')"
    )
    cur.execute(
        "INSERT INTO events (id,competition_id,name,code,category,max_athletes,is_individual)"
        " VALUES ('e1','c1','30s','SR','x',1,1)"
    )
    cur.execute(
        "INSERT INTO event_groups (id,event_id,name,type) VALUES ('g1','e1','G','age')"
    )
    cur.execute(
        "INSERT INTO clubs (id,username,password_hash,club_name,contact_name,phone,is_approved)"
        " VALUES ('clubA','a','x','A','c','13800000000',1)"
    )
    cur.execute(
        "INSERT INTO clubs (id,username,password_hash,club_name,contact_name,phone,is_approved)"
        " VALUES ('clubB','b','x','B','c','13900000000',1)"
    )
    # team limit config: max 2 registrations for clubA
    cur.execute(
        "INSERT INTO limit_configs (id,competition_id,scope,target_id,max_registrations)"
        " VALUES ('lc1','c1','team','clubA',2)"
    )
    # group limit config: max 1 for g1
    cur.execute(
        "INSERT INTO limit_configs (id,competition_id,scope,target_id,max_registrations)"
        " VALUES ('lc2','c1','group','g1',1)"
    )
    conn.commit()

    def insert_reg(reg_id, club_id, status="confirmed", group_id="g1"):
        cur.execute(
            "INSERT INTO registrations (id,competition_id,club_id,club_name,event_id,event_name,group_id,group_name,athletes,status)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (reg_id, "c1", club_id, "X", "e1", "30s", group_id, "G", "[]", status),
        )

    # 1) first registration OK
    insert_reg("r1", "clubA"); conn.commit(); print("OK  insert r1 within group+team limits")
    # 2) second registration: group limit 1 exceeded -> must abort
    try:
        insert_reg("r2", "clubA"); conn.commit()
        print("FAIL group limit NOT enforced")
        sys.exit(1)
    except sqlite3.IntegrityError as exc:
        assert "LIMIT_CONFIGS_QUOTA_EXCEEDED" in str(exc), exc
        conn.rollback(); print("OK  group limit enforced on insert")
    # 3) release group quota: put r1 into another group g2 (no limit)
    cur.execute("INSERT INTO event_groups (id,event_id,name,type) VALUES ('g2','e1','G2','age')")
    cur.execute("UPDATE registrations SET group_id='g2' WHERE id='r1'"); conn.commit()
    # now group g1 free again -> r2 OK (team limit 2 still allows)
    insert_reg("r2", "clubA"); conn.commit(); print("OK  insert r2 after group freed")
    # 4) team limit 2: third registration for clubA must abort
    try:
        insert_reg("r3", "clubA"); conn.commit()
        print("FAIL team limit NOT enforced")
        sys.exit(1)
    except sqlite3.IntegrityError as exc:
        assert "LIMIT_CONFIGS_QUOTA_EXCEEDED" in str(exc), exc
        conn.rollback(); print("OK  team limit enforced on insert")
    # 5) clubB unlimited at team dimension (team target clubB has no config) -> OK in g2
    insert_reg("r4", "clubB", group_id="g2"); conn.commit(); print("OK  clubB unaffected")
    # 6) rejected registration does not consume quota
    insert_reg("r5", "clubB", status="rejected", group_id="g2"); conn.commit(); print("OK  rejected insert allowed")
    # 7) activating rejected hits team limit? clubB team target has no config -> allowed
    cur.execute("UPDATE registrations SET status='confirmed' WHERE id='r5'"); conn.commit()
    print("OK  activation allowed for unlimited team")
    # 7b) group-limit activation check: rejected row in g1 (limit 1, used by r2) -> abort
    cur.execute("INSERT INTO event_groups (id,event_id,name,type) VALUES ('g3','e1','G3','age')")
    insert_reg("r8", "clubB", status="rejected", group_id="g3"); conn.commit()
    cur.execute("INSERT INTO limit_configs (id,competition_id,scope,target_id,max_registrations) VALUES ('lc3','c1','group','g3',1)")
    insert_reg("r9", "clubB", group_id="g3"); conn.commit()  # fills g3 (clubB has no team limit)
    try:
        cur.execute("UPDATE registrations SET status='confirmed' WHERE id='r8'"); conn.commit()
        print("FAIL activate group limit NOT enforced"); sys.exit(1)
    except sqlite3.IntegrityError as exc:
        assert "LIMIT_CONFIGS_QUOTA_EXCEEDED" in str(exc), exc
        conn.rollback(); print("OK  group limit enforced on activation")
    # 8) delete frees team quota for clubA (team limit now 5 via lc1 update below)
    cur.execute("DELETE FROM registrations WHERE id='r2'"); conn.commit()
    insert_reg("r6", "clubA", group_id="g2"); conn.commit(); print("OK  delete frees quota")
    # 9) raising limit config allows more (clubA team currently: r1,r6 = 2, limit 5)
    cur.execute("UPDATE limit_configs SET max_registrations=5 WHERE id='lc1'"); conn.commit()
    insert_reg("r7", "clubA", group_id="g2"); conn.commit(); print("OK  raised team limit allows insert")

    cur.execute("SELECT current_count FROM event_groups WHERE id='g2'")
    print(f"INFO g2 current_count = {cur.fetchone()[0]}")

    conn.close()
    print("ALL TRIGGER CHECKS PASSED")

run()
