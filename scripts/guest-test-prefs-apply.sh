#!/usr/bin/env bash
set -euo pipefail
SRC=/media/psf/moire
DST=/home/moire/moire

rsync -a --delete \
  --exclude node_modules --exclude .git --exclude vm \
  --exclude '*.img' --exclude '*.iso' \
  "$SRC/" "$DST/"
chown -R moire:moire "$DST"
runuser -u moire -- bash -lc "cd '$DST' && pnpm install" >/tmp/moire-pnpm-prefs.log 2>&1 || true

runuser -u moire -- bash -lc "cd '$DST/packages/prefs' && pnpm exec tsx -e \"
import { applySettings, loadSettings, settingsPath, activeThemePath } from './src/index.ts';
import fs from 'fs';
applySettings({ dark: false, notifications: false, uiScale: 1.25, volume: 0.55 });
console.log('--- settings ---');
console.log(fs.readFileSync(settingsPath(), 'utf8'));
console.log('--- active theme ---');
console.log(JSON.parse(fs.readFileSync(activeThemePath(), 'utf8')).name);
console.log('--- gtk3 ---');
console.log(fs.readFileSync(process.env.HOME + '/.config/gtk-3.0/settings.ini', 'utf8'));
applySettings({ ...loadSettings(), dark: true, notifications: true });
console.log('restored dark', loadSettings().dark);
\""
