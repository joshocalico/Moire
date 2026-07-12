#!/usr/bin/env bash
echo "=== log size ==="
wc -l /tmp/moire-nautilus-egl.log
echo "=== last 60 lines ==="
tail -60 /tmp/moire-nautilus-egl.log
echo "=== exit / fatal ==="
grep -iE 'trace/breakpoint|Segmentation|Aborted|fatal|Gdk-ERROR|Gtk-ERROR|exit|Cannot|failed to create|swap|dma' /tmp/moire-nautilus-egl.log | tail -30
