@echo off
REM Push to GitHub via PortableGit's bash.exe.
REM This .bat exists so double-clicking still works from a plain cmd window.
REM The real logic lives in push-to-github.sh (runs in Git Bash, where 'git' is on PATH).

setlocal

set BASH_EXE=C:\Users\Administrator\.workbuddy\binaries\PortableGit\versions\1.2.0\bin\bash.exe

if not exist "%BASH_EXE%" (
  echo ERROR: bash.exe not found at:
  echo   %BASH_EXE%
  echo.
  echo Falling back: trying to find git on PATH...
  where git >nul 2>nul
  if errorlevel 1 (
    echo git is also not on PATH. Please install Git for Windows or use Git Bash directly.
    pause
    exit /b 1
  )
  echo Found git. Running push directly with cmd's PATH...
  cd /d "%~dp0"
  git push -f origin main
  exit /b %ERRORLEVEL%
)

cd /d "%~dp0"

echo ============================================================
echo  Launching Git Bash to push rope-jump-registration
echo  bash: %BASH_EXE%
echo  script: %~dp0push-to-github.sh
echo ============================================================
echo.

"%BASH_EXE%" "%~dp0push-to-github.sh"
set RC=%ERRORLEVEL%

echo.
echo ============================================================
if %RC% EQU 0 (
  echo   PUSH SUCCESSFUL
  echo   https://github.com/long123-wen/ssbm
) else (
  echo   push-to-github.sh exited with code %RC%
  echo   See the output above for the failure reason.
)
echo ============================================================
echo.
pause
endlocal
