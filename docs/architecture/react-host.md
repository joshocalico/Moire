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
Measured layout helpers allocate children; react-host owns:

- Reconciliation into a scene tree
- Hit regions for pointer, focus, and keyboard dispatch
- Text measurement and TTF draw
- A backend-neutral scene contract
- A deterministic software renderer used by the current presentation paths
- Root commit notifications so timer-, promise-, and subscription-driven React
  state schedules a toolkit window frame without waiting for input

## Typical consumers

| Consumer | How |
| --- | --- |
| `@moire/ui` `Window` | `renderShell` → `SoftwareRenderer` → Wayland dma-buf or SHM presentation |
| `@moire/shell` | Compatibility `rasterize` wrapper into the compositor framebuffer |

Widgets import typed JSX primitives (`Group`, `Rect`, `Text`, …) from
`@moire/react-host` and must not talk to Wayland or a renderer backend. Scene
hit collection is separate from painting, so an EGL renderer can replace the
software output without replacing input or widget code.

Elevated rectangles carry a typed color/blur/offset/spread shadow rather than
pre-painted shadow geometry. This keeps elevation themeable and lets software
use an analytic falloff while a GPU backend maps the same scene property to
its native effect path.

Focusable scene nodes carry a stable focus identity plus focus-change and key
handlers. `@moire/ui` owns traversal and routing; renderers only consume visual
scene properties. This keeps keyboard behavior identical across software and
future EGL presentation paths.

Software scene pixels are premultiplied ARGB. Clip and opacity groups use
bounded offscreen layers, so antialiased text, fades, and translucent drag
previews preserve edge coverage when composed over filled surfaces.

On Wayland, the first accelerated client tranche uploads this software frame
into a pooled GBM/EGL target and attaches it through linux-dmabuf. That is a
transport milestone, not the endpoint: CPU rasterization still happens. The
pool and release contract are deliberately renderer-neutral so the upcoming
EGL scene backend can draw directly into the same targets without changing
widgets, layout, hit testing, or the Wayland protocol path.

## Related

- [UI overview](../ui/README.md)
- [Architecture overview](./overview.md)
- [Paint & input](./paint-and-input.md)
