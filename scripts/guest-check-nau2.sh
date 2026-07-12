#!/usr/bin/env bash
echo "=== alive ==="
pgrep -af 'nautilus --no-desktop' || echo DEAD
echo "=== wayland configure/commit/error ==="
grep -E 'xdg_.*configure|ack_configure|wl_surface@18.commit|zwp_linux_buffer|create_immed|EGL|GSK|error|critical|warning.*GL|failed' /tmp/moire-nautilus-egl.log | head -60
echo "=== first 40 wayland lines ==="
grep '^\[' /tmp/moire-nautilus-egl.log | head -40
echo "=== GSK ==="
grep -i GSK /tmp/moire-nautilus-egl.log | head -20
echo "=== compositor after nau ==="
grep -E 'Home|Files|Loading|kind=dmabuf|create_immed|created buffer|feedback sent' /tmp/moire-compositor.log | tail -20
