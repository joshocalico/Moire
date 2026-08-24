#!/usr/bin/env bash
# Sync tree into guest worktree and start moire-session (compositor + foot + Files).
set -euo pipefail

SRC=/media/psf/moire
DST=/home/moire/moire
UID_MOIRE=$(id -u moire)
# Do NOT use /run/user/$UID — without a logind session (linger), systemd
# removes that directory and the Wayland socket vanishes while the compositor
# keeps running. Launcher still paints; spawned apps fail to connect.
RUNTIME=/home/moire/.moire-runtime
RENDERER="${MOIRE_RENDERER:-auto}"
EGL_PRESENT="${MOIRE_EGL_PRESENT:-auto}"
UI_ACCELERATION="${MOIRE_UI_ACCELERATION:-auto}"

# Free DRM master (gdm comes back after reboot)
systemctl stop gdm3 2>/dev/null || true
systemctl stop gdm 2>/dev/null || true
sleep 0.5

rsync -a --delete \
  --exclude node_modules --exclude .git --exclude vm \
  --exclude '*.img' --exclude '*.iso' \
  "$SRC/" "$DST/"
chown -R moire:moire "$DST"
# Install/update deps in the guest worktree (host node_modules is not synced).
runuser -u moire -- bash -lc "cd '$DST' && pnpm install --frozen-lockfile" \
  >/tmp/moire-pnpm-install.log 2>&1 \
  || runuser -u moire -- bash -lc "cd '$DST' && pnpm install" \
  >/tmp/moire-pnpm-install.log 2>&1 \
  || true
install -d -o moire -g moire -m 700 "$RUNTIME"
chmod +x "$DST/apps/session/moire-session"

pkill -u moire -f 'tsx src/main.ts' 2>/dev/null || true
pkill -u moire -f 'moire-session' 2>/dev/null || true
pkill -u moire -f 'dbus-run-session' 2>/dev/null || true
pkill -u moire -x foot 2>/dev/null || true
pkill -u moire -x nautilus 2>/dev/null || true
pkill -u moire -f '@moire/files' 2>/dev/null || true
sleep 0.3

rm -f /tmp/moire-compositor.log /tmp/moire-foot.log /tmp/moire-files.log /tmp/moire-session.log
touch /tmp/moire-compositor.log /tmp/moire-foot.log /tmp/moire-files.log /tmp/moire-session.log
chmod 666 /tmp/moire-compositor.log /tmp/moire-foot.log /tmp/moire-files.log /tmp/moire-session.log

# Session owns dbus + compositor + day-0 apps. Compositor stdout still goes to
# the session log; clients write their own logs from moire-session.
setsid runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  LANG=C.UTF-8 \
  GSK_RENDERER=cairo \
  GDK_BACKEND=wayland \
  MOIRE_RENDERER="$RENDERER" \
  MOIRE_EGL_PRESENT="$EGL_PRESENT" \
  MOIRE_UI_ACCELERATION="$UI_ACCELERATION" \
  MOIRE_COMPOSITOR="pnpm --dir $DST --filter @moire/compositor exec tsx src/main.ts" \
  bash -c "cd $DST && exec ./apps/session/moire-session" \
  </dev/null >>/tmp/moire-session.log 2>&1 &

sleep 3
echo "=== session ==="
tail -40 /tmp/moire-session.log
echo "=== socket ==="
ls -la "$RUNTIME"/wayland-1 2>/dev/null || echo "(no socket yet)"
echo "=== procs ==="
ps -eo pid,cmd | grep -E 'tsx src/main|[/]foot|@moire/files|moire-session|dbus-run-session' | grep -v grep || true
echo "=== recent commits ==="
grep 'commit mapped' /tmp/moire-session.log | tail -12 || true
echo "=== foot / files ==="
tail -5 /tmp/moire-foot.log 2>/dev/null || true
tail -10 /tmp/moire-files.log 2>/dev/null || true
