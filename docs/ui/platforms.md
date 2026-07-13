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

Optional `DndCapable.startDrag(mimeTypes, getPayload, serial)` — Wayland implements this; widgets talk through `setDndBridge` instead of casting the backend.

## Wayland

Path: `packages/ui/src/platforms/wayland/index.ts`.

- Linux only; socket `$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY`.
- `xdg_toplevel` + `wl_shm` ARGB8888.
- Seat pointer (incl. axis → wheel) and keyboard.
- `wl_data_device_manager`: drag sources with labeled icon surfaces; drop receive into `DropTarget` sinks.
- Fixed-size windows set min=max size so the compositor does not force a large default slot.

Moire guest session sets `XDG_RUNTIME_DIR=$HOME/.moire-runtime` (not `/run/user/$UID`) so the socket survives without logind linger.

## Headless

Path: `packages/ui/src/platforms/headless/index.ts`.

- In-memory frames for smoke tests.
- Inject helpers on the concrete class for pointer/key in unit tests.
- No DnD bridge (drags no-op at the platform layer).

## Future

Cocoa / Win32 backends are intended to implement the same `PlatformBackend` without changing widgets.
