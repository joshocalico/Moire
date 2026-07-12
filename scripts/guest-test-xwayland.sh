#!/usr/bin/env bash
# Focused Xwayland + xeyes smoke (assumes compositor already running is OK to restart).
set -euo pipefail
bash /media/psf/moire/scripts/guest-clean-restart.sh >/tmp/moire-xway-restart.txt 2>&1 || true
sleep 1
echo "=== xwayland lines ==="
grep -E '\[xwayland' /tmp/moire-session.log | tail -40 || true
echo "=== X11 sockets ==="
ls -la /tmp/.X11-unix/ 2>/dev/null || true
bash /media/psf/moire/scripts/guest-test-xeyes.sh
sleep 1
echo "=== titles ==="
grep 'commit mapped.*toplevel' /tmp/moire-session.log | tail -20 || true
