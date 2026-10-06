# Image Viewer

Open a local image path or file URL, including an argument from Files. Fit, 100%, zoom, vertical scrolling, horizontal Pan and left/right rotation operate on a private PNG preview. The original file is never rewritten.

FFmpeg decodes PNG, JPEG, WebP, GIF, BMP and TIFF. Animated images show their first frame. SVG, RAW and other formats are explicitly unsupported. Preview dimensions are bounded to 4096 pixels per side.

Package: `apps/bundled/image-viewer`. Launcher: `moire-image-viewer`.
Required guest tools: ffmpeg.

## Verification

```bash
pnpm --filter @moire/image-viewer smoke
pnpm --filter @moire/image-viewer typecheck
```

Real PNG/JPEG decode, file URL, rotation dimensions, unchanged original, corrupt/unsupported files and cleanup. Shared app-tools checks actual load/rotate/zoom/fit controls.

Tests write only disposable fixtures with isolated HOME/XDG directories.
Live focus, overlap, resize, keyboard and output-device acceptance remains open.
