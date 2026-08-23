@echo off
setlocal EnableDelayedExpansion
call "%~dp0find-pwsh.bat"

echo.
echo === Put PowerShell 7 first in PATH (for Cursor Agent) ===
echo.

if not defined PWSH (
  echo [ERROR] pwsh.exe not found.
  echo Run:  fix-cursor-terminal.bat
  pause
  exit /b 1
)

echo [OK] Found: !PWSH!
echo.

for /f "tokens=2,*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USERPATH=%%b"

rem Remove old pwsh entries, prepend the directory we found
set "USERPATH=!USERPATH:!PWSH_DIR;=!"
if /i not "!USERPATH:~0,1!"=="" (
  if /i not "!USERPATH:~0,100!"=="!PWSH_DIR:~0,100!" (
    set "USERPATH=!PWSH_DIR!!USERPATH!"
  )
) else (
  set "USERPATH=!PWSH_DIR!"
)

reg add "HKCU\Environment" /v Path /t REG_EXPAND_SZ /d "!USERPATH!" /f >nul
echo [OK] User PATH updated.

set "PATH=!PWSH_DIR!;%PATH%"

echo.
where pwsh
echo.
echo === NEXT ===
echo 1. Quit Cursor fully
echo 2. New cmd window:  launch-cursor.bat
echo.
pause
exit /b 0
