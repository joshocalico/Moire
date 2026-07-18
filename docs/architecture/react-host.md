# react-host

`@moire/react-host` reconciles React elements into a retained, renderer-neutral
scene graph (rects, text, images, clips, and hits). `SoftwareRenderer` currently
renders that scene to ARGB8888; other backends implement the same
`RendererBackend` contract.

The first renderer-neutral geometry properties are rounded rectangle radius,
stroke color, and stroke width. The software backend implements them directly;
an EGL backend can map the same scene properties to batched geometry or
shaders.

## Why it exists

Moire shell and `@moire/ui` windows need deterministic UI without a browser.
Yoga (via layout helpers) positions children; react-host owns:

- Reconciliation into a scene tree
- Hit regions for pointer, focus, and keyboard dispatch
- Text measurement and TTF draw
- A backend-neutral scene contract
- A deterministic software renderer used by the current presentation paths

## Typical consumers

| Consumer | How |
| --- | --- |
| `@moire/ui` `Window` | `renderShell` → `SoftwareRenderer` → `platform.present` |
| `@moire/shell` | Compatibility `rasterize` wrapper into the compositor framebuffer |

Widgets import typed JSX primitives (`Group`, `Rect`, `Text`, …) from
`@moire/react-host` and must not talk to Wayland or a renderer backend. Scene
hit collection is separate from painting, so an EGL renderer can replace the
software output without replacing input or widget code.

Focusable scene nodes carry a stable focus identity plus focus-change and key
handlers. `@moire/ui` owns traversal and routing; renderers only consume visual
scene properties. This keeps keyboard behavior identical across software and
future EGL presentation paths.

## Related

- [UI overview](../ui/README.md)
- [Architecture overview](./overview.md)
- [Paint & input](./paint-and-input.md)
