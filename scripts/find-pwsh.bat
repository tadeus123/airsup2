@echo off
rem Shared helper: find pwsh.exe and set PWSH + PWSH_DIR
set "PWSH="
set "PWSH_DIR="

for %%p in (
  "%ProgramFiles%\PowerShell\7\pwsh.exe"
  "%LOCALAPPDATA%\Microsoft\WindowsApps\Microsoft.PowerShell_8wekyb3d8bbwe\pwsh.exe"
  "%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
) do (
  if exist %%p (
    set "PWSH=%%~p"
    set "PWSH_DIR=%%~dp"
    goto :found
  )
)

for /f "delims=" %%p in ('where pwsh 2^>nul') do (
  if not defined PWSH (
    set "PWSH=%%p"
    set "PWSH_DIR=%%~dp"
  )
)

:found
