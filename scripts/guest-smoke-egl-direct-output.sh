#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/moire/moire
if [[ ! -d "$ROOT" ]]; then
  ROOT=/media/psf/moire
fi

runuser -u moire -- env \
  HOME=/home/moire \
  MOIRE_RENDER_NODE=/dev/dri/card1 \
  MOIRE_TEST_DIRECT_OUTPUT=1 \
  bash -lc "cd '$ROOT' && pnpm --filter @moire/sys smoke:egl"
