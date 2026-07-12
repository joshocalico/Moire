#!/usr/bin/env bash
# Exercise zwp_linux_dmabuf_v1 with weston-simple-dmabuf-egl (needs render node access).
set -euo pipefail
UID_MOIRE=$(id -u moire)
# Ensure render group membership for /dev/dri/renderD*
if ! id -nG moire | tr ' ' '\n' | grep -qx render; then
  usermod -aG render moire
  echo "Added moire to render group (new sessions pick this up)."
fi

export XDG_RUNTIME_DIR=/run/user/$UID_MOIRE
export WAYLAND_DISPLAY=wayland-1
export HOME=/home/moire

pkill -u moire -x weston-simple-dmabuf-egl 2>/dev/null || true
sleep 0.2
rm -f /tmp/moire-dmabuf-client.log

# sg render so we don't need a re-login for the new group
setsid sg render -c "runuser -u moire -- env XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR WAYLAND_DISPLAY=wayland-1 HOME=/home/moire weston-simple-dmabuf-egl" \
  </dev/null >>/tmp/moire-dmabuf-client.log 2>&1 &
sleep 2
echo "=== client ==="
cat /tmp/moire-dmabuf-client.log || true
echo "=== compositor ==="
grep -E 'dmabuf|snapshot|kind=dmabuf|GBM' /tmp/moire-compositor.log | tail -30
