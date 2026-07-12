#!/usr/bin/env bash
# Restart session, toggle light theme via prefs, confirm compositor reload log.
set -euo pipefail
SRC=/media/psf/moire
bash "$SRC/scripts/guest-clean-restart.sh" >/tmp/moire-restart-prefs.log 2>&1 || true
sleep 2
runuser -u moire -- bash -lc "cd /home/moire/moire/packages/prefs && pnpm exec tsx -e \"
import { applySettings, loadSettings } from './src/index.ts';
applySettings({ ...loadSettings(), dark: false });
console.log('toggled light');
\"" 
sleep 1
echo "=== prefs reload ==="
grep -E 'prefs\]|theme\]|shell\] chrome' /tmp/moire-session.log | tail -20
runuser -u moire -- bash -lc "cd /home/moire/moire/packages/prefs && pnpm exec tsx -e \"
import { applySettings, loadSettings } from './src/index.ts';
applySettings({ ...loadSettings(), dark: true });
\"" 
sleep 0.5
grep -E 'prefs\] reloaded|theme\]' /tmp/moire-session.log | tail -10
