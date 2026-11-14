@echo off
title 4K Video Enhancer
cd /d "%~dp0"

echo.
echo   ==============================
echo    4K VIDEO ENHANCER  -  starting
echo   ==============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js is not installed yet.
  echo       1. Go to https://nodejs.org
  echo       2. Download the LTS version and install it.
  echo       3. Then double-click START.bat again.
  echo.
  pause
  exit /b
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo   [!] FFmpeg is not installed -- it is needed to make 4K videos.
  choice /C YN /M "   Install FFmpeg automatically with winget now"
  if errorlevel 2 exit /b
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
  echo.
  echo   FFmpeg was installed. To make Windows see it:
  echo   close this window, open a NEW window, and double-click START.bat again.
  echo.
  pause
  exit /b
)

if not exist node_modules (
  echo   First run - installing dependencies. Takes a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo   [X] npm install failed. Check your internet and try again.
    echo.
    pause
    exit /b
  )
)

echo   Starting the app...
echo.
echo   ---------------------------------------------
echo    Open this in your browser:
echo.
echo        http://localhost:3000
echo.
echo    Leave this window open while you use the app.
echo    Press Ctrl+C or close this window to stop.
echo   ---------------------------------------------
echo.

set DEMO_MODE=1
node --env-file-if-exists=.env server.js
echo.
echo App stopped.
pause
