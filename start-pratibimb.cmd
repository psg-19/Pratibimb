@echo off
setlocal
cd /d "%~dp0"

rem Use a project-local Node.js in .tools if there is one, otherwise the Node.js on PATH.
for /d %%D in ("%~dp0.tools\node-v22*") do set "PATH=%%~fD;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 LTS from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules\.bin\vite.cmd" (
  echo Installing dependencies, this only happens once...
  call npm.cmd ci
  if errorlevel 1 (
    echo Could not install dependencies. See docs\WINDOWS_SETUP.md.
    pause
    exit /b 1
  )
)

echo Starting Pratibimb...
echo Open http://localhost:5173 once the API is ready.
echo Keep this window open. Press Ctrl+C to stop.
echo.
call npm.cmd run dev
if errorlevel 1 (
  echo.
  echo Pratibimb stopped with an error. See the message above.
  pause
  exit /b 1
)
