@echo off
chcp 65001 > nul
title DaDa
cd /d "%~dp0"

REM Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo   [ERROR] Node.js not found - install from https://nodejs.org
    pause
    exit /b 1
)

REM Check node_modules
if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo   [ERROR] npm install failed
        pause
        exit /b 1
    )
)

REM Read PORT from .env.local or .env, fallback 9877
set "PORT=9877"
if exist ".env.local" (
    for /f "tokens=2 delims==" %%a in ('findstr /b "PORT=" ".env.local" 2^>nul') do set "PORT=%%a"
)
if "%PORT%"=="9877" (
    if exist ".env" (
        for /f "tokens=2 delims==" %%a in ('findstr /b "PORT=" ".env" 2^>nul') do set "PORT=%%a"
    )
)
set "PORT=%PORT: =%"

REM Start server in background (no extra window)
set "NO_BROWSER=1"
start "" /b npx tsx "%~dp0src/server.ts"

REM Wait for server (up to 30s)
set /a RETRIES=0
:waitloop
timeout /t 2 /nobreak >nul
set /a RETRIES+=1
curl -s -o nul http://localhost:%PORT%/api/health 2>nul
if errorlevel 1 (
    if %RETRIES% LSS 15 goto waitloop
)

REM Open single Edge app window
start "" msedge --app=http://localhost:%PORT%

REM Done - auto close after 3 seconds
timeout /t 3 /nobreak >nul
exit
