@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ---------------------------------------------------------------
REM  npx is deliberately not used here.
REM
REM  npx.cmd resolves node as "%~dp0\node.exe" and falls back to a bare
REM  "node" when that is missing. On this machine npx also lives in
REM  %APPDATA%\npm, which has no node.exe beside it, so that fallback fires
REM  and cmd reports: '"node"' is not recognized.
REM
REM  Instead: find a node.exe that has npm beside it, and call both by full
REM  path. Nothing then depends on what is or is not on PATH.
REM ---------------------------------------------------------------

set "NODE_DIR="
if exist "%LOCALAPPDATA%\nodejs\node.exe"   set "NODE_DIR=%LOCALAPPDATA%\nodejs"
if not defined NODE_DIR if exist "%ProgramFiles%\nodejs\node.exe"      set "NODE_DIR=%ProgramFiles%\nodejs"
if not defined NODE_DIR if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles(x86)%\nodejs"
if not defined NODE_DIR (
  for /f "delims=" %%N in ('where node 2^>nul') do (
    if not defined NODE_DIR set "NODE_DIR=%%~dpN"
  )
)
if defined NODE_DIR if "!NODE_DIR:~-1!"=="\" set "NODE_DIR=!NODE_DIR:~0,-1!"

if not defined NODE_DIR (
  echo Could not find node.exe.
  echo Looked in "%LOCALAPPDATA%\nodejs", "%ProgramFiles%\nodejs", and on PATH.
  pause
  exit /b 1
)

set "NODE=%NODE_DIR%\node.exe"
set "NPM=%NODE_DIR%\npm.cmd"
set "WRANGLER=%~dp0..\node_modules\wrangler\bin\wrangler.js"

echo Using node: %NODE%
"%NODE%" --version
echo.

if not exist "%WRANGLER%" (
  echo Installing wrangler locally, one time...
  pushd "%~dp0.."
  call "%NPM%" install --no-fund --no-audit --save-dev wrangler
  popd
  echo.
)
if not exist "%WRANGLER%" (
  echo wrangler still missing after install - check the npm output above.
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
echo  When it finishes, copy the database_id it prints into
echo  wrangler.toml, then run this script again.
echo ============================================================
echo.
"%NODE%" "%WRANGLER%" d1 create leetsync-analytics
echo.
echo ------------------------------------------------------------
echo  Paste that database_id into wrangler.toml, then re-run.
echo ------------------------------------------------------------
pause
exit /b 0

:finish
echo ============================================================
echo  STEP 2 of 2 - apply the schema and deploy
echo ============================================================
echo.
echo Applying schema...
"%NODE%" "%WRANGLER%" d1 execute leetsync-analytics --remote --file=schema.sql
if errorlevel 1 goto failed
echo.
echo Deploying worker...
"%NODE%" "%WRANGLER%" deploy
if errorlevel 1 goto failed
echo.
echo ------------------------------------------------------------
echo  Done. Copy the workers.dev URL printed above into ENDPOINT
echo  at the top of ..\analytics.js, then reload the extension.
echo  Reporting stays off until a user opts in.
echo ------------------------------------------------------------
pause
exit /b 0

:failed
echo.
echo Something failed above. Nothing is left half-applied that a
echo re-run will not fix - this script is safe to run again.
pause
exit /b 1
