@echo off
title BKM Studio
cd /d "%~dp0"

echo.
echo  BKM Studio
echo  Starting local server on http://localhost:3000 ...
echo.

:: Find Python
python --version >nul 2>&1
if not errorlevel 1 (
    set PY=python
    goto :start
)
py --version >nul 2>&1
if not errorlevel 1 (
    set PY=py
    goto :start
)

echo  ERROR: Python is not installed.
echo  Download from: https://www.python.org/downloads/
echo  (Check "Add Python to PATH" during install)
echo.
pause
exit /b 1

:start
:: Start HTTP server in a separate minimised window
start /min "BKM Studio Server  ^|  close this window to stop" cmd /k "%PY% -m http.server 3000"

:: Wait for server to be ready
timeout /t 2 /nobreak >nul

:: Open browser
start "" "http://localhost:3000/bkm-bosch.html"

echo  Server running at: http://localhost:3000/bkm-bosch.html
echo  Browser should open automatically.
echo.
echo  To stop the server, find and close the minimised
echo  "BKM Studio Server" window in your taskbar.
echo.
pause
