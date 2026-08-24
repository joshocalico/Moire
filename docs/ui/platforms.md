# Platforms

## Selection

```ts
resolvePlatformKind();
// 1. MOIRE_UI_PLATFORM=wayland|headless
// 2. else WAYLAND_DISPLAY + linux → wayland
// 3. else headless
```

`createPlatformBackend(kind?)` is used by `Application.run()`; apps rarely call it directly.

## Interface

`PlatformBackend`: `connect`, `createWindow`, `pump`, `disconnect`.

`PlatformWindow`: `present(ARGB pixels)`, configure/close/pointer/key callbacks, `setTitle` / `setSize` / `destroy`.

The pixel argument is the portable hand-off today, not the permanent renderer
boundary. The Wayland backend can upload that frame into a renderer-owned EGL
target and attach the exported dma-buf. This gives the client path durable GPU
buffer/release semantics while the retained scene renderer is migrated away
from CPU rasterization one primitive family at a time.

Optional `DndCapable.startDrag(mimeTypes, getPayload, serial)` — Wayland implements this; widgets talk through `setDndBridge` instead of casting the backend.

## Wayland

Path: `packages/ui/src/platforms/wayland/index.ts`.

- Linux only; Moire's TypeScript client owns the Unix socket at
  `$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY`, ancillary-FD transport, object IDs,
  framing and dispatch. It does not load libwayland.
- Request encoders, event decoders, opcodes, versions, enums and destructor
  metadata are generated from `wayland.xml`, stable xdg-shell, xdg-decoration
  and linux-dmabuf XML into `@moire/protocol/generated`. The generated code
  targets Moire's own `MessageBuilder`/`MessageReader` wire runtime.
- `xdg_toplevel` with `zwp_linux_dmabuf_v1` ARGB8888 presentation when a
  render node and surfaceless EGL are available.
- A small GBM target pool follows `wl_buffer.release`; an exhausted pool falls
  back to `wl_shm` rather than stalling the application loop.
- `wl_shm` ARGB8888 remains the deterministic fallback.
- Seat pointer (incl. axis → wheel) and keyboard.
- `wl_data_device_manager`: drag sources with labeled icon surfaces; drop receive into `DropTarget` sinks.
- Fixed-size windows set min=max size so the compositor does not force a large default slot.

Moire guest session sets `XDG_RUNTIME_DIR=$HOME/.moire-runtime` (not `/run/user/$UID`) so the socket survives without logind linger.

`MOIRE_UI_ACCELERATION=software|auto|dmabuf` controls presentation. `software`
is the default while scene rasterization and compositor import still cross the
CPU; `auto` probes EGL and quietly falls back; `dmabuf` keeps the fallback but
reports a failed EGL probe. `software`/`shm` bypasses EGL entirely.
`MOIRE_RENDER_NODE` can select a non-default render node.

Regenerate the checked-in bindings on a Linux development system with the
Wayland protocol XML packages installed:

```bash
pnpm --filter @moire/protocol generate
pnpm --filter @moire/protocol smoke:generated
```

The dependency-free TypeScript generator and protocol smoke cover generic
`new_id` encoding, SCM_RIGHTS file descriptors, fixed-point and nullable
arguments, plus XML metadata. Keeping the generated file checked in means
ordinary builds do not require the system XML packages.

## Headless

Path: `packages/ui/src/platforms/headless/index.ts`.

- In-memory frames for smoke tests.
- Inject helpers on the concrete class for pointer/key in unit tests.
- No DnD bridge (drags no-op at the platform layer).

## Future

Cocoa / Win32 backends are intended to implement the same `PlatformBackend` without changing widgets.

The next EGL tranche paints retained rectangles, images, and glyph-atlas text
directly into the same client target pool. After that, compositor-side direct
dma-buf import removes the remaining readback/upload bridge.
