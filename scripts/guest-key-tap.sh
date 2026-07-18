#!/usr/bin/env bash
set -euo pipefail

KEY_CODE="${1:?evdev key code required}"

python3 - "$KEY_CODE" <<'PY'
import glob
import os
import struct
import sys
import time

key_code = int(sys.argv[1])
devices = glob.glob("/dev/input/by-path/*event-kbd")
if not devices:
    raise SystemExit("no evdev keyboard found")

EV_SYN, EV_KEY = 0x00, 0x01

def event(fd, kind, code, value):
    now = time.time()
    seconds = int(now)
    micros = int((now - seconds) * 1_000_000)
    fd.write(struct.pack("llHHi", seconds, micros, kind, code, value))

with open(os.path.realpath(devices[0]), "wb", buffering=0) as device:
    event(device, EV_KEY, key_code, 1)
    event(device, EV_SYN, 0, 0)
    time.sleep(0.06)
    event(device, EV_KEY, key_code, 0)
    event(device, EV_SYN, 0, 0)

print(f"tapped key {key_code}")
PY
