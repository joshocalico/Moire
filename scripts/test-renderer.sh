#!/usr/bin/env bash
# Run actual renderer and transfer regressions with the selected Linux DRM node.
set -euo pipefail
root="${MOIRE_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$root"
loader="$root/apps/system/compositor/node_modules/tsx/dist/loader.mjs"
[[ -f "$loader" ]] || { echo 'Install workspace dependencies before testing.' >&2; exit 1; }
run() { node --import "$loader" "$1"; }
run packages/sys/src/scanout-presentation.smoke.ts
run packages/sys/src/egl-capability.smoke.ts
run packages/sys/src/egl-client-pool.smoke.mjs
run packages/sys/src/gbm-import.smoke.ts
run packages/sys/src/kms-output-availability.smoke.ts
run packages/core/src/output-availability.smoke.ts
run packages/core/src/zero-output-geometry.smoke.ts
run packages/core/src/window-border.smoke.ts
run packages/core/src/window-content-shape.smoke.ts
run packages/core/src/keyboard-ownership.smoke.ts
run packages/sys/src/keyboard-grab.smoke.ts
# This crosses the actual libdrm callback ABI using a private C fixture.
# The build/test machine needs an existing C compiler; it never modesets a card.
run packages/sys/src/page-flip-events.smoke.ts
run packages/core/src/surface-transfer.smoke.ts
run packages/core/src/surface-visibility.smoke.ts
run packages/core/src/surface-visibility-wire.smoke.ts
run packages/core/src/rendering-authority.smoke.ts
run packages/core/src/rendering-source.native.smoke.ts
run packages/core/src/dmabuf-failure.native.smoke.ts
run packages/ui/src/platforms/wayland/surface-visibility.smoke.ts
run packages/ui/src/platforms/wayland/rendering.smoke.ts
run packages/ui/src/platforms/wayland/shm-format.smoke.ts
run packages/core/src/resident-source.smoke.ts
run packages/core/src/dmabuf-map.smoke.ts
run packages/ui/src/frame-baseline.smoke.ts
run packages/ui/scripts/retained-alpha.smoke.tsx
run packages/ui/scripts/process-row-reconciliation.smoke.tsx
if [[ "$(uname -s)" != Linux ]]; then
  node --import "$loader" packages/ui/scripts/retained-table-egl.smoke.tsx --cpu-only
  echo 'Native EGL and GBM checks require Linux; CPU checks passed.'
  exit 0
fi
export MOIRE_GPU_METRICS=1
MOIRE_TEST_CONTENT_SHAPE_EGL=1 run packages/core/src/window-content-shape.smoke.ts
run packages/ui/src/platforms/wayland/shm-format.native.smoke.tsx
run packages/sys/src/egl-resident.smoke.ts
run packages/sys/src/egl-capability.native.smoke.ts
run packages/sys/src/gbm-import.native.smoke.ts
run packages/sys/src/egl-publication.smoke.ts
MOIRE_TEST_GBM_BLACK=1 run packages/core/src/dmabuf-map.smoke.ts
run packages/ui/scripts/retained-table-egl.smoke.tsx
