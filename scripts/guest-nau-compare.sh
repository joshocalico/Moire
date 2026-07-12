#!/usr/bin/env bash
set -euo pipefail
UID_MOIRE=$(id -u moire)
pkill -u moire -x nautilus 2>/dev/null || true
pkill -u moire -f 'dbus-daemon --session' 2>/dev/null || true
sleep 0.3

run_one() {
  local tag=$1
  shift
  rm -f /tmp/moire-nau-$tag.log /tmp/moire-nau-$tag.exit
  setsid runuser -u moire -- env \
    XDG_RUNTIME_DIR=/run/user/$UID_MOIRE \
    WAYLAND_DISPLAY=wayland-1 \
    HOME=/home/moire \
    GDK_BACKEND=wayland \
    "$@" \
    bash -c 'dbus-run-session -- sh -c "nautilus --no-desktop; echo EXIT=\$? > /tmp/moire-nau-'"$tag"'.exit"' \
    </dev/null >>/tmp/moire-nau-$tag.log 2>&1 &
  sleep 5
  echo "=== $tag alive? ==="
  pgrep -af 'nautilus --no-desktop' || echo DEAD
  echo "exit file:"; cat /tmp/moire-nau-$tag.exit 2>/dev/null || echo '(none yet)'
  grep -iE 'GL_RENDERER|GSK|Created EGL|EXIT|segfault|trace/breakpoint|Home' /tmp/moire-nau-$tag.log | head -15
  grep -E 'title="Home"|kind=dmabuf|Loading' /tmp/moire-compositor.log | tail -5
}

echo "---- cairo control ----"
run_one cairo GSK_RENDERER=cairo

echo "---- gl software ----"
pkill -u moire -x nautilus 2>/dev/null || true
sleep 0.3
run_one glsoft GSK_RENDERER=gl LIBGL_ALWAYS_SOFTWARE=1

echo "---- gl virgl ----"
pkill -u moire -x nautilus 2>/dev/null || true
sleep 0.3
run_one glvirgl GSK_RENDERER=gl
