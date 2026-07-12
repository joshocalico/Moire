#!/usr/bin/env bash
set -euo pipefail
DST=/home/moire/moire
RUNTIME=/home/moire/.moire-runtime

sleep 2
echo "=== settings log ==="
cat /tmp/moire-settings.log 2>/dev/null || echo "(none)"
echo "=== compositor shm/title ==="
grep -E 'shm|title=|Settings|create_pool|error|xdg' /tmp/moire-compositor.log 2>/dev/null | tail -50 || true
echo "=== shell TTF ==="
grep -E 'TTF|shell' /tmp/moire-session.log 2>/dev/null | tail -20 || true
echo "=== procs ==="
pgrep -af 'settings|tsx src/main|moire-session' || true
