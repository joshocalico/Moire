#!/usr/bin/env bash
set -uo pipefail
export XDG_RUNTIME_DIR=/run/user/1000
export WAYLAND_DISPLAY=wayland-1
export HOME=/home/moire
cd /home/moire

echo "=== socket ==="
ls -la "$XDG_RUNTIME_DIR/wayland-1" || echo "missing socket"

echo "=== weston-simple-shm ==="
timeout --signal=KILL 2s weston-simple-shm; echo "weston exit=$?"

echo "=== foot ==="
timeout --signal=KILL 2s foot; echo "foot exit=$?"

echo "=== compositor log ==="
tail -50 /tmp/moire-compositor.log || true

echo "=== compositor alive? ==="
pgrep -af 'tsx src/main' || echo dead
