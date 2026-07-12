#!/usr/bin/env bash
# Run Xwayland under WAYLAND_DEBUG against a live Moire compositor; capture protocol.
set -euo pipefail
UID_MOIRE=$(id -u moire)
RUNTIME=/home/moire/.moire-runtime
export XDG_RUNTIME_DIR=$RUNTIME
export WAYLAND_DISPLAY=wayland-1

# Kill existing moire-started Xwayland so we can restart with debug.
pkill -u moire -x Xwayland 2>/dev/null || true
sleep 0.5

# Free a display
N=3
rm -f /tmp/.X$N-lock /tmp/.X11-unix/X$N 2>/dev/null || true

: >/tmp/moire-xwayland-debug.log
chmod 666 /tmp/moire-xwayland-debug.log

setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR=$RUNTIME \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  WAYLAND_DEBUG=1 \
  Xwayland :$N -geometry 800x600 \
  </dev/null >>/tmp/moire-xwayland-debug.log 2>&1 &

sleep 2
echo "=== process ==="
pgrep -af 'Xwayland' | head || true
echo "=== error lines ==="
grep -E 'Error getting|error|failed|xdg_|zwp_linux|wl_shm|attach|commit|create_pool|create_immed|modifier' /tmp/moire-xwayland-debug.log | head -80 || true
echo "=== compositor ==="
grep -E '\[xwayland|snapshot|dmabuf|missing pool|commit mapped' /tmp/moire-session.log | tail -30 || true

# Try xeyes briefly
if [[ -S /tmp/.X11-unix/X$N ]]; then
  setsid runuser -u moire -- env DISPLAY=:$N HOME=/home/moire xeyes \
    </dev/null >/tmp/moire-xeyes-debug.log 2>&1 &
  sleep 1
  pgrep -u moire -x xeyes && echo xeyes_alive || echo xeyes_dead
fi

# Keep log size manageable for host pull
wc -l /tmp/moire-xwayland-debug.log
tail -c 120000 /tmp/moire-xwayland-debug.log > /tmp/moire-xwayland-debug-tail.log
echo "wrote /tmp/moire-xwayland-debug-tail.log"
