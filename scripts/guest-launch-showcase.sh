#!/usr/bin/env bash
# Launch the widget showcase in the active Moire session for visual checks.
set -euo pipefail

DST=/home/moire/moire
RUNTIME=/home/moire/.moire-runtime
SAMPLE="${1:-}"

pkill -u moire -f '@moire/showcase' 2>/dev/null || true
pkill -u moire -f 'apps/showcase' 2>/dev/null || true
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
  bash -lc "cd '$DST' && pnpm --filter @moire/showcase start -- ${args[*]}" \
  </dev/null >>/tmp/moire-showcase.log 2>&1 &

sleep 3
echo "=== showcase ==="
tail -30 /tmp/moire-showcase.log
