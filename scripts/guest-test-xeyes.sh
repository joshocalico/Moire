#!/usr/bin/env bash
# Smoke-test rootful Xwayland with xeyes.
set -euo pipefail
UID_MOIRE=$(id -u moire)
RUNTIME=/home/moire/.moire-runtime

if ! command -v xeyes >/dev/null 2>&1; then
  apt-get install -y x11-apps >/tmp/x11-apps-install.log 2>&1 || true
fi
if ! command -v xeyes >/dev/null 2>&1; then
  echo "xeyes not found (install x11-apps)" >&2
  exit 1
fi
if ! command -v Xwayland >/dev/null 2>&1; then
  echo "Xwayland not found" >&2
  exit 1
fi

# Prefer DISPLAY exported by the live compositor process.
COMP_PID=$(pgrep -f 'loader.mjs src/main' | head -1 || true)
DISP=""
if [[ -n "${COMP_PID:-}" && -r /proc/$COMP_PID/environ ]]; then
  DISP=$(tr '\0' '\n' < /proc/$COMP_PID/environ | sed -n 's/^DISPLAY=//p' | head -1 || true)
fi
if [[ -z "${DISP:-}" ]]; then
  # Newest moire-owned X socket (ignore gdm's high numbers)
  for n in $(ls /tmp/.X11-unix/X[0-9]* 2>/dev/null | sed 's/.*X//' | sort -n); do
    owner=$(stat -c %U /tmp/.X11-unix/X$n 2>/dev/null || true)
    if [[ "$owner" == "moire" ]]; then DISP=":$n"; fi
  done
fi
if [[ -z "${DISP:-}" ]]; then
  echo "No DISPLAY / X11 socket — is Xwayland running?" >&2
  grep -E 'xwayland|Xwayland' /tmp/moire-session.log | tail -20 || true
  exit 1
fi

echo "Using DISPLAY=$DISP"
pkill -u moire -x xeyes 2>/dev/null || true
setsid runuser -u moire -- env \
  DISPLAY="$DISP" \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  xeyes \
  </dev/null >/tmp/moire-xeyes.log 2>&1 &

sleep 2
if ! pgrep -u moire -x xeyes >/dev/null; then
  echo "xeyes not running" >&2
  cat /tmp/moire-xeyes.log >&2 || true
  exit 1
fi
echo "=== xeyes pid ==="
pgrep -u moire -x xeyes
echo "=== xwayland / commits ==="
grep -E '\[xwayland|xdg_toplevel|commit mapped.*toplevel|Error getting|snapshot|dmabuf.*create' /tmp/moire-session.log | tail -40 || true
echo "XEYES OK"
