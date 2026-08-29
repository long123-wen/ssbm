#!/usr/bin/env bash
# Push rope-jump-registration to GitHub with auto-retry.
# Usage: run this in Git Bash, or double-click push-to-github.bat
#        (which invokes this file via PortableGit's bash.exe).

set -u

cd "$(dirname "$0")"

echo "=== Push rope-jump-registration to GitHub ==="
echo "Repo:   https://github.com/long123-wen/ssbm.git"
echo "Branch: main (force)"
echo
echo "Auto-retrying every 10s until success (max 40 tries)."
echo "If a GitHub login window appears, please log in - it is a one-time step."
echo

MAX=40
SLEEP=10
i=0

while [ $i -lt $MAX ]; do
  i=$((i + 1))
  echo "--- Attempt $i / $MAX ---"
  git push -f origin main
  rc=$?
  if [ $rc -eq 0 ]; then
    echo
    echo "============================================================"
    echo "  Pushed successfully on attempt $i"
    echo "============================================================"
    echo "Next: open https://github.com/long123-wen/ssbm/actions"
    echo "      The 'age-bucketing 测试' workflow should turn green."
    exit 0
  fi
  echo "[Attempt $i] Failed (exit=$rc). Retrying in ${SLEEP}s..."
  echo
  sleep $SLEEP
done

echo
echo "============================================================"
echo "  Gave up after $MAX attempts."
echo "============================================================"
echo "Common causes:"
echo "  1) Auth failed - use a Personal Access Token (need 'repo' scope)"
echo "  2) Network/DNS - check proxy / VPN"
echo "  3) Remote main has commits we can't fast-forward (we used -f, so this is unlikely)"
exit 1
