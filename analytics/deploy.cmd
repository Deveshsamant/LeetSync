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
goto finish

:create
echo ============================================================
echo  STEP 1 of 2 - create the database
echo.
echo  A browser opens for Cloudflare sign-in the first time.
echo  When this finishes, copy the database_id it prints into
echo  wrangler.toml, then run this script again.
echo ============================================================
echo.
npx wrangler d1 create leetsync-analytics
echo.
echo ------------------------------------------------------------
echo  Now paste that database_id into wrangler.toml and re-run.
echo ------------------------------------------------------------
pause
exit /b 0

:finish
echo ============================================================
echo  STEP 2 of 2 - apply the schema and deploy
echo ============================================================
echo.
echo Applying schema...
npx wrangler d1 execute leetsync-analytics --remote --file=schema.sql
if errorlevel 1 goto failed
echo.
echo Deploying worker...
npx wrangler deploy
if errorlevel 1 goto failed
echo.
echo ------------------------------------------------------------
echo  Done. Copy the workers.dev URL printed above into
echo  ENDPOINT at the top of ..\analytics.js, then reload the
echo  extension. Reporting still stays off until a user opts in.
echo ------------------------------------------------------------
pause
exit /b 0

:failed
echo.
echo Something failed above. Nothing was left half-applied that a
echo re-run will not fix - this script is safe to run again.
pause
exit /b 1
