@echo off
rem MockMirror - install Chinese (zh-CN) natural TTS voices (Windows)
rem Right-click this file -> "Run as administrator"
cd /d "%~dp0"

echo ============================================
echo   MockMirror - Install zh-CN natural voices
echo   (Xiaoxiao / Yunxi neural TTS)
echo ============================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator permission. Please click YES on the UAC prompt.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Administrator OK. Installing (needs internet, 1-3 minutes)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-zh-voice.ps1"

echo.
echo ============================================
echo   Done.
echo   1) RESTART your browser (required)
echo   2) Start an interview -^> bottom bar "Device" -^> Voice
echo      If you see Xiaoxiao / Yunxi, it worked.
echo ============================================
echo.
echo If only Huihui / Kangkang / Yaoyao appear:
echo   Windows Settings -^> Time and language -^> Speech
echo   -^> Add voices -^> Chinese (China)
echo.
pause
