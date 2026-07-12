#!/usr/bin/env bash
# Set uiScale and relaunch Settings for visual check.
set -euo pipefail
DST=/home/moire/moire
RUNTIME=/home/moire/.moire-runtime
SCALE="${1:-1.0}"

runuser -u moire -- bash -lc "python3 - <<PY
import json, pathlib
p = pathlib.Path.home() / '.config/moire/settings.json'
d = json.loads(p.read_text()) if p.exists() else {'dark': True, 'notifications': True, 'volume': 0.7}
d['uiScale'] = float('$SCALE')
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(d, indent=2) + chr(10))
print('wrote', d['uiScale'])
PY
cd '$DST' && pnpm --filter @moire/prefs exec tsx -e \"
import { applySettings, loadSettings } from '@moire/prefs';
applySettings(loadSettings());
\""

sleep 0.5
pkill -u moire -f '@moire/settings' 2>/dev/null || true
pkill -u moire -f 'apps/settings' 2>/dev/null || true
sleep 0.4
: >/tmp/moire-settings.log
setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  LANG=C.UTF-8 \
  MOIRE_UI_PLATFORM=wayland \
  bash -lc "cd '$DST' && pnpm --filter @moire/settings start" \
  </dev/null >>/tmp/moire-settings.log 2>&1 &
sleep 3
echo "=== settings ==="
tail -15 /tmp/moire-settings.log
echo "=== prefs reloads (last 5) ==="
grep 'prefs] reloaded' /tmp/moire-session.log | tail -5
