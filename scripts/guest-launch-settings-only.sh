#!/usr/bin/env bash
set -euo pipefail
DST=/home/moire/moire
RUNTIME=/home/moire/.moire-runtime
: >/tmp/moire-settings.log
setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  LANG=C.UTF-8 \
  MOIRE_UI_PLATFORM=wayland \
  bash -lc "cd '$DST' && pnpm --filter @moire/settings start" \
  </dev/null >>/tmp/moire-settings.log 2>&1 &
sleep 3
echo "=== settings ==="
cat /tmp/moire-settings.log
echo "=== shm ==="
grep 'shm\] create_pool' /tmp/moire-session.log | tail -8
