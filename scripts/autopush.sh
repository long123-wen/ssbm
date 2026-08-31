#!/usr/bin/env bash
# WorkBuddy auto-commit-and-push wrapper.
# Triggered by AI after every code change. Safe to re-run (idempotent).
#
# Flow:
#   1. Bail if working tree is clean.
#   2. Stage using `git add -A` but feed it a *deny-list* of scratch patterns
#      (the same rules .gitignore would use). This means we keep the
#      convenience of "stage everything" while still skipping *.log, *.d1-*.json, etc.
#   3. Bail again if nothing made it past the deny-list.
#   4. Build a Conventional Commit style message from the staged paths.
#   5. Commit locally. If push fails (sandbox blocks 443), the commit still
#      lives locally and the script prints a one-line hint to push from
#      a real terminal.
set -euo pipefail

REPO_DIR="C:\Users\Administrator\WorkBuddy\2026-06-01-15-37-53\rope-jump-registration"
cd "$REPO_DIR" || exit 1

# ---------- 1. Early-out ----------
if git diff --quiet \
   && git diff --cached --quiet \
   && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "[autopush] no changes, skip"
  exit 0
fi

# ---------- 2. Stage with deny-list ----------
# Patterns to skip. Match the same things your .gitignore would:
#   - D1 diagnostic dumps (.d1-*.json)
#   - log / tmp / swap / backup files
#   - editor cruft (*.swp, *~)
#   - node_modules stays ignored by .gitignore already
DENY_RE='(\.d1-[a-z0-9_-]+\.json$|\.log$|\.tmp$|\.swp$|~$|\.bak$|^scripts/\.d1-)'

# Use `git add` with explicit pathspecs from porcelain, filtering deny patterns.
STAGED_COUNT=0
while IFS= read -r line; do
  # porcelain v1: "XY path" (or "XY path -> newpath" for renames)
  path=$(echo "$line" | awk '{print $2}')
  # For renames with ` -> `, awk grabs the new name which is what we want to add.
  if echo "$path" | grep -Eq "$DENY_RE"; then
    continue
  fi
  git add -- "$path" 2>/dev/null && STAGED_COUNT=$((STAGED_COUNT + 1))
done < <(git status --porcelain)

# Also pick up modifications/deletions on tracked files (porcelain may not always include them).
git add -u 2>/dev/null || true

# ---------- 3. Bail if nothing staged ----------
if git diff --cached --quiet; then
  echo "[autopush] nothing to commit after deny-list filtering"
  exit 0
fi

# ---------- 4. Build Conventional Commit message ----------
STAGED=$(git diff --cached --name-only | head -10)
COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
SCOPE_HINT=$(echo "$STAGED" | awk -F/ '{print $1}' | sort -u | head -1)
case "$SCOPE_HINT" in
  src|public) TYPE="feat" ;;
  functions) TYPE="fix" ;;
  scripts)   TYPE="chore" ;;
  docs|*.md) TYPE="docs" ;;
  .github)   TYPE="ci" ;;
  package*.json|tsconfig*) TYPE="build" ;;
  *)         TYPE="chore" ;;
esac
SCOPE="${SCOPE_HINT:-repo}"
MSG="${TYPE}(${SCOPE}): WorkBuddy auto-update ${COUNT} file(s)"
echo "[autopush] commit message: $MSG"

# ---------- 5. Commit ----------
git commit -m "$MSG" --no-verify || { echo "[autopush] commit failed"; exit 1; }

# ---------- 6. Push ----------
echo "[autopush] pushing to origin/main ..."
if git push origin main 2>&1; then
  echo "[autopush] OK, remote synced"
  exit 0
fi
PUSH_RC=$?
echo "[autopush] push failed (rc=$PUSH_RC). Likely sandbox blocks github.com:443."
echo "[autopush] Local commit saved as $(git rev-parse --short HEAD)."
echo "[autopush] NEXT: open a local terminal in $REPO_DIR and run 'git push origin main' to sync."
exit 0
