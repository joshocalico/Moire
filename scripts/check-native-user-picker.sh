#!/usr/bin/env bash
# Source checks only: no VM, host accounts, privileged daemon or session activation.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm --filter @moire/compositor exec tsc --noEmit -p ../../../scripts/tsconfig.native-user-picker.json
for test in user-picker wave view controller entry; do
  case "$test" in controller) extension=ts ;; *) extension=tsx ;; esac
  pnpm --filter @moire/greeter exec tsx "src/native/$test.smoke.$extension"
done
pnpm --filter @moire/compositor exec tsx src/local-users.smoke.ts
pnpm exec oxlint --threads=1 apps/system/greeter/src/native \
  apps/system/compositor/src/local-users.ts apps/system/compositor/src/local-users.smoke.ts
pnpm exec oxfmt --check apps/system/greeter/src/native/local-users.ts \
  apps/system/greeter/src/native/user-selection.ts apps/system/greeter/src/native/user-picker.smoke.tsx \
  apps/system/greeter/src/native/view.tsx apps/system/greeter/src/native/main.tsx \
  apps/system/greeter/src/native/wave.smoke.tsx \
  apps/system/compositor/src/local-users.ts apps/system/compositor/src/local-users.smoke.ts \
  scripts/tsconfig.native-user-picker.json
