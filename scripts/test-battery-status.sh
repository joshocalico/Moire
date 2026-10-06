#!/usr/bin/env bash
# C46: private read-only backend fixtures and synthetic desktop workflows.
set -euo pipefail
task_root="${MOIRE_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$task_root"
task_loader="$task_root/apps/system/compositor/node_modules/tsx/dist/loader.mjs"
[[ -f "$task_loader" ]] || { echo 'Install workspace dependencies before testing.' >&2; exit 1; }
command -v dbus-daemon >/dev/null || { echo 'Private D-Bus checks require dbus-daemon.' >&2; exit 1; }
for task_check in \
  apps/system/management-service/src/upower-battery.smoke.ts \
  apps/system/management-service/src/desktop-controls.smoke.ts \
  packages/shell/src/battery-status.smoke.tsx \
  packages/shell/src/QuickSettingsContent.smoke.tsx \
  packages/shell/src/quick-settings-details.smoke.tsx \
  packages/shell/src/quick-settings.smoke.tsx \
  packages/shell/src/panel-status.smoke.tsx; do
  printf '\n[battery-status] %s\n' "$task_check"
  node --import "$task_loader" "$task_check"
done
