#!/usr/bin/env bash
# Exercise the desktop handoff on a disposable bus, without starting graphics.
set -euo pipefail
ROOT="${MOIRE_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOADER="${MOIRE_TEST_LOADER:-$ROOT/apps/system/compositor/node_modules/tsx/dist/loader.mjs}"
[[ "$(uname -s)" == Linux ]] || { echo 'The session handoff smoke requires Linux.' >&2; exit 1; }
[[ -f "$LOADER" ]] || { echo "Missing tsx loader: $LOADER" >&2; exit 1; }
[[ -f "$ROOT/apps/system/session/src/desktop.smoke.ts" ]] || { echo "Missing session handoff smoke under $ROOT." >&2; exit 1; }
for tool in node dbus-run-session setsid timeout; do
  command -v "$tool" >/dev/null || { echo "Missing required command: $tool" >&2; exit 1; }
done

# Use an existing daemon/config pair. Nix's daemon may expect /etc/dbus-1,
# whereas an Ubuntu host keeps its session configuration under /usr/share.
dbus_daemon=''
dbus_config=''
for candidate in /usr/bin/dbus-daemon "$(command -v dbus-daemon || true)"; do
  [[ -x "$candidate" ]] || continue
  if [[ "$candidate" == /usr/bin/dbus-daemon ]]; then
    configs=(/usr/share/dbus-1/session.conf /etc/dbus-1/session.conf)
  else
    prefix=$(dirname "$(dirname "$(readlink -f "$candidate")")")
    configs=("$prefix/share/dbus-1/session.conf" "$prefix/etc/dbus-1/session.conf")
  fi
  for config in "${configs[@]}"; do
    if [[ -r "$config" ]]; then
      dbus_daemon="$candidate"
      dbus_config="$config"
      break 2
    fi
  done
  printf '[session/handoff] no session config beside %s (checked %s)\n' "$candidate" "${configs[*]}" >&2
done
[[ -n "$dbus_daemon" && -n "$dbus_config" ]] || {
  echo 'No readable session configuration found for an available D-Bus daemon.' >&2
  exit 1
}

fixture=$(mktemp -d /tmp/moire-session-handoff.XXXXXXXX)
runner_pid=''
cleanup() {
  if [[ -n "$runner_pid" ]]; then
    # This group was created by setsid for this test only. Never signal a host
    # session bus, compositor, or application outside the disposable launch.
    kill -TERM -- "-$runner_pid" 2>/dev/null || true
    kill -KILL -- "-$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
  fi
  rm -rf "$fixture"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
export HOME="$fixture/home" XDG_CONFIG_HOME="$fixture/config"
export XDG_DATA_HOME="$fixture/data" XDG_CACHE_HOME="$fixture/cache"
export XDG_RUNTIME_DIR="$fixture/runtime" TMPDIR="$fixture/tmp"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR" "$TMPDIR"
chmod 700 "$XDG_RUNTIME_DIR"
unset DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID DBUS_SESSION_BUS_WINDOWID
printf '[session/handoff] root %s; loader %s\n' "$ROOT" "$LOADER"
printf '[session/handoff] daemon %s; existing config %s\n' "$dbus_daemon" "$dbus_config"
cd "$ROOT"
setsid timeout --signal=TERM --kill-after=2s 30s \
  dbus-run-session --dbus-daemon="$dbus_daemon" --config-file="$dbus_config" -- \
  node --import "$LOADER" apps/system/session/src/desktop.smoke.ts &
runner_pid=$!
wait "$runner_pid"
