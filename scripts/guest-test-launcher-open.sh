#!/usr/bin/env bash
set -euo pipefail
SRC=/media/psf/moire
DST=/home/moire/moire
UID_MOIRE=$(id -u moire)
RUNTIME=/home/moire/.moire-runtime

systemctl stop gdm3 2>/dev/null || true
pkill -u moire -f 'tsx src/main' 2>/dev/null || true
pkill -u moire -f moire-session 2>/dev/null || true
pkill -u moire -f dbus-run-session 2>/dev/null || true
pkill -u moire -x foot 2>/dev/null || true
pkill -u moire -x nautilus 2>/dev/null || true
sleep 0.4

rsync -a --delete \
  --exclude node_modules --exclude .git --exclude vm \
  "$SRC/" "$DST/"
chown -R moire:moire "$DST"
chmod +x "$DST/apps/session/moire-session"
install -d -o moire -g moire -m 700 "$RUNTIME"

: >/tmp/moire-session.log
chmod 666 /tmp/moire-session.log

setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  LANG=C.UTF-8 \
  GSK_RENDERER=cairo \
  GDK_BACKEND=wayland \
  MOIRE_SHELL_START_OPEN=1 \
  MOIRE_COMPOSITOR="pnpm --dir $DST --filter @moire/compositor exec tsx src/main.ts" \
  bash -c "cd $DST && exec ./apps/session/moire-session" \
  </dev/null >>/tmp/moire-session.log 2>&1 &

sleep 3
echo "=== shell ==="
grep -E '\[shell\]|Shell:' /tmp/moire-session.log | tail -10 || true
echo "=== tail ==="
tail -20 /tmp/moire-session.log
