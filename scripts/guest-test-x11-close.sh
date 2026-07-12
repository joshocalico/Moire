#!/usr/bin/env bash
# Verify SSD close sends WM_DELETE_WINDOW (xeyes exits cleanly).
set -euo pipefail
RUNTIME=/home/moire/.moire-runtime
MARK="CLOSE-TEST-$(date +%s)"
echo "=== $MARK ===" >> /tmp/moire-session.log

if ! command -v xeyes >/dev/null 2>&1; then
  apt-get install -y x11-apps >/tmp/x11-apps-install.log 2>&1 || true
fi
if ! command -v xeyes >/dev/null 2>&1; then
  echo "xeyes not found" >&2
  exit 1
fi

COMP_PID=$(pgrep -u moire -f 'node /bin/pnpm .*tsx src/main' | head -1 || true)
if [[ -z "${COMP_PID:-}" ]]; then
  COMP_PID=$(pgrep -u moire -f 'tsx src/main' | head -1 || true)
fi
DISP=""
if [[ -n "${COMP_PID:-}" && -r /proc/$COMP_PID/environ ]]; then
  DISP=$(tr '\0' '\n' < /proc/$COMP_PID/environ | sed -n 's/^DISPLAY=//p' | head -1 || true)
fi
if [[ -z "${DISP:-}" ]]; then
  DISP=$(grep -E 'Moire session: X11 DISPLAY=' /tmp/moire-session.log | tail -1 | sed 's/.*DISPLAY=//' || true)
fi
if [[ -z "${DISP:-}" ]]; then
  for n in $(ls /tmp/.X11-unix/X[0-9]* 2>/dev/null | sed 's/.*X//' | sort -n); do
    owner=$(stat -c %U /tmp/.X11-unix/X$n 2>/dev/null || true)
    if [[ "$owner" == "moire" ]]; then DISP=":$n"; fi
  done
fi
if [[ -z "${DISP:-}" ]]; then
  echo "No DISPLAY — is the session running?" >&2
  exit 1
fi
echo "Using DISPLAY=$DISP"

pkill -u moire -x xeyes 2>/dev/null || true
sleep 0.3

setsid runuser -u moire -- env \
  DISPLAY="$DISP" \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  xeyes \
  </dev/null >/tmp/moire-xeyes.log 2>&1 &

# Wait for XWM pair line after MARK
PAIR=""
for _ in $(seq 1 40); do
  sleep 0.25
  PAIR=$(awk -v m="$MARK" 'index($0,m){f=1} f && /\[xwm\] paired .*title=.*[Xx]eyes/{print; exit}' /tmp/moire-session.log || true)
  if [[ -z "$PAIR" ]]; then
    PAIR=$(awk -v m="$MARK" 'index($0,m){f=1} f && /\[xwm\] paired /{print; exit}' /tmp/moire-session.log || true)
  fi
  if [[ -n "$PAIR" ]] && pgrep -u moire -x xeyes >/dev/null; then
    break
  fi
done

echo "pair=$PAIR"
if [[ -z "$PAIR" ]]; then
  echo "xeyes did not pair" >&2
  grep -E '\[xwm\]|xeyes' /tmp/moire-session.log | tail -30 || true
  exit 1
fi

# Parse "@ x,y" and "WxH" from paired line
# e.g. [xwm] paired wid=… surface=… 150x100 @ 80,64 deco=server title="…"
geom=$(echo "$PAIR" | sed -n 's/.* \([0-9][0-9]*\)x\([0-9][0-9]*\) @ \([0-9-][0-9]*\),\([0-9-][0-9]*\).*/\1 \2 \3 \4/p')
read -r W H SX SY <<<"$geom"
if [[ -z "${W:-}" || -z "${SX:-}" ]]; then
  echo "could not parse geometry from: $PAIR" >&2
  exit 1
fi

# SSD close button center (matches server.ts / TitleBar.tsx)
TITLEBAR_H=32
BTN=28
PAD=6
CX=$(( SX + W - PAD - BTN / 2 ))
CY=$(( SY + TITLEBAR_H / 2 ))
echo "click close at $CX,$CY (frame @ $SX,$SY ${W}x${H})"

python3 - "$CX" "$CY" <<'PY'
import sys, time, struct
tx, ty = int(sys.argv[1]), int(sys.argv[2])
EV_REL, EV_KEY, EV_SYN = 0x02, 0x01, 0x00
REL_X, REL_Y = 0, 1
BTN_LEFT = 0x110

def wev(fd, typ, code, value):
    t = time.time(); sec = int(t); usec = int((t - sec) * 1e6)
    fd.write(struct.pack("llHHi", sec, usec, typ, code, value)); fd.flush()

def move_by(fd, dx, dy, step=40):
    while dx != 0 or dy != 0:
        sx = max(-step, min(step, dx))
        sy = max(-step, min(step, dy))
        if sx:
            wev(fd, EV_REL, REL_X, sx); dx -= sx
        if sy:
            wev(fd, EV_REL, REL_Y, sy); dy -= sy
        wev(fd, EV_SYN, 0, 0)
        time.sleep(0.002)

fd = open("/dev/input/event2", "wb", buffering=0)
# Home cursor to top-left (relative-only mouse)
move_by(fd, -8000, -8000, step=200)
time.sleep(0.05)
move_by(fd, tx, ty)
time.sleep(0.08)
wev(fd, EV_KEY, BTN_LEFT, 1); wev(fd, EV_SYN, 0, 0)
time.sleep(0.05)
wev(fd, EV_KEY, BTN_LEFT, 0); wev(fd, EV_SYN, 0, 0)
fd.close()
print("clicked")
PY

sleep 1
EYES=$(pgrep -u moire -x xeyes || true)
echo "xeyes_after=${EYES:-DEAD}"
echo "=== close logs ==="
awk -v m="$MARK" 'index($0,m){f=1} f && /(\[ssd\] close|\[xwm\] close)/{print}' /tmp/moire-session.log | tail -20

if [[ -n "${EYES:-}" ]]; then
  echo "FAIL: xeyes still running" >&2
  exit 1
fi
echo "X11 CLOSE OK"
