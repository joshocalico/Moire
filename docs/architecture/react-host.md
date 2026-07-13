# react-host

`@moire/react-host` turns React elements into a CPU scene graph (rects, text, images, clips, hits) and rasterizes to ARGB8888.

## Why it exists

Moire shell and `@moire/ui` windows need deterministic software UI without a browser. Yoga (via layout helpers) positions children; react-host owns:

- Reconciliation into a scene tree
- Hit regions for pointer dispatch
- Text measurement and TTF draw
- Blit into a framebuffer or window buffer

## Typical consumers

| Consumer | How |
| --- | --- |
| `@moire/ui` `Window` | `renderShell` → `rasterize` → `platform.present` |
| `@moire/shell` | Direct paint into compositor framebuffer |

Widgets import primitives (`Group`, `Rect`, `Text`, …) from `@moire/react-host` and must not talk to Wayland.

## Related

- [UI overview](../ui/README.md)
- [Architecture overview](./overview.md)
- [Paint & input](./paint-and-input.md)
