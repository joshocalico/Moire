#!/usr/bin/env bash
# Sample compositor CPU (real tsx worker, not pnpm wrapper).
set -euo pipefail
# Prefer the innermost node running src/main.ts
PID=$(
  ps -u moire -o pid=,cmd= | awk '
    /tsx\/dist\/preflight\.cjs/ && /src\/main\.ts/ { print $1; exit }
  '
)
if [[ -z "${PID:-}" ]]; then
  PID=$(
    ps -u moire -o pid=,pcpu=,cmd= --sort=-pcpu | awk '
      /src\/main\.ts/ && $0 !~ /pnpm/ { print $1; exit }
    '
  )
fi
if [[ -z "${PID:-}" ]]; then
  echo "no compositor pid" >&2
  exit 1
fi
echo "compositor_pid=$PID"
ps -p "$PID" -o pid,pcpu,pmem,rss,etime,cmd=
python3 - "$PID" <<'PY'
import os, sys, time, struct
pid = int(sys.argv[1])
hz = os.sysconf(os.sysconf_names["SC_CLK_TCK"])

def cpu_times(pid):
    with open(f"/proc/{pid}/stat") as f:
        parts = f.read().split()
    return int(parts[13]) + int(parts[14])

def sample(seconds):
    t0 = time.time(); c0 = cpu_times(pid)
    time.sleep(seconds)
    t1 = time.time(); c1 = cpu_times(pid)
    return ((c1 - c0) / hz) / (t1 - t0) * 100.0

print(f"idle_cpu_pct={sample(4.0):.1f}")

EV_REL, EV_SYN = 0x02, 0x00
fd = open("/dev/input/event2", "wb", buffering=0)
def wev(typ, code, value):
    t = time.time(); sec = int(t); usec = int((t - sec) * 1e6)
    fd.write(struct.pack("llHHi", sec, usec, typ, code, value)); fd.flush()

t0 = time.time(); c0 = cpu_times(pid)
end = t0 + 3.0
direction = -1
next_turn = t0 + 0.4
while time.time() < end:
    now = time.time()
    if now >= next_turn:
        direction *= -1
        next_turn = now + 0.4
    wev(EV_REL, 0, 4 * direction)
    wev(EV_REL, 1, 3 * direction)
    wev(EV_SYN, 0, 0)
    time.sleep(0.016)
fd.close()
t1 = time.time(); c1 = cpu_times(pid)
print(f"motion_cpu_pct={((c1 - c0) / hz) / (t1 - t0) * 100.0:.1f}")
PY
