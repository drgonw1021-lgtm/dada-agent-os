@echo off
setlocal
title DaDa one-click install

cd /d "%~dp0"
echo [DaDa] Starting one-click install...

where node >nul 2>nul
if errorlevel 1 (
  echo [DaDa] Node.js is not installed.
  echo [DaDa] Please install Node.js LTS from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [DaDa] npm is not available.
  echo [DaDa] Please reinstall Node.js LTS and run again.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [DaDa] Created .env from .env.example
  )
)

echo [DaDa] Installing dependencies...
call npm.cmd install
if errorlevel 1 (
  echo [DaDa] npm install failed.
  pause
  exit /b 1
)

echo [DaDa] Building project...
call npm.cmd run build
if errorlevel 1 (
  echo [DaDa] build failed.
  pause
  exit /b 1
)

echo [DaDa] Install complete.
echo [DaDa] Next step: double-click daDa.bat
pause
exit /b 0
