#!/usr/bin/env bash
# Smoke-test seat clipboard via wl-copy / wl-paste.
# wl-copy stays alive as selection owner — run it in background for the paste.
set -euo pipefail
UID_MOIRE=$(id -u moire)
export XDG_RUNTIME_DIR=/run/user/$UID_MOIRE
export WAYLAND_DISPLAY=wayland-1

if ! command -v wl-copy >/dev/null 2>&1; then
  echo "wl-clipboard not installed; apt install wl-clipboard" >&2
  exit 0
fi

TOKEN="moire-clipboard-$(date +%s)"
echo "copy token: $TOKEN"

pkill -u moire -x wl-copy 2>/dev/null || true
pkill -u moire -x wl-paste 2>/dev/null || true
sleep 0.2

setsid runuser -u moire -- env XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR WAYLAND_DISPLAY=$WAYLAND_DISPLAY \
  wl-copy "$TOKEN" </dev/null >/tmp/moire-wl-copy.log 2>&1 &
COPY_PID=$!
sleep 0.5

GOT=$(runuser -u moire -- env XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR WAYLAND_DISPLAY=$WAYLAND_DISPLAY \
  wl-paste -n 2>/tmp/moire-wl-paste.log || true)
echo "paste got: [$GOT]"

kill "$COPY_PID" 2>/dev/null || true
pkill -u moire -x wl-copy 2>/dev/null || true

echo "=== compositor clipboard log ==="
grep -E '\[clipboard\]' /tmp/moire-session.log | tail -20 || true
echo "=== wl-copy log ==="
cat /tmp/moire-wl-copy.log 2>/dev/null || true
echo "=== wl-paste log ==="
cat /tmp/moire-wl-paste.log 2>/dev/null || true

if [[ "$GOT" == "$TOKEN" ]]; then
  echo "CLIPBOARD OK"
  exit 0
fi
echo "CLIPBOARD FAIL" >&2
exit 1
