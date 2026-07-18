#!/usr/bin/env bash
set -euo pipefail

FILES_PID="$(pgrep -u moire -f 'apps/files.*tsx src/main.tsx|@moire/files start' | head -n 1)"
if [[ -z "$FILES_PID" ]]; then
  echo "Files session process not found" >&2
  exit 1
fi

read_env() {
  local key="$1"
  tr '\0' '\n' < "/proc/$FILES_PID/environ" \
    | sed -n "s/^${key}=//p" \
    | head -n 1
}

BUS="$(read_env DBUS_SESSION_BUS_ADDRESS)"
RUNTIME="$(read_env XDG_RUNTIME_DIR)"
WAYLAND="$(read_env WAYLAND_DISPLAY)"

runuser -u moire -- env \
  HOME=/home/moire \
  DBUS_SESSION_BUS_ADDRESS="$BUS" \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY="$WAYLAND" \
  MOIRE_UI_PLATFORM=wayland \
  bash -lc 'cd /home/moire/moire && exec pnpm --filter @moire/settings start' \
  >/tmp/moire-settings.log 2>&1 &

echo "Settings launched"
