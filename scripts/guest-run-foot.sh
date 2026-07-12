#!/usr/bin/env bash
set -uo pipefail
export XDG_RUNTIME_DIR=/run/user/1000
export WAYLAND_DISPLAY=wayland-1
export HOME=/home/moire
export LANG=C.UTF-8
cd /home/moire

pkill -u moire -x foot 2>/dev/null || true
pkill -u moire -f weston-simple-shm 2>/dev/null || true
sleep 0.2

nohup foot > /tmp/moire-foot.log 2>&1 &
echo "foot pid=$!"
sleep 1
tail -20 /tmp/moire-foot.log || true
tail -30 /tmp/moire-compositor.log || true
