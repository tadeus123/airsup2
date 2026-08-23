@echo off
call "%~dp0scripts\deploy.bat" %*
if errorlevel 1 pause
