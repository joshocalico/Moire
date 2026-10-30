#!/usr/bin/env bash
# Apply atmosphere wallpaper + show desktop icons; seed Desktop; restart session lightly.
set -euo pipefail
DST=/home/moire/moire

runuser -u moire -- bash -lc "
mkdir -p ~/Desktop ~/Downloads
echo 'hello from Moire' > ~/Desktop/welcome.txt
echo notes > ~/Desktop/Notes.txt
cd '$DST' && pnpm --filter @moire/prefs exec tsx <<'EOF'
import { applySettings, loadSettings } from '@moire/prefs';
const s = loadSettings();
s.wallpaper = { mode: 'atmosphere' };
s.showDesktopIcons = true;
applySettings(s);
console.log('prefs', s.wallpaper, s.showDesktopIcons);
EOF
"

# Kill overlapping apps for a clear desktop shot
pkill -u moire -x nautilus 2>/dev/null || true
pkill -u moire -x foot 2>/dev/null || true
pkill -u moire -f '@moire/settings|apps/core/settings/src/main.tsx' 2>/dev/null || true
pkill -u moire -f '@moire/files' 2>/dev/null || true
pkill -u moire -f 'filter @moire/files|apps/bundled/files/src/main.tsx' 2>/dev/null || true
sleep 1
echo done
