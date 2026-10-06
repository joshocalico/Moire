#!/usr/bin/env bash
# Source-only greetd protocol and CPU Window workflows. No PAM or native seat activation.
set -euo pipefail
task_root="${MOIRE_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$task_root"
task_loader="$task_root/apps/system/compositor/node_modules/tsx/dist/loader.mjs"
[[ -f "$task_loader" ]] || { echo 'Install workspace dependencies before testing.' >&2; exit 1; }
export MOIRE_UI_PLATFORM=headless
export MOIRE_UI_ACCELERATION=software
for task_source in \
  apps/system/display-manager/src/native-greetd-client.smoke.ts \
  apps/system/greeter/src/native/controller.smoke.ts \
  apps/system/greeter/src/native/view.smoke.tsx \
  apps/system/greeter/src/native/entry.smoke.tsx \
  apps/system/greeter/src/native/wave.smoke.tsx; do
  printf '\n[native-greeter source] %s\n' "$task_source"
  node --import "$task_loader" "$task_source"
done
