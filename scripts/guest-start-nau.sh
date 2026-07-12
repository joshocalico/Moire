#!/usr/bin/env bash
set -euo pipefail
UID_MOIRE=$(id -u moire)
RUNTIME=/home/moire/.moire-runtime
pkill -u moire -x nautilus 2>/dev/null || true
sleep 0.3
setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  GSK_RENDERER=cairo \
  GDK_BACKEND=wayland \
  nautilus --no-desktop \
  </dev/null >/tmp/moire-nautilus.log 2>&1 &
sleep 3
pgrep -af nautilus || echo 'nautilus failed'
grep -E 'Home|decoration|Error|CRITICAL' /tmp/moire-session.log /tmp/moire-nautilus.log 2>/dev/null | tail -30
