@echo off
call "%~dp0find-pwsh.bat"

set "CURSOR=%LOCALAPPDATA%\Programs\cursor\Cursor.exe"
if not exist "%CURSOR%" set "CURSOR=%LOCALAPPDATA%\Cursor\Cursor.exe"
if not exist "%CURSOR%" (
  echo Cursor.exe not found.
  pause
  exit /b 1
)

if defined PWSH_DIR set "PATH=%PWSH_DIR%;%PATH%"
start "" "%CURSOR%" "%~dp0.."
exit /b 0
