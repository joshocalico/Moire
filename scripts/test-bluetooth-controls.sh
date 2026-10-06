#!/usr/bin/env bash
# Observations, pairing input and explicit trust checks use private buses and public Window fixtures.
set -euo pipefail
task_root="${MOIRE_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$task_root"
task_loader="$task_root/apps/system/compositor/node_modules/tsx/dist/loader.mjs"
[[ -f "$task_loader" ]] || { echo 'Install workspace dependencies before testing.' >&2; exit 1; }
command -v dbus-daemon >/dev/null || { echo 'Private D-Bus checks require dbus-daemon.' >&2; exit 1; }
export MOIRE_TEST_REAL_DBUS=1
for task_check in \
  packages/system-management/src/bluetooth-status.smoke.ts \
  apps/system/management-service/src/bluez-bluetooth.smoke.ts \
  apps/system/management-service/src/bluez-pairing.smoke.ts \
  apps/system/management-service/src/desktop-controls.smoke.ts \
  packages/shell/src/bluetooth-details.smoke.tsx \
  packages/shell/src/bluetooth-controller.smoke.tsx; do
  printf '\n[bluetooth-controls] %s\n' "$task_check"
  node --import "$task_loader" "$task_check"
done
