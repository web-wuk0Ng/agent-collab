#!/usr/bin/env bash
# MockMirror 一键启动（macOS / Linux）。用法：bash start.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 Node.js，请先安装 Node.js 18+：https://nodejs.org/"
  exit 1
fi
echo "============================================"
echo "  面镜 MockMirror 启动中..."
echo "  地址: http://localhost:3000"
echo "  按 Ctrl+C 停止服务"
echo "============================================"
( sleep 1.5; curl -s -o /dev/null http://localhost:3000 && xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null ) &
# 首次运行：安装本地离线语音识别（sherpa-onnx，约 50MB 一次性下载）
# 让 Chrome / 离线环境也能语音面试，语音数据不出本机
node scripts/setup-asr.js || true
node server.js
