#!/usr/bin/env bash
# Seed ~/Desktop and relaunch Files for guest verification.
set -euo pipefail
DST=/home/moire/moire
RUNTIME=/home/moire/.moire-runtime

runuser -u moire -- bash -lc '
mkdir -p ~/Desktop ~/Downloads ~/Pictures
echo "hello from Moire" > ~/Desktop/welcome.txt
touch ~/Desktop/Notes
'

pkill -u moire -f '@moire/files' 2>/dev/null || true
pkill -u moire -f 'apps/bundled/files' 2>/dev/null || true
sleep 0.4
runuser -u moire -- bash -lc ': > /tmp/moire-files.log'
setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  LANG=C.UTF-8 \
  MOIRE_UI_PLATFORM=wayland \
  bash -lc "cd '$DST' && pnpm --filter @moire/files start" \
  </dev/null >>/tmp/moire-files.log 2>&1 2>&1 &
sleep 3
echo "=== files log ==="
tail -20 /tmp/moire-files.log
echo "=== desktop ==="
ls -la /home/moire/Desktop || true
