#!/usr/bin/env bash
# A primary-selection owner disappearing must not take down the compositor.
set -euo pipefail

FILES_PID="$(pgrep -u moire -f 'apps/bundled/files.*tsx src/main.tsx|@moire/files start' | head -n 1)"
COMPOSITOR_PID="$(pgrep -u moire -f '@moire/compositor exec tsx src/main.ts' | head -n 1)"

if [[ -z "$FILES_PID" || -z "$COMPOSITOR_PID" ]]; then
  echo "Files or compositor session process not found" >&2
  exit 1
fi

read_env() {
  local key="$1"
  tr '\0' '\n' < "/proc/$FILES_PID/environ" \
    | sed -n "s/^${key}=//p" \
    | head -n 1
}

RUNTIME="$(read_env XDG_RUNTIME_DIR)"
WAYLAND="$(read_env WAYLAND_DISPLAY)"

if ! command -v wl-copy >/dev/null 2>&1; then
  echo "SKIP: wl-copy is not installed"
  exit 0
fi

disconnect_owner() {
  local label="$1"
  shift
  local token="moire-${label}-disconnect-$$"

  setsid runuser -u moire -- env \
    HOME=/home/moire \
    XDG_RUNTIME_DIR="$RUNTIME" \
    WAYLAND_DISPLAY="$WAYLAND" \
    wl-copy "$@" "$token" \
    </dev/null >"/tmp/moire-${label}-owner.log" 2>&1 &
  local owner_pid=$!

  sleep 0.5
  kill -- "-$owner_pid" 2>/dev/null || true
  wait "$owner_pid" 2>/dev/null || true
  sleep 0.5

  if ! kill -0 "$COMPOSITOR_PID" 2>/dev/null; then
    echo "FAIL: compositor exited after ${label} owner disconnected" >&2
    tail -80 /tmp/moire-session.log >&2 || true
    exit 1
  fi

  if [[ ! -S "$RUNTIME/$WAYLAND" ]]; then
    echo "FAIL: Wayland socket disappeared after ${label} disconnect" >&2
    exit 1
  fi

  echo "PASS: compositor $COMPOSITOR_PID survived ${label} disconnect"
}

disconnect_owner clipboard
disconnect_owner primary-selection --primary
