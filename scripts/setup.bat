@echo off
setlocal
cd /d "%~dp0.."

echo.
echo === Airsup setup ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from https://nodejs.org
  exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git not found. Install from https://git-scm.com/download/win
  exit /b 1
)

echo [1/4] Installing npm dependencies...
call npm install
if errorlevel 1 exit /b 1

if not exist .env.local (
  if exist .env.example (
    echo [2/4] Creating .env.local from .env.example...
    copy /y .env.example .env.local >nul
    echo        Edit .env.local with your Supabase and Orgo keys.
  ) else (
    echo [2/4] Skipping .env.local — no .env.example found.
  )
) else (
  echo [2/4] .env.local already exists.
)

if not exist .git (
  echo [3/4] Initializing git repository...
  git init -b main
) else (
  echo [3/4] Git repository already initialized.
)

echo [4/4] Running typecheck...
call npm run typecheck
if errorlevel 1 exit /b 1

echo.
echo === Setup complete ===
echo.
echo   Dev server:  npm run dev
echo   Portal page: http://localhost:3000/portal
echo   Deploy:      scripts\deploy.bat
echo.
exit /b 0
