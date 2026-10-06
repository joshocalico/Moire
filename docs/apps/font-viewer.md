# Font Viewer

Open a TTF, OTF or TTC file. Edit the multiline sample, choose a size and press Preview. The sample is rasterized from the selected font; family/style metadata comes from fontconfig.

Long samples wrap to the available preview width. Previous and Next move
between pages without discarding text. Changing the font, size or sample
starts at the first page; resizing recomputes the page layout. Preview reads
the selected font's glyph metrics and keeps raster images within bounded
dimensions. Fonts larger than 32 MiB are rejected with an error.

Font collections preview their first face. Font installation, WOFF and variable-font axis controls are not implemented. The sample is bounded to 500 characters, with font sizes from 12 to 96.

Package: `apps/bundled/font-viewer`. Launcher: `moire-font-viewer`.
Required guest tools: fc-scan from fontconfig and ffmpeg with drawtext support.

## Verification

```bash
pnpm --filter @moire/font-viewer smoke
pnpm --filter @moire/font-viewer typecheck
```

Actual bundled font family/style and distinct sample/size rasterization, unsupported formats and private preview cleanup.

Tests write only disposable fixtures with isolated HOME/XDG directories.
Live focus, overlap, resize, keyboard and output-device acceptance remains open.
