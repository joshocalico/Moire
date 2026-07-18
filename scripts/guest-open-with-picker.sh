#!/usr/bin/env bash
set -euo pipefail

FILE_PATH="${1:-/home/moire/Desktop/welcome.txt}"
FILES_PID="$(pgrep -n -u moire -f 'apps/files' || true)"
if [[ -z "$FILES_PID" ]]; then
  echo "Files is not running" >&2
  exit 1
fi

DBUS_ADDRESS="$({ tr '\0' '\n' < "/proc/$FILES_PID/environ"; } | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p')"
if [[ -z "$DBUS_ADDRESS" ]]; then
  echo "Files has no session D-Bus address" >&2
  exit 1
fi

HANDLE="/org/freedesktop/portal/desktop/request/manual/open_with_$$"
setsid -f runuser -u moire -- env \
  HOME=/home/moire \
  XDG_RUNTIME_DIR=/home/moire/.moire-runtime \
  WAYLAND_DISPLAY=wayland-1 \
  DBUS_SESSION_BUS_ADDRESS="$DBUS_ADDRESS" \
  gdbus call --session \
    --dest org.freedesktop.impl.portal.desktop.moire \
    --object-path /org/freedesktop/portal/desktop \
    --method org.moire.FileActivation1.OpenWith \
    "$FILE_PATH" \
    "$HANDLE" \
  >/tmp/moire-picker-call.log 2>&1

echo "Requested Open With for $FILE_PATH"
