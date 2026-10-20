@echo off
rem MockMirror one-click launcher (Windows). Double-click this file.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Please install Node.js 18 or later from https://nodejs.org/ then run this again.
  pause
  exit /b 1
)
echo ============================================
echo   MockMirror starting...
echo   URL: http://localhost:3000
echo   (browser will open automatically)
echo   Close this window to stop the server.
echo ============================================
rem First run: install local offline speech recognition (sherpa-onnx, ~50MB one-time download).
rem Enables voice interview in Chrome / offline; audio never leaves your machine.
node scripts\setup-asr.js
start "" "http://localhost:3000"
node server.js
pause
