#!/usr/bin/env bash
set -euo pipefail
UID_MOIRE=$(id -u moire)
id moire
ls -la /dev/dri/
# can moire open render node?
runuser -u moire -- test -r /dev/dri/renderD128 && echo render_readable || echo render_NOT_readable
runuser -u moire -- test -w /dev/dri/renderD128 && echo render_writable || echo render_NOT_writable

pkill -u moire -x nautilus 2>/dev/null || true
pkill -u moire -f dbus-run-session 2>/dev/null || true
sleep 0.5

export XDG_RUNTIME_DIR=/run/user/$UID_MOIRE
rm -f /tmp/moire-nautilus.log
setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  GDK_BACKEND=wayland \
  GSK_RENDERER=cairo \
  GDK_DEBUG=wayland \
  dbus-run-session -- nautilus --no-desktop \
  </dev/null >>/tmp/moire-nautilus.log 2>&1 &
sleep 4
echo '=== compositor ==='
grep -E 'dmabuf|snapshot|kind=|create_pool|toplevel|client' /tmp/moire-compositor.log | tail -40
echo '=== nautilus err ==='
grep -iE 'wayland|error|failed|dmabuf|egl|surface|cannot' /tmp/moire-nautilus.log | tail -30
pgrep -af nautilus | head
