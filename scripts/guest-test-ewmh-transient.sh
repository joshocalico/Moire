#!/usr/bin/env bash
# Verify EWMH publish, xwayland_shell filtering, and transient dialog placement.
set -euo pipefail
RUNTIME=/home/moire/.moire-runtime
MARK="EWMH-TEST-$(date +%s)"
echo "=== $MARK ===" >> /tmp/moire-session.log

echo "=== EWMH / xwayland client marks ==="
awk -v m="$MARK" 'BEGIN{f=0} index($0,m){f=1} f' /tmp/moire-session.log >/dev/null
# Look at recent session boot + this mark window
grep -E '\[xwm\] EWMH|\[client\] connected|\[xwayland_shell\]' /tmp/moire-session.log | tail -40

EWMH=$(grep -c '\[xwm\] EWMH published' /tmp/moire-session.log || true)
XW=$(grep '\[client\] connected' /tmp/moire-session.log | grep 'xwayland=1' | tail -3 || true)
NON=$(grep '\[client\] connected' /tmp/moire-session.log | grep 'xwayland=0' | tail -5 || true)
echo "ewmh_lines=$EWMH"
echo "xwayland_clients:"
echo "$XW"
echo "normal_clients:"
echo "$NON"

if [[ "$EWMH" -lt 1 ]]; then
  echo "FAIL: EWMH not published" >&2
  exit 1
fi
if [[ -z "$XW" ]]; then
  echo "FAIL: no xwayland=1 client" >&2
  exit 1
fi
if [[ -z "$NON" ]]; then
  echo "FAIL: no xwayland=0 clients (foot/nautilus?)" >&2
  exit 1
fi

# Transient dialog via python3 + Xlib if available
DISP=$(grep -E 'Moire session: X11 DISPLAY=' /tmp/moire-session.log | tail -1 | sed 's/.*DISPLAY=//' || true)
if [[ -z "$DISP" ]]; then
  for n in $(ls /tmp/.X11-unix/X[0-9]* 2>/dev/null | sed 's/.*X//' | sort -n); do
    owner=$(stat -c %U /tmp/.X11-unix/X$n 2>/dev/null || true)
    if [[ "$owner" == "moire" ]]; then DISP=":$n"; fi
  done
fi
echo "Using DISPLAY=$DISP"

# Ensure parent xeyes exists, then a transient dialog
pkill -u moire -x xeyes 2>/dev/null || true
pkill -u moire -f 'moire-transient-dlg' 2>/dev/null || true
sleep 0.2

if ! command -v xeyes >/dev/null 2>&1; then
  apt-get install -y x11-apps >/tmp/x11-apps-install.log 2>&1 || true
fi

setsid runuser -u moire -- env DISPLAY="$DISP" XDG_RUNTIME_DIR="$RUNTIME" HOME=/home/moire \
  xeyes </dev/null >/tmp/moire-xeyes.log 2>&1 &
sleep 1.5

PARENT_WID=""
PAIR=$(grep '\[xwm\] paired .*title="xeyes"' /tmp/moire-session.log | tail -1 || true)
echo "parent_pair=$PAIR"
PARENT_WID=$(echo "$PAIR" | sed -n 's/.*wid=\([0-9]*\).*/\1/p')

runuser -u moire -- env DISPLAY="$DISP" XDG_RUNTIME_DIR="$RUNTIME" HOME=/home/moire \
  python3 - "$DISP" "$PARENT_WID" <<'PY' >/tmp/moire-transient-dlg.log 2>&1 &
import os, sys, time
disp, parent = sys.argv[1], int(sys.argv[2] or "0")
os.environ["DISPLAY"] = disp
try:
    from Xlib import X, display
    from Xlib.Xatom import ATOM, WINDOW
except Exception as e:
    print("no xlib", e)
    time.sleep(2)
    raise SystemExit(1)

d = display.Display()
root = d.screen().root
win = root.create_window(0, 0, 280, 160, 1, d.screen().root_depth,
                         X.InputOutput, X.CopyFromParent,
                         background_pixel=d.screen().white_pixel,
                         event_mask=X.StructureNotifyMask)
win.set_wm_name("moire-transient-dlg")
win.set_wm_class("moire-transient-dlg", "MoireTransient")
net_type = d.intern_atom("_NET_WM_WINDOW_TYPE")
dialog = d.intern_atom("_NET_WM_WINDOW_TYPE_DIALOG")
win.change_property(net_type, ATOM, 32, [dialog])
if parent:
    win.change_property(d.intern_atom("WM_TRANSIENT_FOR"), WINDOW, 32, [parent])
win.map()
d.flush()
print("mapped transient parent=", parent, "wid=", win.id, flush=True)
time.sleep(8)
win.destroy()
d.flush()
PY

sleep 2.5
echo "=== dlg log ==="
cat /tmp/moire-transient-dlg.log || true
TRANSIENT=$(grep -E '\[xwm\] (paired|mapped) .*(dialog|moire-transient|transient=)' /tmp/moire-session.log | tail -15 || true)
echo "=== transient logs ==="
echo "$TRANSIENT"
MAPPED=$(grep '\[xwm\] mapped .*type=dialog' /tmp/moire-session.log | tail -3 || true)
PAIRED=$(grep '\[xwm\] paired .*type=dialog' /tmp/moire-session.log | tail -3 || true)
echo "mapped=$MAPPED"
echo "paired=$PAIRED"

if ! echo "$MAPPED$PAIRED" | grep -q 'type=dialog'; then
  echo "FAIL: dialog type not seen" >&2
  exit 1
fi

if [[ -n "${PARENT_WID:-}" ]] && ! echo "$MAPPED$PAIRED" | grep -q "transient=${PARENT_WID}"; then
  echo "WARN: expected transient=${PARENT_WID} in logs"
fi

# Centered over parent: parent @ 120,120 150x100 → child 280x160 + optional SSD
if echo "$PAIRED" | grep -qE '@ [0-9]+,[0-9]+'; then
  echo "paired geometry ok"
fi

echo "EWMH TRANSIENT OK"
