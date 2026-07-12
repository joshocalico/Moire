#!/usr/bin/env bash
# Restart compositor, launch Settings (@moire/ui Wayland client), capture screen.
set -euo pipefail
SRC=/media/psf/moire
DST=/home/moire/moire
RUNTIME=/home/moire/.moire-runtime

bash "$SRC/scripts/guest-clean-restart.sh" &
RESTART_PID=$!
# guest-clean-restart execs run-compositor which backgrounds session; wait for log
for i in $(seq 1 40); do
  if grep -q 'Shell:' /tmp/moire-session.log 2>/dev/null \
    || grep -q 'TTF fonts ready' /tmp/moire-session.log 2>/dev/null \
    || grep -q 'compositor' /tmp/moire-session.log 2>/dev/null; then
    break
  fi
  sleep 0.5
done
sleep 2

echo "=== compositor / shell ==="
grep -E '\[shell\]|\[theme\]|\[ui\]|Shell:|TTF|error' /tmp/moire-session.log 2>/dev/null | tail -30 || true

echo "=== launch settings ==="
setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  LANG=C.UTF-8 \
  MOIRE_UI_PLATFORM=wayland \
  bash -lc "cd '$DST' && pnpm --filter @moire/settings start" \
  </dev/null >>/tmp/moire-settings.log 2>&1 &
SETTINGS_PID=$!
sleep 3

echo "=== settings log ==="
tail -40 /tmp/moire-settings.log 2>/dev/null || true
echo "=== session tail ==="
tail -30 /tmp/moire-session.log 2>/dev/null || true
echo "=== processes ==="
pgrep -af 'settings|tsx src/main|moire-session' || true
echo "SETTINGS_PID=$SETTINGS_PID RESTART_PID=$RESTART_PID"
