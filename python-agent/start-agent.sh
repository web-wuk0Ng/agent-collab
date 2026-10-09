#!/usr/bin/env bash
# 面镜 MockMirror · Python AI 面试官 Agent 一键启动（macOS / Linux）
# 用法：bash start-agent.sh（首次运行会自动建虚拟环境并装依赖）
set -e
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 python3，请先安装 Python 3.11+：https://www.python.org/"
  exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "[1/2] 创建虚拟环境 .venv 并安装依赖（仅首次，需要几分钟）…"
  python3 -m venv .venv
  ./.venv/bin/python -m pip install -r requirements.txt
else
  echo "[1/2] 已存在虚拟环境，跳过安装。"
fi

echo "[2/2] 启动 AI 面试官 Agent …"
echo "  服务地址: http://127.0.0.1:8000"
echo "  接口文档: http://127.0.0.1:8000/docs"
echo "  按 Ctrl+C 停止"
exec ./.venv/bin/python -m uvicorn app:app --port 8000
