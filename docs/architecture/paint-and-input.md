# Paint order and input routing

## Composite stack

Each frame in `packages/core` `CompositorServer.composite()`:

| Order | Layer | Source |
| --- | --- | --- |
| 1 | Wallpaper | `paintWallpaper` (`@moire/theme`), optional atmosphere phase |
| 2 | Desktop icons | `shell.paintDesktop` |
| 3 | Toplevel surfaces + SSD | Stack bottom→top; `shell.paintSsdWindow` after each SSD window |
| 4 | Popups | Above toplevels |
| 5 | Panel / launcher | `shell.paint` |
| 6 | Drag preview | Hotspot-anchored client surface or return-animation snapshot, else `shell.paintDragPreview` |
| 7 | Cursor | Client cursor or fallback shape |
| 8 | Present | `flushMmap` + `presentKms` (required on Parallels VIRTUAL DRM) |

Atmosphere wallpaper sets `markDirty()` while active so the desktop can drift slowly.

## Pointer button routing

Simplified path in `onPointerButton`:

1. If a DnD session is active and the button releases → `endDrag`.
2. `shell.onPointerButton` — panel and launcher (consumes if hit).
3. SSD hit-test (`hitSsd`) on press — move/close/maximize/minimize.
4. `updatePointerFocus` for the surface under the cursor.
5. If **no** surface under cursor → `shell.onDesktopPointerButton` (icons).
6. Otherwise focus / resize edges / forward `pointerButton` to the client.

## Pointer motion

- Normal: update cursor, focus, hover edges, optional Xwayland ghost motion.
- During DnD: `updateDragFocus` only (enter/leave/motion to the target client).
- No window under cursor: `shell.onDesktopPointerMotion` for icon hover and local reposition/folder drag.

## Keyboard

- Shell: Super toggles launcher; when launcher open, Esc / arrows / Enter / typing.
- Focused client receives seat keyboard events.

## Why desktop clicks can “fail”

Desktop handlers run only when the compositor’s hit-test finds **no client surface** under the cursor. A Files or foot window covering icons will receive the click instead. Kill or move windows (or use `guest-prep-desktop-shot.sh`) when testing icons alone.

## Related

- [Desktop icons](../shell/desktop.md)
- [Wayland DnD](../compositor/dnd.md)
- [Parallels DRM present](../parallels-drm-present.md)
