#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-list}"
MODE="${2:-}"

# set and try change the mode, which org.moire.Display1 allows only Settings: they need root's
# test-image grant (scripts/guest-display-grant.sh). list, output and outputs read only.
if [[ "$ACTION" == "set" || "$ACTION" == "try" ]]; then
  # shellcheck source=guest-display-grant.sh
  source "$(dirname "${BASH_SOURCE[0]}")/guest-display-grant.sh"
fi

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
  output)
    runuser -u moire -- env DBUS_SESSION_BUS_ADDRESS="$BUS" \
      gdbus call --session \
      --dest org.moire.Display1 \
      --object-path /org/moire/Display1 \
      --method org.moire.Display1.GetOutputInfo
    ;;
  outputs)
    runuser -u moire -- env DBUS_SESSION_BUS_ADDRESS="$BUS" \
      gdbus call --session \
      --dest org.moire.Display1 \
      --object-path /org/moire/Display1 \
      --method org.moire.Display1.ListOutputs
    ;;
  set|try)
    if [[ -z "$MODE" ]]; then
      echo "usage: $0 $ACTION WIDTHxHEIGHT@MILLIHZ" >&2
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
    echo "usage: $0 [list | output | outputs | set WIDTHxHEIGHT@MILLIHZ | try WIDTHxHEIGHT@MILLIHZ]" >&2
    exit 2
    ;;
esac
