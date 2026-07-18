#!/usr/bin/env bash
set -euo pipefail

TARGET_X="${1:?target x required}"
TARGET_Y="${2:?target y required}"
DELTA_X="${3:?delta x required}"
DELTA_Y="${4:?delta y required}"

python3 - "$TARGET_X" "$TARGET_Y" "$DELTA_X" "$DELTA_Y" <<'PY'
import struct
import sys
import time

target_x, target_y, delta_x, delta_y = map(int, sys.argv[1:])
EV_SYN, EV_KEY, EV_REL = 0x00, 0x01, 0x02
REL_X, REL_Y, BTN_LEFT = 0, 1, 0x110

def event(fd, kind, code, value):
    now = time.time()
    seconds = int(now)
    micros = int((now - seconds) * 1_000_000)
    fd.write(struct.pack("llHHi", seconds, micros, kind, code, value))

def move(fd, dx, dy, step=40):
    while dx or dy:
        sx = max(-step, min(step, dx))
        sy = max(-step, min(step, dy))
        if sx:
            event(fd, EV_REL, REL_X, sx)
            dx -= sx
        if sy:
            event(fd, EV_REL, REL_Y, sy)
            dy -= sy
        event(fd, EV_SYN, 0, 0)
        time.sleep(0.004)

with open("/dev/input/event2", "wb", buffering=0) as device:
    move(device, -8000, -8000, step=200)
    move(device, target_x, target_y)
    event(device, EV_KEY, BTN_LEFT, 1)
    event(device, EV_SYN, 0, 0)
    time.sleep(0.05)
    move(device, delta_x, delta_y)
    event(device, EV_KEY, BTN_LEFT, 0)
    event(device, EV_SYN, 0, 0)

print(f"dragged from {target_x},{target_y} by {delta_x},{delta_y}")
PY
