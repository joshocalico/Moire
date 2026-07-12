#!/usr/bin/env bash
set -euo pipefail
UID_MOIRE=$(id -u moire)
pkill -u moire -x nautilus 2>/dev/null || true
pkill -u moire -f dbus-run-session 2>/dev/null || true
sleep 0.4
rm -f /tmp/moire-nautilus-egl.log

# Keep nautilus in foreground of dbus-run-session; prefer classic GL renderer first.
setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR=/run/user/$UID_MOIRE \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  GDK_BACKEND=wayland \
  GSK_RENDERER=gl \
  GDK_DEBUG=opengl \
  LIBGL_DEBUG=verbose \
  dbus-run-session -- nautilus --no-desktop \
  </dev/null >>/tmp/moire-nautilus-egl.log 2>&1 &
sleep 6
echo "=== alive ==="
pgrep -af 'nautilus --no-desktop' || echo DEAD
echo "=== GL / crash hints ==="
grep -iE 'GSK|GL_RENDERER|GL_VENDOR|virtio|virgl|dri2|zink|segfault|abort|trace/breakpoint|EGL|error|critical|GdkGL' /tmp/moire-nautilus-egl.log | head -40
echo "=== compositor ==="
grep -E 'Home|Files|Loading|kind=dmabuf|create_immed|created buffer|title=' /tmp/moire-compositor.log | tail -25
