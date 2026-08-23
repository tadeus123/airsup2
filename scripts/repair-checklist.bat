@echo off
echo.
echo === Airsup / Cursor repair checklist ===
echo Run each section in order. Some steps need Administrator cmd.
echo.

echo --- STEP 1: Repair Windows (Admin cmd) ---
echo   sfc /scannow
echo   DISM /Online /Cleanup-Image /RestoreHealth
echo   (Restart PC after this)
echo.

echo --- STEP 2: Reinstall Git (normal cmd) ---
echo   winget uninstall Git.Git
echo   winget install Git.Git
echo.

echo --- STEP 3: Reinstall PowerShell 7 MSI, not Store (normal cmd) ---
echo   winget uninstall Microsoft.PowerShell
echo   winget install Microsoft.PowerShell --source winget
echo   where pwsh
echo   (Should show C:\Program Files\PowerShell\7\pwsh.exe)
echo.

echo --- STEP 4: Fix PATH (in this project) ---
echo   cd /d "d:\cursor Projects\airsup"
echo   fix-path-for-cursor.bat
echo.

echo --- STEP 5: Restart Cursor ---
echo   Quit Cursor fully (File - Exit)
echo   launch-cursor.bat
echo.

echo --- STEP 6: Sync project ---
echo   cd /d "d:\cursor Projects\airsup"
echo   git pull origin main
echo   setup.bat
echo.

echo --- OPTIONAL: Reinstall Cursor if agent still broken ---
echo   winget uninstall Cursor.Cursor
echo   winget install Cursor.Cursor
echo   (Then run launch-cursor.bat again)
echo.
pause
