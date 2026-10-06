#!/usr/bin/env bash
# Device-free, synthetic broker conversations and owned harmless fixture processes.
set -euo pipefail
task_root="${MOIRE_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$task_root"
task_loader="$task_root/apps/system/compositor/node_modules/tsx/dist/loader.mjs"
[[ -f "$task_loader" ]] || { echo 'Install workspace dependencies before testing.' >&2; exit 1; }
for task_check in \
  session-catalog \
  session-launcher \
  greetd-client \
  login-controller \
  session-lifecycle \
  login-lifecycle; do
  printf '\n[login-lifecycle] %s\n' "$task_check"
  node --import "$task_loader" "apps/system/display-manager/src/$task_check.smoke.ts"
done
