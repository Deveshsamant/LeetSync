@echo off
setlocal
cd /d "%~dp0"

REM Node is installed but not on the cmd.exe PATH on this machine, so add it
REM here rather than asking anyone to remember where it lives.
set "PATH=%LOCALAPPDATA%\nodejs;%APPDATA%\npm;%PATH%"

where npx >nul 2>&1
if errorlevel 1 (
  echo Could not find npx even after adding Node to PATH.
  echo Looked in "%LOCALAPPDATA%\nodejs" and "%APPDATA%\npm".
  pause
  exit /b 1
)

findstr /C:"REPLACE_WITH_YOUR_D1_DATABASE_ID" wrangler.toml >nul
if %errorlevel%==0 goto create
echo NPX RESOLVED: & where npx
exit /b 0
