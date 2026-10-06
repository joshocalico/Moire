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

`PlatformWindow`: `present(ARGB pixels)`, optional `presentScene(retainedFrame)`,
configure/close/pointer/key callbacks, `setTitle` / `setSize` / `destroy`.

Optional native window actions are `beginMove`, `setMaximized`, `isMaximized`
and `minimize`. Wayland uses xdg-toplevel requests and confirms maximize state
from configure events. Headless records minimize requests and emits configure
events for maximize/restore so the same application chrome can be exercised.

The pixel argument remains the portable fallback. Accelerated windows first
offer a renderer-neutral retained frame: solid and rounded rectangles plus
shadows become GPU geometry, images are cached texture layers, and text is
rasterized only into glyph-sized cached layers. The Wayland backend paints that
scene into a renderer-owned EGL target and attaches the exported dma-buf.

Optional `DndCapable.startDrag(mimeTypes, getPayload, serial)` — Wayland implements this; widgets talk through `setDndBridge` instead of casting the backend.

## Wayland

Path: `packages/ui/src/platforms/wayland/index.ts`.

- Linux only; Moire's TypeScript client owns the Unix socket at
  `$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY`, ancillary-FD transport, object IDs,
  framing and dispatch. It does not load libwayland.
- Request encoders, event decoders, opcodes, versions, enums and destructor
  metadata are generated from `wayland.xml`, stable xdg-shell and
  presentation-time, xdg-decoration, and linux-dmabuf XML into
  `@moire/protocol/generated`. The generated code
  targets Moire's own `MessageBuilder`/`MessageReader` wire runtime.
- `xdg_toplevel` with `zwp_linux_dmabuf_v1` ARGB8888 presentation when a
  render node and surfaceless EGL are available.
- A small GBM target pool follows `wl_buffer.release`; an exhausted pool falls
  back to `wl_shm` rather than stalling the application loop.
- `wl_shm` ARGB8888 remains the deterministic fallback.
- Every native commit requests `wl_surface.frame`; `wp_presentation` feedback
  reports compositor timestamps and DRM sequences. Hardware-clock and vsync
  flags remain false when the presentation path cannot establish them. SHM
  `wl_buffer.release` is measured as reuse latency, never misreported as FPS.
- Seat pointer (incl. axis → wheel) and keyboard.
- Keyboard input follows `wl_keyboard.enter` and `leave`, independently of
  pointer focus. Native popups receive keys when the seat enters their surface.
  Enter restores the compositor's held-key array; leave or window destruction
  clears stale modifiers and repeat state. The latest pointer or keyboard
  serial supplies popup grabs triggered from either input device.
- `wl_data_device_manager`: drag sources with labeled icon surfaces; drop receive into `DropTarget` sinks.
- Fixed-size windows set min=max size so the compositor does not force a large default slot.

Moire guest session sets `XDG_RUNTIME_DIR=$HOME/.moire-runtime` (not `/run/user/$UID`) so the socket survives without logind linger.

`MOIRE_UI_ACCELERATION=software|auto|dmabuf` controls presentation. `auto` is
the default: it probes retained EGL/dmabuf and quietly falls back through a
full software frame to `wl_shm`. `dmabuf` uses the same fallback but reports a
failed EGL probe. `software`/`shm` bypasses EGL entirely.
`MOIRE_RENDER_NODE` can select a non-default render node.

`Window.getVisibility()` returns `visible`, `hidden` or `unknown`.
`Window.onVisibilityChange(callback)` subscribes to changes and returns an
unsubscribe function. The private `moire_surface_state_manager_v1` protocol
publishes compositor coverage independently of client commits, so an idle
window can receive occlusion and reveal updates. Focus, fullscreen state and
frame callbacks do not establish visibility.

Unsupported compositors, headless windows, disconnected transports, closed
windows and unresolved coverage return `unknown`. The server evaluates actual
paint order after presentation without reading GPU pixels. Alpha, transforms,
scaled crop ambiguity, output recovery and work-budget exhaustion fail closed.
Decorative motion must pause for `hidden` and `unknown`. This protocol establishes
no hardware-rendering capability, and production backdrop motion remains static
pending positive hardware evidence and native integration checks.

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

The next EGL tranche turns the cached text layers into a shared glyph atlas,
adds retained group-opacity surfaces, and moves more border geometry fully
onto the GPU. After that, compositor-side direct dma-buf import removes the
remaining import bridge.
