#!/usr/bin/env bash
set -euo pipefail
export HOME=/home/moire
export XDG_RUNTIME_DIR=/run/user/$(id -u moire)

echo "===== groups ====="
id

echo "===== open render ====="
python3 - <<'PY'
import os
for p in ["/dev/dri/card1","/dev/dri/renderD128"]:
  try:
    fd=os.open(p, os.O_RDWR|os.O_CLOEXEC)
    print(p, "OK")
    os.close(fd)
  except OSError as e:
    print(p, "FAIL", e)
PY

echo "===== eglinfo default ====="
eglinfo 2>&1 | head -60 || true

echo "===== eglinfo MESA_LOADER_DRIVER_OVERRIDE=virtio_gpu ====="
MESA_LOADER_DRIVER_OVERRIDE=virtio_gpu LIBGL_DEBUG=verbose eglinfo 2>&1 | head -80 || true

echo "===== eglinfo GALLIUM_DRIVER=virgl ====="
GALLIUM_DRIVER=virgl LIBGL_DEBUG=verbose eglinfo 2>&1 | head -80 || true

echo "===== vulkaninfo --summary ====="
vulkaninfo --summary 2>&1 | head -80 || true

echo "===== VK_ICD_FILENAMES=virtio only ====="
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/virtio_icd.json vulkaninfo --summary 2>&1 | head -40 || true

echo "===== dri drivers present ====="
ls /usr/lib/aarch64-linux-gnu/dri/ | grep -iE 'virtio|virgl|kms|swrast|zink' || ls /usr/lib/aarch64-linux-gnu/dri/ | head
