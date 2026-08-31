@echo off
REM WorkBuddy auto-commit-and-push wrapper for Windows cmd.
REM Calls autopush.sh via Git Bash. Tracked by the AI after every code change.
setlocal
set REPO_DIR=C:\Users\Administrator\WorkBuddy\2026-06-01-15-37-53\rope-jump-registration
set BASH="C:\Program Files\Git\bin\bash.exe"
if not exist %BASH% set BASH="C:\Program Files\Git\usr\bin\bash.exe"
if not exist %BASH% (
  echo [autopush] Git Bash not found at %BASH%
  exit /b 1
)
%BASH% "%REPO_DIR%\scripts\autopush.sh"
endlocal
