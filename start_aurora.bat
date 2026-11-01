@echo off
rem Double-click to start the Aurora music player. It opens at http://127.0.0.1:5173
rem Close this window to stop Aurora.
cd /d "%~dp0player"

rem Already running (e.g. double-clicked twice)? Just open it in the browser.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/ -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
    echo Aurora is already running - opening it in your browser.
    start "" http://127.0.0.1:5173
    timeout /t 3 >nul
    exit /b 0
)

if not exist "node_modules" (
    echo Setting up Aurora for the first time...
    call npm install
)
if not exist ".env.local" copy ".env.example" ".env.local" >nul
call npm run dev -- --open
pause
