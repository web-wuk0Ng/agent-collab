@echo off
rem MockMirror Python Agent one-click launcher (Windows). Double-click this file.
rem It creates a venv and installs dependencies on first run.
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Please install Python 3.11+ from https://www.python.org/
  echo         Remember to check "Add Python to PATH" during installation.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating virtual environment .venv ...
  python -m venv .venv
  echo [2/3] Installing dependencies ^(first run only, may take a few minutes^) ...
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
) else (
  echo [1/3] Virtual environment found, skipping install.
  echo [2/3] Dependencies already installed.
)

echo [3/3] Starting AI Interviewer Agent ...
echo ============================================
echo   Service : http://127.0.0.1:8000
echo   API doc : http://127.0.0.1:8000/docs
echo   Close this window to stop the service.
echo ============================================
".venv\Scripts\python.exe" -m uvicorn app:app --port 8000
pause
