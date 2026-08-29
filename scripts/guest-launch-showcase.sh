#!/usr/bin/env bash
# Launch the widget showcase in the active Moire session for visual checks.
set -euo pipefail

SRC=/media/psf/moire
DST=/home/moire/moire
RUNTIME=/home/moire/.moire-runtime
SAMPLE="${1:-}"
UI_ACCELERATION="${MOIRE_UI_ACCELERATION:-auto}"

mkdir -p "$DST/apps/developer/showcase"
rsync -a --delete --exclude node_modules "$SRC/packages/ui/" "$DST/packages/ui/"
rsync -a --delete --exclude node_modules "$SRC/packages/react-host/" "$DST/packages/react-host/"
rsync -a --delete --exclude node_modules "$SRC/packages/sys/" "$DST/packages/sys/"
rsync -a --delete --exclude node_modules "$SRC/packages/protocol/" "$DST/packages/protocol/"
rsync -a --delete --exclude node_modules "$SRC/apps/developer/showcase/" "$DST/apps/developer/showcase/"
chown -R moire:moire "$DST/packages/ui" "$DST/packages/react-host" "$DST/packages/sys" "$DST/packages/protocol" "$DST/apps/developer/showcase"

pkill -u moire -f '@moire/showcase' 2>/dev/null || true
pkill -u moire -f 'apps/developer/showcase' 2>/dev/null || true
sleep 0.3
: >/tmp/moire-showcase.log

args=()
if [[ -n "$SAMPLE" ]]; then
  args=(--sample "$SAMPLE")
fi

setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  LANG=C.UTF-8 \
  MOIRE_UI_PLATFORM=wayland \
  MOIRE_UI_ACCELERATION="$UI_ACCELERATION" \
  bash -lc "cd '$DST' && pnpm --filter @moire/showcase start -- ${args[*]}" \
  </dev/null >>/tmp/moire-showcase.log 2>&1 &

sleep 3
echo "=== showcase ==="
tail -30 /tmp/moire-showcase.log
