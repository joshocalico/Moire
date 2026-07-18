#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/moire/moire
if [[ ! -d "$ROOT" ]]; then
  echo "Guest worktree not found at $ROOT" >&2
  exit 1
fi

echo "=== synthetic layout / crop ==="
runuser -u moire -- bash -lc \
  "cd '$ROOT' && pnpm --filter @moire/core smoke:display"

echo "=== topology before DRM change ==="
bash /media/psf/moire/scripts/guest-display-mode.sh outputs

echo "=== DRM reconciliation ==="
udevadm trigger --subsystem-match=drm --action=change
sleep 1

if ! pgrep -u moire -f '@moire/compositor exec tsx src/main.ts' >/dev/null; then
  echo "Moire compositor exited during DRM reconciliation" >&2
  exit 1
fi
if [[ ! -S /home/moire/.moire-runtime/wayland-1 ]]; then
  echo "Wayland socket disappeared during DRM reconciliation" >&2
  exit 1
fi

echo "=== topology after DRM change ==="
bash /media/psf/moire/scripts/guest-display-mode.sh outputs
echo "[guest/multi-output-smoke] ok"
