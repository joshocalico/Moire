#!/usr/bin/env bash
set -euo pipefail
systemctl stop gdm3 2>/dev/null || true
systemctl stop gdm 2>/dev/null || true

# Unfreeze anything left in T state, then kill hard
pkill -CONT -u moire 2>/dev/null || true
sleep 0.2
pkill -9 -u moire -f 'tsx' 2>/dev/null || true
pkill -9 -u moire -f 'pnpm' 2>/dev/null || true
pkill -9 -u moire -x node 2>/dev/null || true
pkill -9 -u moire -x foot 2>/dev/null || true
pkill -9 -u moire -x nautilus 2>/dev/null || true
pkill -9 -u moire -f 'dbus-run-session' 2>/dev/null || true
pkill -9 -u moire -f 'moire-session' 2>/dev/null || true
# Catch orphans not owned correctly
pkill -9 -f '/home/moire/moire.*tsx src/main' 2>/dev/null || true
sleep 1

if pgrep -af 'tsx src/main' >/dev/null 2>&1; then
  echo "WARNING: compositor still running:" >&2
  pgrep -af 'tsx src/main' >&2 || true
fi

exec env MOIRE_RENDERER="${MOIRE_RENDERER:-auto}" \
  bash /media/psf/moire/scripts/guest-run-compositor.sh
