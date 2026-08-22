#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/moire/moire
if [[ ! -d "$ROOT" ]]; then
  ROOT=/media/psf/moire
fi

sg render -c "runuser -u moire -- env HOME=/home/moire bash -lc 'cd $ROOT && pnpm --filter @moire/sys smoke:egl'"
