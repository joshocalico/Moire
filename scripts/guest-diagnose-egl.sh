#!/usr/bin/env bash
# Diagnose why EGL/GTK fail on MoireDev (Parallels virtio-GPU).
set -euo pipefail
echo "======== identity / groups ========"
id moire
echo
echo "======== /dev/dri ========"
ls -la /dev/dri/
echo
echo "======== DRM device info (libdrm) ========"
for n in /dev/dri/card* /dev/dri/renderD*; do
  [ -e "$n" ] || continue
  echo "--- $n ---"
  # readable?
  if runuser -u moire -- test -r "$n"; then echo "moire: readable"; else echo "moire: NOT readable"; fi
  if runuser -u moire -- test -w "$n"; then echo "moire: writable"; else echo "moire: NOT writable"; fi
done
echo
echo "======== kernel DRM drivers ========"
dmesg 2>/dev/null | grep -iE 'drm|virtio|gpu|vgem|vkms' | tail -40 || true
lsmod | grep -iE 'drm|virtio|gpu|ttm|vram' || true
echo
echo "======== sysfs DRM ========"
for d in /sys/class/drm/card*/device; do
  echo "--- $d ---"
  cat "$d/uevent" 2>/dev/null || true
  cat "$d/vendor" 2>/dev/null; cat "$d/device" 2>/dev/null; echo
  readlink -f "$d/driver" 2>/dev/null || true
done
echo
echo "======== mesa packages ========"
dpkg -l 'libgl1-mesa*' 'mesa-vulkan*' 'libegl*' 'libgbm*' 2>/dev/null | grep '^ii' | awk '{print $2,$3}'
echo
echo "======== EGL ICD / GLVND ========"
ls -la /usr/share/glvnd/egl_vendor.d/ 2>/dev/null || true
ls -la /usr/share/egl/egl_external_platform.d/ 2>/dev/null || true
cat /usr/share/glvnd/egl_vendor.d/*.json 2>/dev/null || true
echo
echo "======== Vulkan ICDs ========"
ls -la /usr/share/vulkan/icd.d/ 2>/dev/null || true
cat /usr/share/vulkan/icd.d/*.json 2>/dev/null || true
echo
echo "======== render node open as moire (sg render) ========"
sg render -c 'runuser -u moire -- python3 - <<"PY"
import os, errno
for p in ["/dev/dri/card1","/dev/dri/renderD128"]:
  try:
    fd=os.open(p, os.O_RDWR|os.O_CLOEXEC)
    print(p, "OPEN ok fd=", fd)
    os.close(fd)
  except OSError as e:
    print(p, "OPEN fail", e)
PY'
echo
echo "======== EGL info (as moire + render) ========"
sg render -c 'runuser -u moire -- env LIBGL_DEBUG=verbose MESA_DEBUG=1 EGL_LOG_LEVEL=debug \
  eglinfo 2>&1' | head -80 || true
echo
echo "======== glxinfo / es2_info if present ========"
sg render -c 'runuser -u moire -- es2_info 2>&1' | head -40 || true
echo
echo "======== vulkaninfo summary ========"
sg render -c 'runuser -u moire -- vulkaninfo --summary 2>&1' | head -60 || true
echo
echo "======== weston-simple-dmabuf-egl dry ========"
sg render -c 'runuser -u moire -- env WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR=/run/user/$(id -u moire) \
  weston-simple-dmabuf-egl 2>&1' | head -20 &
sleep 1
pkill -u moire -x weston-simple-dmabuf-egl 2>/dev/null || true
wait 2>/dev/null || true
echo
echo "======== modinfo virtio-gpu ========"
modinfo virtio-gpu 2>/dev/null | head -25 || true
