@echo off
chcp 65001 >nul
title 面镜 MockMirror —— 安装中文自然语音包
cd /d "%~dp0"

echo ============================================
echo   安装中文（中国）自然语音包
echo   让 AI 面试官的声音更像真人（Xiaoxiao / Yunxi）
echo ============================================
echo.

:: 检查是否已是管理员；不是则自动请求提权（会弹出 UAC，请点“是”）
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 正在请求管理员权限，请在弹出的窗口中点击“是”...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo 已获得管理员权限，开始安装（约 1~3 分钟，请保持联网）...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-zh-voice.ps1"

echo.
echo ============================================
echo   安装结束
echo   1) 重启浏览器（必须，否则读不到新语音）
echo   2) 打开面镜 → 会中底栏「设备」→ 面试官音色
echo      若出现 Xiaoxiao / Yunxi 即成功（选“自动”会优先用它们）
echo ============================================
echo.
echo 若仍只有 Huihui / Kangkang / Yaoyao：
echo   Windows 设置 → 时间和语言 → 语音 → 添加语音 → 中文(中国)
echo.
pause
