#!/bin/bash
# 悦读 · 一键启动（本机需要能访问 aihubmix，默认借用本地 7890 代理）
# 用法：双击运行，或在终端执行  ./启动.sh
set -u
cd "$(dirname "$0")"

PROXY="${PROXY:-http://127.0.0.1:7890}"   # 你的代理端口，不同就改这里
BACKEND_PORT="${BACKEND_PORT:-8788}"
FRONTEND_PORT="${FRONTEND_PORT:-3012}"
export HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY" https_proxy="$PROXY" http_proxy="$PROXY"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"

# 端口占用就先清理自己的旧进程
for P in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  PIDS=$(lsof -nP -tiTCP:"$P" -sTCP:LISTEN 2>/dev/null)
  [ -n "$PIDS" ] && kill $PIDS 2>/dev/null && sleep 1
done

if [ ! -x backend/.venv/bin/python ]; then
  echo "缺少后端虚拟环境，先执行： cd backend && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt"
  exit 1
fi

( cd backend && HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY" https_proxy="$PROXY" http_proxy="$PROXY" \
  NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
  ./.venv/bin/python -m uvicorn novel_learning.web:app --host 127.0.0.1 --port "$BACKEND_PORT" \
  > /tmp/yuedu-backend.log 2>&1 ) &

( cd frontend && BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" \
  npm run dev -- --hostname 127.0.0.1 --port "$FRONTEND_PORT" > /tmp/yuedu-frontend.log 2>&1 ) &

echo "后端日志：/tmp/yuedu-backend.log"
echo "前端日志：/tmp/yuedu-frontend.log"
for i in $(seq 1 40); do
  sleep 1
  code=$(curl -s -o /dev/null -m 2 -w "%{http_code}" "http://127.0.0.1:$FRONTEND_PORT/" || true)
  [ "$code" = "200" ] && break
done
echo "打开：http://127.0.0.1:$FRONTEND_PORT"
open "http://127.0.0.1:$FRONTEND_PORT"
