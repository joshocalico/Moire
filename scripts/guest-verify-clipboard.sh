#!/usr/bin/env bash
# Restart compositor only (keep VM up), then clipboard smoke test.
set -euo pipefail
bash /media/psf/moire/scripts/guest-clean-restart.sh
sleep 1
bash /media/psf/moire/scripts/guest-test-clipboard.sh
echo "=== clipboard log ==="
grep -E 'clipboard|selection' /tmp/moire-session.log | tail -20 || true
echo "=== RSS ==="
PID=$(pgrep -f 'loader.mjs src/main' | head -1 || true)
if [[ -n "${PID:-}" ]]; then
  grep -E 'VmRSS|VmSize' /proc/"$PID"/status
fi
