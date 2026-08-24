# Moire Bench

Moire Bench is a native `@moire/ui` diagnostics application. It reports facts
from the platform backend serving its own window, including the selected
Wayland presentation path, render node, EGL/GL identity, frame counters,
protocol globals, and separate client/compositor CPU information.

The Timeline tab retains the latest samples and charts client/compositor CPU,
submitted/composited/presented frame rates, scene/raster/submit work, SHM copy
and buffer-release latency, and resident memory using the same public chart
widgets as other Moire applications.

The Overview tab includes a five-second retained-scene workload paced by
`wl_surface.frame`. Its Auto/EGL/SHM selector runs the same scene through each
available transport. Results distinguish submission, compositor callbacks,
`wp_presentation` feedback, discarded frames, CPU time, and peak resident
memory. Presentation cadence includes p50/p95 intervals, feedback latency,
and the damaged share of each surface. It is a
comparative smoke benchmark rather than a substitute for a
profiler.

Run it in a Moire session with:

```sh
pnpm --filter @moire/benchmark start
```

The in-app selector can compare the SHM fallback with automatic EGL/dma-buf.
`MOIRE_UI_ACCELERATION=software` remains useful for launching with EGL probing
disabled entirely.

Set `MOIRE_BENCH_AUTORUN=1` for an unattended five-second smoke run.
