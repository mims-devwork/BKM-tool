@echo off
title BKM Studio
cd /d "%~dp0"

echo.
echo  BKM Studio
echo  Checking Python...
echo.

:: ── Check if Python is already installed ────────────────────────────────────
python --version >nul 2>&1
if not errorlevel 1 ( set PY=python & goto :start )
py --version >nul 2>&1
if not errorlevel 1 ( set PY=py & goto :start )

:: Check common per-user install path
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set PY="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    goto :start
)
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    goto :start
)

:: ── Python not found — install automatically ─────────────────────────────────
echo  Python not found. Installing now (no admin required)...
echo.

:: Try winget first (built into Windows 10/11)
winget --version >nul 2>&1
if not errorlevel 1 (
    echo  Using winget to install Python 3.11...
    winget install Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
    echo.
    goto :refresh
)

:: Fallback: download Python installer via PowerShell
echo  Downloading Python 3.11 installer (using system proxy if configured)...
set INSTALLER=%TEMP%\python-installer.exe
powershell -NoProfile -Command ^
  "$wc = New-Object System.Net.WebClient; $wc.Proxy = [System.Net.WebRequest]::GetSystemWebProxy(); $wc.Proxy.Credentials = [System.Net.CredentialCache]::DefaultCredentials; $wc.DownloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe', '%INSTALLER%')"

if not exist "%INSTALLER%" (
    echo.
    echo  ERROR: Download failed. Please install Python manually:
    echo  https://www.python.org/downloads/
    echo  (Check "Add Python to PATH" during install, then run this file again)
    echo.
    pause
    exit /b 1
)

echo  Running installer (per-user, no admin required)...
"%INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1
del "%INSTALLER%"
echo  Done.
echo.

:: ── Refresh PATH after install ────────────────────────────────────────────────
:refresh
:: Reload user PATH from registry so the new python is visible
for /f "tokens=2*" %%A in (
  'reg query "HKCU\Environment" /v PATH 2^>nul'
) do set "PATH=%PATH%;%%B"

:: Re-check
python --version >nul 2>&1
if not errorlevel 1 ( set PY=python & goto :start )
py --version >nul 2>&1
if not errorlevel 1 ( set PY=py & goto :start )
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set PY="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    goto :start
)

echo.
echo  Python was installed but could not be found yet.
echo  Please close this window and run start.bat again.
echo.
pause
exit /b 1

:: ── Start server ─────────────────────────────────────────────────────────────
:start
echo  Starting server on http://localhost:3000 ...

start /min "BKM Studio Server  |  close this window to stop" cmd /k "%PY% -m http.server 3000"

timeout /t 2 /nobreak >nul

start "" "http://localhost:3000/bkm-bosch.html"

echo  Server running at: http://localhost:3000/bkm-bosch.html
echo  Browser opened automatically.
echo.
echo  To stop: close the minimised "BKM Studio Server" window in the taskbar.
echo.
pause
