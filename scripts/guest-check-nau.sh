#!/usr/bin/env bash
echo "=== compositor recent ==="
tail -80 /tmp/moire-compositor.log
echo "=== nautilus renderer hints ==="
grep -iE 'renderer|GSK|GL_RENDERER|cairo|vulkan|virtio|dri2|zink|fd -1' /tmp/moire-nautilus-egl.log | head -40 || true
echo "=== globals we advertise ==="
grep -n 'zwp_linux_dmabuf\|wl_drm\|feedback\|CORE_GLOBALS' /home/moire/moire/packages/protocol/src/index.ts | head
