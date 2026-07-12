#!/usr/bin/env bash
echo "=== procs ==="
ps -eo pid,etime,cmd | grep -E 'tsx src/main|[/]foot' | grep -v grep || echo none
echo "=== log bytes ==="
wc -c /tmp/moire-compositor.log
echo "=== composite ==="
grep composite /tmp/moire-compositor.log | tail -15 || echo none
echo "=== errors ==="
grep -i error /tmp/moire-compositor.log | tail -15 || echo none
echo "=== last 20 ==="
tail -20 /tmp/moire-compositor.log
