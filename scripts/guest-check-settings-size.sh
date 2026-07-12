#!/usr/bin/env bash
set -euo pipefail
echo "=== recent shm / deco / client ==="
grep -E 'shm\] create_pool|deco\]|client\] connected' /tmp/moire-session.log | tail -25
echo "=== settings ==="
cat /tmp/moire-settings.log
echo "=== settings pid ==="
pgrep -af 'apps/settings|@moire/settings' || true
