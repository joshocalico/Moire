#!/usr/bin/env bash
set -euo pipefail
SRC=/media/psf/moire
DST=/home/moire/moire
RUNTIME=/home/moire/.moire-runtime
TAB="${1:-0}"
COMPOSITOR_PID="$(pgrep -u moire -f '@moire/compositor exec tsx src/main.ts' | head -n 1)"
BUS="$(tr '\0' '\n' < "/proc/$COMPOSITOR_PID/environ" | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p' | head -n 1)"

mkdir -p "$DST/apps/core/settings"
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude vm \
  --exclude '*.img' --exclude '*.iso' \
  "$SRC/packages/ui/" "$DST/packages/ui/"
rsync -a --delete \
  --exclude node_modules --exclude .git \
  "$SRC/packages/react-host/" "$DST/packages/react-host/"
rsync -a --delete \
  --exclude node_modules --exclude .git \
  "$SRC/packages/protocol/" "$DST/packages/protocol/"
rsync -a "$SRC/apps/core/settings/" "$DST/apps/core/settings/" --exclude node_modules
chown -R moire:moire "$DST/packages/ui" "$DST/packages/react-host" "$DST/packages/protocol" "$DST/apps/core/settings"

pkill -u moire -f '@moire/settings' 2>/dev/null || true
pkill -u moire -f 'apps/core/settings' 2>/dev/null || true
sleep 0.5
: >/tmp/moire-settings.log
setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  DBUS_SESSION_BUS_ADDRESS="$BUS" \
  HOME=/home/moire \
  LANG=C.UTF-8 \
  MOIRE_UI_PLATFORM=wayland \
  MOIRE_SETTINGS_TAB="$TAB" \
  bash -lc "cd '$DST' && pnpm --filter @moire/settings start" \
  </dev/null >>/tmp/moire-settings.log 2>&1 &
sleep 3
echo "=== settings ==="
cat /tmp/moire-settings.log
echo "=== deco / shm ==="
grep -E 'deco|shm create_pool|Settings|client\] connected' /tmp/moire-session.log | tail -20
