#!/usr/bin/env bash
# Focused persistent queue checks with actual, silent mpv playback.
set -euo pipefail
ROOT="${MOIRE_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"
LOADER="$ROOT/apps/system/compositor/node_modules/tsx/dist/loader.mjs"
[[ -f "$LOADER" ]] || { echo 'Install workspace dependencies before testing.' >&2; exit 1; }
run() { node --import "$LOADER" "$@"; }
if [[ "${1:-}" == --default-window ]]; then
  run apps/bundled/music/src/queue-workflow.smoke.tsx --default-window
  exit
fi
run apps/bundled/music/src/queue-store.smoke.ts
run apps/bundled/music/src/queue-process.smoke.mjs
run apps/bundled/music/src/queue-workflow.smoke.tsx
