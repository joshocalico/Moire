#!/usr/bin/env bash
# Launch Moire Bench in the active guest session.
set -euo pipefail

SRC=/media/psf/moire
DST=/home/moire/moire
RUNTIME=/home/moire/.moire-runtime
UI_ACCELERATION="${MOIRE_UI_ACCELERATION:-auto}"
BENCH_AUTORUN="${MOIRE_BENCH_AUTORUN:-0}"

mkdir -p "$DST/apps/developer/benchmark"
rsync -a --delete --exclude node_modules "$SRC/packages/ui/" "$DST/packages/ui/"
rsync -a --delete --exclude node_modules "$SRC/packages/react-host/" "$DST/packages/react-host/"
rsync -a --delete --exclude node_modules "$SRC/packages/sys/" "$DST/packages/sys/"
rsync -a --delete --exclude node_modules "$SRC/packages/protocol/" "$DST/packages/protocol/"
rsync -a --delete --exclude node_modules "$SRC/apps/developer/benchmark/" "$DST/apps/developer/benchmark/"
chown -R moire:moire "$DST/packages/ui" "$DST/packages/react-host" "$DST/packages/sys" "$DST/packages/protocol" "$DST/apps/developer/benchmark"

if [[ -r /tmp/moire-benchmark.pid ]]; then
  read -r OLD_BENCH_PID < /tmp/moire-benchmark.pid || true
  if [[ "${OLD_BENCH_PID:-}" =~ ^[0-9]+$ ]]; then
    kill -- "-$OLD_BENCH_PID" 2>/dev/null || true
    kill "$OLD_BENCH_PID" 2>/dev/null || true
  fi
fi
pkill -u moire -f '@moire/benchmark' 2>/dev/null || true
pkill -u moire -f 'apps/developer/benchmark' 2>/dev/null || true
: >/tmp/moire-benchmark.log

setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  LANG=C.UTF-8 \
  MOIRE_UI_PLATFORM=wayland \
  MOIRE_UI_ACCELERATION="$UI_ACCELERATION" \
  MOIRE_BENCH_AUTORUN="$BENCH_AUTORUN" \
  bash -lc "cd '$DST' && pnpm --filter @moire/benchmark start" \
  </dev/null >>/tmp/moire-benchmark.log 2>&1 &
echo "$!" >/tmp/moire-benchmark.pid

sleep 3
echo "=== benchmark ==="
tail -30 /tmp/moire-benchmark.log
