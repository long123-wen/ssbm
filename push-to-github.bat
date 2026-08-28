@echo off
REM Push to GitHub with auto-retry (network is intermittent)
REM Usage: double-click this file, or run it from PowerShell/cmd
REM It will keep retrying every 10s until the push succeeds (max 40 tries).
REM First run may pop up a GitHub login window (Git Credential Manager) - log in once.

cd /d "%~dp0"

echo.
echo === Push rope-jump-registration to GitHub ===
echo Repo:   https://github.com/long123-wen/ssbm.git
echo Branch: main
echo.
echo Auto-retrying every 10s until success (max 40 tries).
echo If a GitHub login window appears, please log in - it is a one-time step.
echo.

set RETRY=0

:LOOP
git push -f origin main
if %ERRORLEVEL% EQU 0 goto SUCCESS

set /a RETRY+=1
echo.
echo [Attempt %RETRY%] Failed. Retrying in 10s... (network hiccup, will keep trying)
echo.
timeout /t 10 /nobreak >nul

if %RETRY% GEQ 40 goto FAILED
goto LOOP

:SUCCESS
echo.
echo ==========================================
echo   PUSH SUCCESSFUL
echo   https://github.com/long123-wen/ssbm
echo ==========================================
echo.
pause
exit /b 0

:FAILED
echo.
echo Gave up after 40 attempts.
echo Please check your network (or try a VPN / phone hotspot), then run this file again.
echo.
pause
exit /b 1
