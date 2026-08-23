@echo off
setlocal
cd /d "%~dp0.."

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Update airsup"

rem Prefer git.cmd — avoids MSYS fork-bomb on rapid git.exe spawns in batch files
set "GIT=git"
if exist "C:\Program Files\Git\cmd\git.cmd" set "GIT=C:\Program Files\Git\cmd\git.cmd"

echo.
echo === Airsup deploy ===
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git not found.
  exit /b 1
)

if not exist .git (
  echo [ERROR] No git repo. Run scripts\setup.bat first.
  exit /b 1
)

"%GIT%" add -A
timeout /t 1 /nobreak >nul 2>nul

"%GIT%" diff --cached --quiet
if errorlevel 1 (
  echo Committing: %MSG%
  "%GIT%" commit -m "%MSG%"
  timeout /t 1 /nobreak >nul 2>nul
) else (
  echo Nothing new to commit.
)

rem Check remote via config — do not call "git remote get-url" (fork-bomb prone here)
findstr /r /c:"\[remote \"origin\"\]" .git\config >nul 2>&1
if errorlevel 1 (
  echo.
  echo [WARN] No git remote named "origin" in .git\config
  echo.
  echo   git remote add origin https://github.com/tadeus123/airsup2.git
  echo   git push -u origin main
  echo.
  echo Or: npx vercel --prod
  echo.
  exit /b 1
)

for /f "tokens=2 delims== " %%u in ('findstr /i "url = " .git\config ^| findstr /i "github"') do (
  echo Remote: %%u
)

echo Pushing to origin...
"%GIT%" push -u origin HEAD
if errorlevel 1 exit /b 1

echo.
echo === Push complete ===
echo Production: https://airsup2.vercel.app/
echo Portal:     https://airsup2.vercel.app/portal
echo.
exit /b 0
