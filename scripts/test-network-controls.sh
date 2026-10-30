#!/usr/bin/env bash
# Source/package checks using private buses and synthetic UI input only.
set -euo pipefail
task_root="${MOIRE_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$task_root"
task_loader="$task_root/apps/system/compositor/node_modules/tsx/dist/loader.mjs"
[[ -f "$task_loader" ]] || { echo 'Install workspace dependencies before testing.' >&2; exit 1; }
command -v dbus-daemon >/dev/null || { echo 'Private D-Bus checks require dbus-daemon.' >&2; exit 1; }
export MOIRE_TEST_REAL_DBUS=1
for task_check in \
  packages/dbus/src/signals.smoke.ts \
  packages/system-management/src/vpn-config.smoke.ts \
  packages/prefs/tests/network-proxy.smoke.ts \
  apps/system/management-service/src/network-manager.smoke.ts \
  apps/system/management-service/src/desktop-controls.smoke.ts \
  packages/ui/src/text-field-password.smoke.tsx \
  packages/shell/src/network-details.smoke.tsx \
  packages/shell/src/network-controller.smoke.tsx \
  packages/shell/src/network-presentation.smoke.tsx \
  packages/shell/src/QuickSettingsContent.smoke.tsx \
  packages/shell/src/quick-settings-details.smoke.tsx \
  packages/shell/src/quick-settings.smoke.tsx \
  packages/shell/src/panel-status.smoke.tsx \
  packages/shell/src/popup-frame.smoke.tsx \
  apps/core/settings/src/connections.smoke.tsx; do
  printf '\n[network-controls] %s\n' "$task_check"
  node --import "$task_loader" "$task_check"
done
