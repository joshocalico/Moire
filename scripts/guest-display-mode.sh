#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-list}"
MODE="${2:-}"

PID="$(pgrep -u moire -f '@moire/compositor exec tsx src/main.ts' | head -n 1)"
if [[ -z "$PID" ]]; then
  echo "Moire compositor is not running" >&2
  exit 1
fi

BUS="$(tr '\0' '\n' < "/proc/$PID/environ" | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p' | head -n 1)"
if [[ -z "$BUS" ]]; then
  echo "Compositor has no session bus address" >&2
  exit 1
fi

case "$ACTION" in
  list)
    runuser -u moire -- env DBUS_SESSION_BUS_ADDRESS="$BUS" \
      gdbus call --session \
      --dest org.moire.Display1 \
      --object-path /org/moire/Display1 \
      --method org.moire.Display1.GetModes
    ;;
  set|try)
    if [[ -z "$MODE" ]]; then
      echo "usage: $0 set WIDTHxHEIGHT@MILLIHZ" >&2
      exit 2
    fi
    runuser -u moire -- env DBUS_SESSION_BUS_ADDRESS="$BUS" \
      gdbus call --session \
      --dest org.moire.Display1 \
      --object-path /org/moire/Display1 \
      --method org.moire.Display1.SetMode "$MODE"
    if [[ "$ACTION" == "set" ]]; then
      runuser -u moire -- env DBUS_SESSION_BUS_ADDRESS="$BUS" \
        gdbus call --session \
        --dest org.moire.Display1 \
        --object-path /org/moire/Display1 \
        --method org.moire.Display1.ConfirmMode
    else
      echo "Mode will revert automatically after 15 seconds unless confirmed"
    fi
    ;;
  *)
    echo "usage: $0 [list | set WIDTHxHEIGHT@MILLIHZ | try WIDTHxHEIGHT@MILLIHZ]" >&2
    exit 2
    ;;
esac
