#!/usr/bin/env bash
# CPU/public Window login preview, synthetic broker and owned harmless processes only.
set -euo pipefail
task_root="${MOIRE_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$task_root"
task_loader="$task_root/apps/system/compositor/node_modules/tsx/dist/loader.mjs"
[[ -f "$task_loader" ]] || { echo 'Install workspace dependencies before testing.' >&2; exit 1; }
for task_check in view workflow; do
  printf '\n[login-greeter] %s\n' "$task_check"
  node --import "$task_loader" "apps/system/greeter/src/login/$task_check.smoke.tsx"
done
