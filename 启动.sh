#!/bin/bash
# 悦读 · 一键启动 / 自愈
# 用法：双击本文件，或在终端执行 ./启动.sh
# 逻辑：健康就只打开浏览器；不健康就清掉旧进程（必要时清构建缓存）重起
set -u
cd "$(dirname "$0")" || exit 1

PROXY="${PROXY:-http://127.0.0.1:7890}"   # 你的代理端口，不同就改这里
BACKEND_PORT="${BACKEND_PORT:-8788}"
FRONTEND_PORT="${FRONTEND_PORT:-3012}"
WEB="http://127.0.0.1:$FRONTEND_PORT"

# 本机请求必须绕过代理，否则 http_proxy 会把它也转走，表现为假性超时
code() { curl -s -o /dev/null --noproxy '*' -m 4 -w "%{http_code}" "$1" 2>/dev/null; }

echo "== 悦读 =="

if [ "$(code "$WEB/")" = "200" ] && [ "$(code "http://127.0.0.1:$BACKEND_PORT/")" = "200" ]; then
  echo "服务已在运行，直接打开。"
  open "$WEB/"
  exit 0
fi

echo "服务未就绪，开始重启…"
for P in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  PIDS=$(lsof -nP -tiTCP:"$P" -sTCP:LISTEN 2>/dev/null)
  [ -n "$PIDS" ] && kill $PIDS 2>/dev/null && sleep 1
done
# 兜底：普通 kill 没退干净的
for P in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  PIDS=$(lsof -nP -tiTCP:"$P" -sTCP:LISTEN 2>/dev/null)
  [ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
done

if [ ! -x backend/.venv/bin/python ]; then
  echo "缺少后端虚拟环境，先执行： cd backend && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt"
  read -r -p "按回车关闭…" _
  exit 1
fi

start_backend() {
  ( cd backend && HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY" https_proxy="$PROXY" http_proxy="$PROXY" \
    NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
    ./.venv/bin/python -m uvicorn novel_learning.web:app --host 127.0.0.1 --port "$BACKEND_PORT" \
    >> /tmp/yuedu-backend.log 2>&1 ) &
}

start_frontend() {
  ( cd frontend && BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" \
    NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
    npm run dev -- --hostname 127.0.0.1 --port "$FRONTEND_PORT" >> /tmp/yuedu-frontend.log 2>&1 ) &
}

wait_for() { # wait_for <url> <最多等几秒>
  local i=0
  while [ "$i" -lt "$2" ]; do
    [ "$(code "$1")" = "200" ] && return 0
    sleep 1; i=$((i+1))
  done
  return 1
}

start_backend
start_frontend

if wait_for "$WEB/" 45; then
  echo "已就绪：$WEB"
  open "$WEB/"
  echo
  echo "（这个窗口要留着，服务跑在里面；关掉窗口服务就停了）"
  exit 0
fi

# 45 秒还没起来，多数是 .next 构建缓存坏了（白页 / 500），清掉重来一次
echo "首次启动超时，清理构建缓存后重试…"
PIDS=$(lsof -nP -tiTCP:"$FRONTEND_PORT" -sTCP:LISTEN 2>/dev/null)
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
rm -rf frontend/.next
start_frontend

if wait_for "$WEB/" 90; then
  echo "已就绪：$WEB"
  open "$WEB/"
  echo
  echo "（这个窗口要留着，服务跑在里面；关掉窗口服务就停了）"
  exit 0
fi

echo
echo "还是没起来。日志在这里："
echo "  后端 /tmp/yuedu-backend.log"
echo "  前端 /tmp/yuedu-frontend.log"
echo "把这两个文件发我，我来查。"
read -r -p "按回车关闭…" _
