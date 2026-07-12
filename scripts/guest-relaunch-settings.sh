#!/usr/bin/env bash
set -euo pipefail
SRC=/media/psf/moire
DST=/home/moire/moire
RUNTIME=/home/moire/.moire-runtime

rsync -a --delete \
  --exclude node_modules --exclude .git --exclude vm \
  --exclude '*.img' --exclude '*.iso' \
  "$SRC/packages/ui/" "$DST/packages/ui/"
rsync -a "$SRC/apps/settings/" "$DST/apps/settings/" --exclude node_modules
chown -R moire:moire "$DST/packages/ui" "$DST/apps/settings"

pkill -u moire -f '@moire/settings' 2>/dev/null || true
pkill -u moire -f 'apps/settings' 2>/dev/null || true
sleep 0.5
: >/tmp/moire-settings.log
setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  LANG=C.UTF-8 \
  MOIRE_UI_PLATFORM=wayland \
  bash -lc "cd '$DST' && pnpm --filter @moire/settings start" \
  </dev/null >>/tmp/moire-settings.log 2>&1 &
sleep 3
echo "=== settings ==="
cat /tmp/moire-settings.log
echo "=== deco / shm ==="
grep -E 'deco|shm create_pool|Settings|client\] connected' /tmp/moire-session.log | tail -20
