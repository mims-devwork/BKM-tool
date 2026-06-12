@echo off
title BKM Studio
cd /d "%~dp0"

echo.
echo  BKM Studio
echo  Checking Node.js...
echo.

:: ── Check if Node.js is installed ────────────────────────────────────────────
node --version >nul 2>&1
if not errorlevel 1 goto :install_deps

echo  Node.js not found. Please install Node.js 18 or later:
echo  https://nodejs.org/en/download
echo.
echo  After installing, close this window and run start.bat again.
echo.
pause
exit /b 1

:: ── Install dependencies (only if node_modules is missing) ───────────────────
:install_deps
if exist "server\node_modules" goto :start

echo  Installing server dependencies (first run only)...
cd server
call npm install --omit=dev --silent
cd ..
echo  Done.
echo.

:: ── Start server ─────────────────────────────────────────────────────────────
:start
echo  Starting BKM Studio server on http://localhost:3000 ...

start /min "BKM Studio Server  |  close this window to stop" cmd /k "cd /d "%~dp0server" && node server.js"

timeout /t 2 /nobreak >nul

start "" "http://localhost:3000/bkm-bosch.html"

echo  Server running at: http://localhost:3000/bkm-bosch.html
echo  Browser opened automatically.
echo.
echo  To stop: close the minimised "BKM Studio Server" window in the taskbar.
echo.
pause
