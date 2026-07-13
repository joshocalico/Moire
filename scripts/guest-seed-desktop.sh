#!/usr/bin/env bash
set -euo pipefail
DST=/home/moire/moire
runuser -u moire -- bash -lc '
mkdir -p ~/Desktop/Projects ~/Downloads
echo "hello from Moire" > ~/Desktop/welcome.txt
echo notes > ~/Desktop/Notes.txt
rm -f ~/Desktop/Notes
'
runuser -u moire -- bash -lc "cd '$DST' && pnpm --filter @moire/prefs exec tsx <<'TS'
import { applySettings, loadSettings } from \"@moire/prefs\";
const s = loadSettings();
s.wallpaper = { mode: \"atmosphere\" };
s.showDesktopIcons = true;
applySettings(s);
console.log(\"prefs\", s.wallpaper, s.showDesktopIcons);
TS"
echo seeded
