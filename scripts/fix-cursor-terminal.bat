@echo off
setlocal EnableDelayedExpansion
call "%~dp0find-pwsh.bat"

echo.
echo === Fix Cursor Agent Terminal (Windows) ===
echo.

if not defined PWSH (
  echo [1/2] Installing PowerShell 7 via winget...
  winget install --id Microsoft.PowerShell --source winget --accept-package-agreements --accept-source-agreements
  timeout /t 5 /nobreak >nul
  call "%~dp0find-pwsh.bat"
)

if not defined PWSH (
  echo [ERROR] pwsh.exe still not found.
  echo In cmd run:  where pwsh
  pause
  exit /b 1
)

echo [OK] PowerShell 7: !PWSH!
"!PWSH!" -NoProfile -Command "$PSVersionTable.PSVersion"

echo.
echo [2/2] Cursor settings should point to pwsh (see fix-path-for-cursor.bat next).
echo.
echo === NEXT ===
echo 1. Run:  fix-path-for-cursor.bat
echo 2. Quit Cursor fully
echo 3. New cmd:  launch-cursor.bat
echo.
pause
exit /b 0
