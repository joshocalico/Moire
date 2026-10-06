# Symbolic icons

Moire's symbolic artwork lives in `packages/ui/icons`. Each SVG uses a 24 × 24
viewBox and a single `currentColor` tint. The shared `Icon` widget renders it
through `loadSvgIconSync`, so the same artwork serves controls, application
identity and launcher entries at different sizes and in different themes.

## Artwork rules

- Keep the visible outline inside the viewBox, including the stroke. Ordinary
  bounds lie between 3 and 21; narrow projections may reach 2.5 or 21.5.
- Use a 1.7-unit optical stroke, rounded line caps and joins, and simple contours.
  Rounded rectangles generally use a radius between 2 and 3.
- Use filled dots and play indicators sparingly. A filled-folder variant remains
  available for collection artwork.
- Check 16, 20, 24 and 32 pixels on both light and dark backgrounds. Fine details
  must not merge into an indistinct block at the smaller sizes.
- Use an object or activity that identifies the application. Do not substitute
  an unrelated initial, emoji or generic document for an application identity.
  A deliberately drawn typography specimen is appropriate for Font.

The loader supports `rect`, `circle`, `line`, `polyline` and `polygon`. It reads
root paint attributes and per-shape overrides. It does not interpret paths,
groups, transforms, text, gradients, masks or external references. Every visible
shape receives the requested tint; literal multi-colour artwork is unsupported.
The rasterizer uses 4 × 4 subpixel coverage samples per output pixel.

The native rectangle stroke lies inside its bounds. Circle and segment strokes
are centred on their geometry. Allow for that difference when choosing bounds
and holes; an ordinary SVG browser preview alone does not prove native results.
Segment-distance rasterization produces rounded ends and joins. Polygon fills
are closed; an open contour must use a polyline.

## Application identities

| Name | Symbol |
| --- | --- |
| `editor` | Diagonal pencil with separate nib and cap |
| `notes` | Bound notebook with ruled content |
| `calculator` | Display above a compact keypad |
| `archive` | Archive box with a zipper pull |
| `monitor` | Display with an activity trace |
| `calendar` | Bound date sheet with a day grid |
| `clock` | Clock face and hands |
| `screenshot` | Capture corners around a camera |
| `document` | Folded page with image and text regions |
| `video` | Film edge and a filled play indicator |
| `disk-usage` | Proportional storage treemap |
| `font` | Drawn serif specimen with crossbar and baseline serifs |
| `characters` | Palette of distinct geometric glyphs |
| `colors` | Paint palette with colour wells |
| `recorder` | Microphone and stand |
| `weather` | Sun and cloud |
| `dictionary` | Open reference book and magnifier |
| `help` | Life ring |

The existing navigation family uses the same optical stroke. Home has one
continuous door contour instead of overlapping baseline strokes. Settings has
an evenly spaced eight-tooth gear and a clear central aperture. Music, More
and native window-control artwork retain their separately owned designs.

## Verification

The normal-size atlas is saved at
`vm/verification/2026-10-02-app-suite/icon-family-v1/atlas.png`. It renders the
actual shared `Icon` widget in a headless Window, using both tints at all four
sizes. Its evidence script also checks supported primitives, painted coverage
and inset pixel bounds through the real SVG loader. Raster metrics and asset
hashes sit alongside the atlas.

Run from the repository root:

```sh
pnpm exec tsx vm/verification/2026-10-02-app-suite/icon-family-v1/render-atlas.tsx
```

The central application identity mapping and themed icon atlas regression are
maintained separately from these assets. Native desktop review remains necessary
for optical size in a particular toolbar or launcher allocation.
