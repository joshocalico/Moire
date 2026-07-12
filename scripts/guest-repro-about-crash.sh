#!/usr/bin/env bash
# Reproduce Nautilus crash: open About from app menu, then Credits.
set -euo pipefail
RUNTIME=/home/moire/.moire-runtime
echo "=== CRASH REPRO $(date -Is) ===" >> /tmp/moire-session.log

# Replace session nautilus with a debug one on the same bus/display
pkill -u moire -x nautilus 2>/dev/null || true
sleep 0.5

NAU_ENV_PID=$(pgrep -u moire -f 'tsx src/main' | head -1 || true)
# Get dbus from compositor's session via foot or any session child
FOOT=$(pgrep -u moire -x foot | head -1 || true)
if [[ -n "${FOOT:-}" ]]; then
  DBUS=$(tr '\0' '\n' < /proc/"$FOOT"/environ | grep ^DBUS_SESSION_BUS_ADDRESS= | cut -d= -f2-)
else
  DBUS=$(tr '\0' '\n' < /proc/"$NAU_ENV_PID"/environ | grep ^DBUS_SESSION_BUS_ADDRESS= | cut -d= -f2- || true)
fi

rm -f /tmp/moire-nau-debug.log
runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  GDK_BACKEND=wayland \
  GSK_RENDERER=cairo \
  GTK_THEME=Moire \
  GTK_APPLICATION_PREFER_DARK_THEME=1 \
  DBUS_SESSION_BUS_ADDRESS="$DBUS" \
  XDG_CURRENT_DESKTOP=Moire \
  WAYLAND_DEBUG=1 \
  G_MESSAGES_DEBUG=all \
  nautilus --no-desktop \
  >/tmp/moire-nau-debug.log 2>&1 &
sleep 2
echo "nau=$(pgrep -u moire -x nautilus || echo DEAD)"

# Open About via GAction (same as menu item)
runuser -u moire -- env DBUS_SESSION_BUS_ADDRESS="$DBUS" \
  gdbus call --session --dest org.gnome.Nautilus \
  --object-path /org/gnome/Nautilus \
  --method org.freedesktop.Application.ActivateAction \
  'about' '[]' '{}' >/tmp/moire-about-act.txt 2>&1 || true
sleep 1
echo "after about: nau=$(pgrep -u moire -x nautilus || echo DEAD)"

# Click Credits / Legal area with relative mouse moves (center-ish)
python3 - <<'PY'
import time, struct
EV_REL, EV_KEY, EV_SYN = 0x02, 0x01, 0x00
REL_X, REL_Y = 0, 1
BTN_LEFT = 0x110
SYN = 0

def wev(fd, typ, code, value):
    t=time.time(); sec=int(t); usec=int((t-sec)*1e6)
    fd.write(struct.pack("llHHi", sec, usec, typ, code, value)); fd.flush()

fd=open("/dev/input/event2","wb",buffering=0)
# wander toward about dialog center/lower list
for _ in range(30):
    wev(fd, EV_REL, REL_X, 2); wev(fd, EV_REL, REL_Y, 3); wev(fd, EV_SYN, SYN, 0)
    time.sleep(0.01)
for label, n in (("credits", 8), ("legal", 6)):
    for _ in range(n):
        wev(fd, EV_REL, REL_Y, 5); wev(fd, EV_SYN, SYN, 0)
        time.sleep(0.01)
    wev(fd, EV_KEY, BTN_LEFT, 1); wev(fd, EV_SYN, SYN, 0)
    time.sleep(0.05)
    wev(fd, EV_KEY, BTN_LEFT, 0); wev(fd, EV_SYN, SYN, 0)
    time.sleep(0.6)
fd.close()
print("clicked credits/legal")
PY

sleep 1
echo "final nau=$(pgrep -u moire -x nautilus || echo DEAD)"
echo "=== about act ==="
cat /tmp/moire-about-act.txt
echo "=== wayland errors ==="
grep -iE 'error|abort|critical|segfault|protocol|xdg_popup|broken' /tmp/moire-nau-debug.log | tail -40
echo "=== session popup ==="
grep -E '\[popup\]|\[seat\]|dispatch error' /tmp/moire-session.log | tail -30
echo "=== nau tail ==="
tail -40 /tmp/moire-nau-debug.log
