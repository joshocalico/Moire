#!/usr/bin/env bash
echo "=== desktop ==="
ls -la /home/moire/Desktop
echo "=== prefs ==="
cat /home/moire/.config/moire/prefs.json 2>/dev/null || echo missing
echo "=== layout ==="
cat /home/moire/.config/moire/desktop-layout.json 2>/dev/null || echo none
echo "=== compositor greps ==="
grep -iE 'desktop|wallpaper|paintDesktop|icons' /tmp/moire-session.log 2>/dev/null | tail -20
