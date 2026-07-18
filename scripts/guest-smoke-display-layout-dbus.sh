#!/usr/bin/env bash
set -euo pipefail

PID="$(pgrep -u moire -f '@moire/compositor.*src/main.ts|tsx.*src/main.ts' | head -n 1)"
if [[ -z "$PID" ]]; then
  echo "Moire compositor process not found" >&2
  exit 1
fi
BUS="$(tr '\0' '\n' < "/proc/$PID/environ" | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p' | head -n 1)"
if [[ -z "$BUS" ]]; then
  echo "Compositor D-Bus address not found" >&2
  exit 1
fi

call() {
  runuser -u moire -- env DBUS_SESSION_BUS_ADDRESS="$BUS" \
    gdbus call --session --dest org.moire.Display1 \
    --object-path /org/moire/Display1 --method "org.moire.Display1.$1" "${@:2}"
}

OUTPUTS="$(call ListOutputs)"
echo "$OUTPUTS"
ID="$(sed -n "s/.*('\([^']*\)'.*/\1/p" <<<"$OUTPUTS")"
if [[ -z "$ID" ]]; then
  echo "Could not parse output identity" >&2
  exit 1
fi

# A one-output layout at the canonical origin is intentionally a no-op. It
# still exercises array/struct/bool decoding across Moire's native D-Bus stack.
RESULT="$(call SetLayout "[('$ID', 0, 0, true)]")"
[[ "$RESULT" == "(false,)" ]]
echo "[display-layout-dbus] ok id=$ID"
