#!/usr/bin/env bash
echo "=== feedback / dmabuf / nautilus surfaces ==="
grep -E 'feedback sent|kind=dmabuf|title="Home"|title="Files"|title="Loading|create_immed|created buffer|snapshot failed|dri2|ZINK' /tmp/moire-compositor.log | tail -40
echo "=== nautilus EGL errors? ==="
grep -iE 'dri2|zink|TU:|failed to|EGL|GL_RENDERER|virtio|error' /tmp/moire-nautilus-egl.log | head -30
echo "=== processes ==="
pgrep -af 'nautilus|foot|tsx' | head
