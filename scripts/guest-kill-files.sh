#!/usr/bin/env bash
set -euo pipefail
pkill -u moire -f 'filter @moire/files|apps/bundled/files/src/main.tsx' 2>/dev/null || true
pkill -u moire -f 'apps/bundled/files' 2>/dev/null || true
# also match pnpm filter line
pkill -u moire -f '@moire/files' 2>/dev/null || true
sleep 1
echo "=== remaining ==="
ps -eo pid,cmd | grep -E 'files|foot|tsx' | grep -v grep || true
