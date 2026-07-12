#!/usr/bin/env bash
set -euo pipefail
echo "=== sizes ==="
wc -c /tmp/moire-compositor.log /tmp/moire-session.log /tmp/moire-settings.log 2>/dev/null || true
echo "=== session tail ==="
tail -80 /tmp/moire-session.log
echo "=== settings ==="
cat /tmp/moire-settings.log
